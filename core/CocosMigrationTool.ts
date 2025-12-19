import fs from "fs";
import fpath from "path";
import { ICocosAssetConversion, ICocosMigrationTool as ICocosMigrationTool } from "./ICocosMigrationTool";
import { ConversionRegistry } from "./Registry";

const ConversionPiority = Symbol("ConversionPriority");

export class CocosMigrationTool implements ICocosMigrationTool {
    projectConfig: any;
    cocosProjectRoot: string;
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
    }>, options?: {
        cocosInternalAssetsFolder?: string,
        cocosProjectConfig?: any,
        copyUnknownAssets?: boolean
    }) {
        // 在转换前，复制插件目录下的shaders文件夹到cc-internal下
        await this.copyShadersFolder();

        this.allAssets = new Map();
        this._items = [];
        this._registry = new Map();
        this._folders = new Set();

        options = options || {};

        this._copyUnknownAssets = !!options.copyUnknownAssets;

        let cocosProjectRoot = tasks[0].sourceFolder;
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
        if (!internalAssetsFolder && cocosProjectRoot) {
            let tsconfig = await IEditorEnv.utils.readJsonAsync(fpath.join(cocosProjectRoot, "temp", "tsconfig.cocos.json"));
            if (tsconfig) {
                internalAssetsFolder = tsconfig.compilerOptions.paths["db://internal/*"][0];
                if (internalAssetsFolder.endsWith("/*") || internalAssetsFolder.endsWith("\\*"))
                    internalAssetsFolder = internalAssetsFolder.substring(0, internalAssetsFolder.length - 2);
            }
        }

        if (internalAssetsFolder && tasks.findIndex(t => t.sourceFolder == internalAssetsFolder) === -1) {
            //console.warn("临时去掉内部资源迁移，需要的时候再打开");
            tasks = tasks.concat({ sourceFolder: internalAssetsFolder, targetFolder: this.getCCInternalPath() });
        }

        let tmpFolders: Array<string> = [];
        for (let task of tasks) {
            let targetFolder = task.targetFolder;
            if (!targetFolder) {
                targetFolder = IEditorEnv.utils.mkTempDir();
                tmpFolders.push(targetFolder);
            }
            await this.readDir(task.sourceFolder, targetFolder, "");
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

    /**
     * 复制插件目录下的shaders文件夹到cc-internal下
     */
    private async copyShadersFolder() {
        try {
            // 获取cc-internal路径（使用统一的方法）
            let ccInternalPath: string;
            try {
                ccInternalPath = this.getCCInternalPath();
            } catch (error) {
                console.warn("[CocosMigrationTool] 无法获取assets路径，跳过shaders文件夹复制");
                return;
            }
            
            // 从cc-internal路径推断assets路径
            const assetsPath = fpath.dirname(ccInternalPath);
            
            // 源路径：插件目录下的shaders文件夹
            const sourceShadersPath = fpath.join(assetsPath, "CocosMigrationPlugin", "shaders");
            // 目标路径：cc-internal下的shaders文件夹
            const targetShadersPath = fpath.join(ccInternalPath, "shaders");

            // 检查源文件夹是否存在
            if (!fs.existsSync(sourceShadersPath)) {
                console.warn(`[CocosMigrationTool] 源shaders文件夹不存在: ${sourceShadersPath}`);
                return;
            }

            // 确保目标文件夹存在
            if (!fs.existsSync(targetShadersPath)) {
                await fs.promises.mkdir(targetShadersPath, { recursive: true });
            }

            // 递归复制文件夹
            await this.copyDirectory(sourceShadersPath, targetShadersPath);
            console.log(`[CocosMigrationTool] 成功复制shaders文件夹从 ${sourceShadersPath} 到 ${targetShadersPath}`);
        } catch (error) {
            console.error(`[CocosMigrationTool] 复制shaders文件夹时出错:`, error);
        }
    }

    /**
     * 递归复制目录及其所有文件
     */
    private async copyDirectory(sourceDir: string, targetDir: string) {
        // 确保目标目录存在
        if (!fs.existsSync(targetDir)) {
            await fs.promises.mkdir(targetDir, { recursive: true });
        }

        // 读取源目录中的所有条目
        const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

        for (const entry of entries) {
            const sourcePath = fpath.join(sourceDir, entry.name);
            const targetPath = fpath.join(targetDir, entry.name);

            if (entry.isDirectory()) {
                // 如果是目录，递归复制
                await this.copyDirectory(sourcePath, targetPath);
            } else {
                // 如果是文件，直接复制
                await fs.promises.copyFile(sourcePath, targetPath);
            }
        }
    }

    private async readDir(sourceFolder: string, targetFolder: string, folderRelativePath: string) {
        let folderFullPath = fpath.join(sourceFolder, folderRelativePath);
        let targetFolderFullPath = fpath.join(targetFolder, folderRelativePath);
        this._folders.add(targetFolderFullPath);

        let dirents = await fs.promises.readdir(folderFullPath, { withFileTypes: true });
        for (let dirent of dirents) {
            if (dirent.isDirectory()) {
                await this.readDir(sourceFolder, targetFolder, folderRelativePath + "/" + dirent.name);
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
            if (conv)
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