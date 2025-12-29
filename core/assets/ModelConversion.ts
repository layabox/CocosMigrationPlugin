import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import * as fs from "fs";
import { PrefabConversion } from "../PrefabConversion";
import fpath from "path";
import { internalUUIDMap } from "../Utils";

export class ModelConversion implements ICocosAssetConversion {
    constructor(private owner: ICocosMigrationTool) { }

    /**
     * 建立图片 UUID 到文件名的映射关系，并处理 texture 资源
     * 解析 userData.imageMetas 建立映射表，然后在 subMetas 中查找 texture 资源，
     * 通过 imageUuidOrDatabaseUri 找到对应的图片文件名并记录
     */
    private processTextureImageMapping(meta: any, targetPath: string): void {
        targetPath = fpath.relative(EditorEnv.assetsPath, targetPath);
        //去掉targetPath的最后一层目录
        targetPath = targetPath.substring(0, targetPath.lastIndexOf(fpath.sep));
        // 建立图片 UUID 到文件名的映射关系
        // 解析 userData.imageMetas，建立映射表
        if (meta.userData && meta.userData.imageMetas && Array.isArray(meta.userData.imageMetas)) {
            for (let imageMeta of meta.userData.imageMetas) {
                if (imageMeta.uri && imageMeta.name) {
                    internalUUIDMap[imageMeta.uri] = fpath.join(targetPath, imageMeta.name)
                }
            }
        }

        // 处理 subMetas 中的 texture 资源，建立 texture UUID 到图片文件名的映射
        if (meta.subMetas) {
            for (let subId in meta.subMetas) {
                let subMeta = meta.subMetas[subId];

                // 处理 texture 资源
                if (subMeta.importer === "texture" && subMeta.userData) {
                    let textureUuid = subMeta.uuid;
                    let imageUuidOrDatabaseUri = subMeta.userData.imageUuidOrDatabaseUri;
                    const path = internalUUIDMap[imageUuidOrDatabaseUri];
                    if(path && textureUuid){
                        internalUUIDMap[textureUuid] = path;
                    }
                }
            }
        }
    }

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

        // 建立图片 UUID 到文件名的映射关系，并处理 texture 资源
        this.processTextureImageMapping(meta, targetPath);

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