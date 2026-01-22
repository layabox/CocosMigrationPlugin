import fs from "fs";
import fpath from "path";
import { ICocosAssetConversion, ICocosMigrationTool as ICocosMigrationTool } from "./ICocosMigrationTool";
import { ConversionRegistry } from "./Registry";
import { Utils } from "../../cankao/engineSource/src/layaAir/laya/utils/Utils";
import { internalUUIDMap } from "./Utils";

const ConversionPiority = Symbol("ConversionPriority");

export class CocosMigrationTool implements ICocosMigrationTool {
    projectConfig: any;
    cocosProjectRoot: string;
    static assetsPath: string;
    allAssets: Map<string, { sourcePath: string, userData: any }>;
    _pendingSkyboxMaterials?: Array<{
        path: string;
        data: any;
        uuid: string;
    }>;

    private _insts: Map<any, any> = new Map();
    private _folders: Set<string>;
    private _copyUnknownAssets: boolean;
    private _registry: Map<string, new (owner: ICocosMigrationTool) => ICocosAssetConversion>;
    private _items: Array<{
        sourcePath: string,
        targetPath: string,
        conv: ICocosAssetConversion,
        meta: any
    }>;

    async run(tasks: ReadonlyArray<{
        sourceFolder: string,
        targetFolder?: string,
        ignoreFiles?: Set<string>
    }>, options?: {
        cocosInternalAssetsFolder?: string,
        cocosProjectConfig?: any,
        copyUnknownAssets?: boolean
    }) {
        this.allAssets = new Map();
        this._items = [];
        this._registry = new Map();
        this._folders = new Set();
        const obj = internalUUIDMap;
        for (const k in obj) delete obj[k];

        options = options || {};

        this._copyUnknownAssets = !!options.copyUnknownAssets;

        let cocosProjectRoot = tasks[0].sourceFolder;

        let assetsPath = tasks[0].targetFolder;

        CocosMigrationTool.assetsPath = fpath.relative(EditorEnv.assetsPath, assetsPath);


        //读取cocos的配置文件
        while (true) {
            let testPath = fpath.join(cocosProjectRoot, "settings", "v2");
            if (fs.existsSync(testPath))
                break;

            cocosProjectRoot = fpath.normalize(fpath.join(cocosProjectRoot, ".."));
            if (cocosProjectRoot == "/" || cocosProjectRoot.endsWith(":\\")) {
                cocosProjectRoot = null;
                console.warn("无法定位目标资源所在的Cocos项目目录");
                break;
            }
        }
        this.cocosProjectRoot = cocosProjectRoot;

        let projectConfig = options.cocosProjectConfig;
        if (!projectConfig && cocosProjectRoot)
            projectConfig = await IEditorEnv.utils.readJsonAsync(fpath.join(cocosProjectRoot, "settings", "v2", "packages", "project.json"));
        if (!projectConfig)
            projectConfig = {};
        if (!projectConfig.general)
            projectConfig.general = {};
        if (!projectConfig.general.designResolution)
            projectConfig.general.designResolution = {};
        if (!projectConfig.general.designResolution.width)
            projectConfig.general.designResolution.width = 1280;
        if (!projectConfig.general.designResolution.height)
            projectConfig.general.designResolution.height = 720;
        this.projectConfig = projectConfig;

        let internalAssetsFolder = options.cocosInternalAssetsFolder;
        
        // 检测 internalAssetsFolder 是否存在
        if (internalAssetsFolder) {
            if (!fs.existsSync(internalAssetsFolder)) {
                throw new Error(
                    `内部资源文件夹不存在: ${internalAssetsFolder}\n` +
                    `请先用 Cocos Creator IDE 打开项目，然后再进行转换。\n` +
                    `Cocos Creator IDE 会在首次打开项目时更新内部资源文件夹路径。`
                );
            }
        }
        if (!internalAssetsFolder && cocosProjectRoot) {
            let tsconfig = await IEditorEnv.utils.readJsonAsync(fpath.join(cocosProjectRoot, "temp", "tsconfig.cocos.json"));
            if (tsconfig) {
                internalAssetsFolder = tsconfig.compilerOptions.paths["db://internal/*"][0];
                if (internalAssetsFolder.endsWith("/*") || internalAssetsFolder.endsWith("\\*"))
                    internalAssetsFolder = internalAssetsFolder.substring(0, internalAssetsFolder.length - 2);
            }
        }

        if (internalAssetsFolder && tasks.findIndex(t => t.sourceFolder == internalAssetsFolder) === -1) {
            tasks = tasks.concat({
                sourceFolder: internalAssetsFolder,
                targetFolder: this.getCCInternalPath()
            });
        }

        let tmpFolders: Array<string> = [];
        for (let task of tasks) {
            let targetFolder = task.targetFolder;
            if (!targetFolder) {
                targetFolder = IEditorEnv.utils.mkTempDir();
                tmpFolders.push(targetFolder);
            }
            await this.readDir(task.sourceFolder, targetFolder, "", task.ignoreFiles);
        }

        for (let folder of this._folders) {
            if (!fs.existsSync(folder)) {
                await fs.promises.mkdir(folder, { recursive: true });
            }
        }

        this._items.sort((a, b) => {
            let p1 = (a.conv as any)[ConversionPiority];
            let p2 = (b.conv as any)[ConversionPiority];
            return p1 - p2;
        });

        for (let { sourcePath, targetPath, conv, meta } of this._items) {
            if (conv)
                await conv.run(sourcePath, targetPath, meta);
            else if (this._copyUnknownAssets) {
                await fs.promises.copyFile(sourcePath, targetPath);
                await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
            }
        }

        for (let folder of this._folders) {
            if ((await fs.promises.readdir(folder)).length === 0) {
                await fs.promises.rmdir(folder);
            }
        }

        for (let inst of this._insts.values()) {
            if (inst.complete)
                await inst.complete();
        }

        for (let folder of tmpFolders) {
            await fs.promises.rm(folder, { recursive: true, force: true });
        }

        EditorEnv.scene.validateScene();
    }

    getAssetConversion(ext: string): ICocosAssetConversion | null {
        ext = ext.toLowerCase();
        let cls = this._registry.get(ext);
        if (cls === undefined) {
            let i = ConversionRegistry.findIndex(info => info.exts.includes(ext));
            if (i !== -1) {
                cls = ConversionRegistry[i].type;
                (cls as any)[ConversionPiority] = i;
            }
            else if (this._copyUnknownAssets) {
                cls = CopyOnlyConversion;
                (cls as any)[ConversionPiority] = Number.MAX_SAFE_INTEGER;
            }
            else {
                cls = null;
                console.warn("No conversion for asset type: " + ext);
            }
            this._registry.set(ext, cls);
        }

        if (!cls)
            return null;

        let inst = this._insts.get(cls);
        if (inst)
            return inst;

        inst = new cls(this);
        (inst as any)[ConversionPiority] = (cls as any)[ConversionPiority];
        this._insts.set(cls, inst);
        return inst;
    }

    /**
     * 获取cc-internal目录的路径
     */
    private getCCInternalPath(): string {
        // 获取assets路径
        let assetsPath: string | undefined = undefined;
        if (typeof EditorEnv !== "undefined" && EditorEnv.assetsPath) {
            assetsPath = EditorEnv.assetsPath;
        } else if (typeof Editor !== "undefined" && Editor.assetsPath) {
            assetsPath = Editor.assetsPath;
        } else {
            // 如果无法获取assetsPath，尝试从process.cwd()推断
            const currentPath = process.cwd();
            if (currentPath.includes("assets")) {
                const assetsIndex = currentPath.indexOf("assets");
                assetsPath = currentPath.substring(0, assetsIndex + "assets".length);
            }
        }

        if (!assetsPath) {
            throw new Error("[CocosMigrationTool] 无法获取assets路径");
        }

        return fpath.join(assetsPath, "cc-internal");
    }

    private async readDir(sourceFolder: string, targetFolder: string, folderRelativePath: string, ignoreFiles?: Set<string>) {
        let folderFullPath = fpath.join(sourceFolder, folderRelativePath);
        let targetFolderFullPath = fpath.join(targetFolder, folderRelativePath);
        this._folders.add(targetFolderFullPath);

        let dirents = await fs.promises.readdir(folderFullPath, { withFileTypes: true });
        for (let dirent of dirents) {
            if (dirent.isDirectory()) {
                await this.readDir(sourceFolder, targetFolder, folderRelativePath + "/" + dirent.name, ignoreFiles);
                continue;
            }
            let ext = fpath.extname(dirent.name);
            if (!ext || ext == ".meta")
                continue;

            ext = ext.substring(1);
            let sourcePath = fpath.join(folderFullPath, dirent.name);
            let targetPath = fpath.join(targetFolderFullPath, dirent.name);
            let metaFile = sourcePath + ".meta";
            if (!await IEditorEnv.utils.fileExists(metaFile))
                continue;

            let meta = await IEditorEnv.utils.readJsonAsync(metaFile);
            let conv = this.getAssetConversion(ext);
            if (conv && (!ignoreFiles || !ignoreFiles.has(folderRelativePath ? (folderRelativePath + "/") : "" + dirent.name)))
                this._items.push({ sourcePath, targetPath, conv, meta });
            this.allAssets.set(meta.uuid, { sourcePath, userData: meta.userData || {} });

            let subMetas: Array<any> = Object.values(meta.subMetas || {});
            for (let subMeta of subMetas) {
                let subName = subMeta.name;
                const ext = fpath.extname(subName);
                subName = subName.substring(0, subName.length - ext.length);
                switch (ext) {
                    case ".animation":
                        subName += ".lani";
                        break;
                    case ".material":
                        subName += ".lmat";
                        break;
                    case ".mesh":
                        subName += ".lm";
                        break;
                    case ".scene":
                        subName += ".ls";
                        break;
                    case ".prefab":
                        subName += ".lh";
                        break;
                    default:
                        console.warn("Unknown sub-asset name: " + subName);
                        break;
                }
                subMeta.userData.__layaSubName = subName;
                this.allAssets.set(subMeta.uuid, { sourcePath, userData: subMeta.userData });
            }
        }
    }
}

class CopyOnlyConversion implements ICocosAssetConversion {
    async run(sourcePath: string, targetPath: string, meta: any) {
        await fs.promises.copyFile(sourcePath, targetPath);
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
    }
}