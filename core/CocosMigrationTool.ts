import fs from "fs";
import fpath from "path";
import { ICocosAssetConversion, ICocosMigrationTool as ICocosMigrationTool } from "./ICocosMigrationTool";
import { ConversionRegistry } from "./Registry";

const ConversionPiority = Symbol("ConversionPriority");

export class CocosMigrationTool implements ICocosMigrationTool {
    projectConfig: any;
    allAssets: Map<string, { sourcePath: string, userData: any }>;

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

    async run(options: {
        sourceFolder: string,
        targetFolder: string,
        cocosInternalAssetsFolder?: string,
        cocosProjectConfig?: any,
        copyUnknownAssets?: boolean
    }) {
        this.allAssets = new Map();
        this._items = [];
        this._registry = new Map();
        this._folders = new Set();

        let sourceFolder = options.sourceFolder;
        let targetFolder = options.targetFolder;
        this._copyUnknownAssets = options.copyUnknownAssets;

        let cocosProjectRoot = sourceFolder;
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
                if (internalAssetsFolder.endsWith("/*"))
                    internalAssetsFolder = internalAssetsFolder.substring(0, internalAssetsFolder.length - 2);
            }
        }

        let internalOutputFolder: string;
        if (internalAssetsFolder && internalAssetsFolder != sourceFolder) {
            internalOutputFolder = IEditorEnv.utils.mkTempDir();
            await this.readDir(internalAssetsFolder, internalOutputFolder, "");
        }
        await this.readDir(sourceFolder, targetFolder, "");

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
            if (!targetPath)
                continue;

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

        if (internalOutputFolder) {
            await fs.promises.rm(internalOutputFolder, { recursive: true, force: true });
        }
    }

    private getAssetConversion(ext: string): ICocosAssetConversion | null {
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