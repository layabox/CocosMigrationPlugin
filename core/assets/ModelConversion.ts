import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import * as fs from "fs";
import { PrefabConversion } from "../PrefabConversion";

export class ModelConversion implements ICocosAssetConversion {
    constructor(private owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        let subAssets = meta.userData.assetFinder;

        let registerSubAssets = (catalog: string, layaType: string) => {
            if (!subAssets[catalog])
                return;

            let i = 0;
            for (let uuid of subAssets[catalog]) {
                let subId = uuid.split("@")[1];
                if (!subId) {
                    console.warn(`Invalid sub-asset uuid format: ${uuid}, missing "@" separator`);
                    continue;
                }
                if (!meta.subMetas || !meta.subMetas[subId]) {
                    console.warn(`Sub-asset metadata not found for subId: ${subId} in uuid: ${uuid}`);
                    continue;
                }
                let newSubId = layaType + i++;
                this.owner.allAssets.set(uuid, {
                    sourcePath,
                    userData: Object.assign(meta.subMetas[subId].userData, { __layaId: meta.uuid + "@" + newSubId })
                });
            }
        };

        registerSubAssets("meshes", "lm");
        registerSubAssets("materials", "lmat");
        registerSubAssets("textures", "img");
        registerSubAssets("skeletons", "lani");



        await fs.promises.copyFile(sourcePath, targetPath);

        // 为 FBX 文件设置正确的导入参数，确保自动应用单位转换
        // Cocos 的模型单位是厘米（cm），Laya 默认是米（m）
        // 设置 convertUnits: 1 (厘米) 和 normalizeMesh: true，让 Laya 自动应用 0.01 缩放
        const fileExt = sourcePath.toLowerCase().substring(sourcePath.lastIndexOf("."));
        const isModelFile = [".fbx", ".gltf", ".glb", ".obj"].includes(fileExt);

        let metaContent: any = { uuid: meta.uuid };
        if (isModelFile) {
            metaContent.importer = {
                convertUnits: 1, // 1 = 厘米，0 = 米
                normalizeMesh: true, // 自动归一化：如果单位是 cm，会自动应用 0.01 缩放
                scaleFactor: 1 // 默认缩放因子
            };
        }
        this.owner.allAssets.set(meta.uuid, {
            sourcePath,
            userData: metaContent
        });
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", metaContent);
        
        const relativePath = EditorEnv.assetMgr.toRelativePath(targetPath);
        await EditorEnv.assetMgr.waitForAssetsReady([relativePath]);
        
        if (subAssets.scenes?.length > 0) {
            let sceneAssetId: string = subAssets["scenes"][0];
            this.owner.allAssets.set(sceneAssetId, {
                sourcePath,
                userData: { __layaId: meta.uuid + "@0" }
            });

            if (this.owner.cocosProjectRoot) {
                let scenePath = `${this.owner.cocosProjectRoot}/library/${sceneAssetId.substring(0, 2)}/${sceneAssetId}.json`;
                let elements = await IEditorEnv.utils.readJsonAsync(scenePath);
                (this.owner.getAssetConversion("prefab") as PrefabConversion).parseElements(elements);
            }
        }
    }
}