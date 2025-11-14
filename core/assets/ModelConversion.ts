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
                let subName = meta.subMetas[subId].name.split(".")[0] + "." + layaType;
                this.owner.allAssets.set(uuid, {
                    sourcePath,
                    userData: Object.assign(meta.subMetas[subId].userData, { __layaId: meta.uuid + "@" + newSubId, __layaSubName: subName })
                });
            }
        };

        registerSubAssets("meshes", "lm");
        registerSubAssets("materials", "lmat");
        registerSubAssets("textures", "img");
        registerSubAssets("skeletons", "lani");

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

        await fs.promises.copyFile(sourcePath, targetPath);
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
    }
}