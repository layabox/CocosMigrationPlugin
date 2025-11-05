import fs from "fs";
import { ICocosAssetConversion } from "./ICocosMigrationTool";

export class ImageConversion implements ICocosAssetConversion {

    async run(sourcePath: string, targetPath: string, meta: any) {
        let type = meta.userData.type;
        let subMetas: Array<any> = Object.values(meta.subMetas || {});
        let newMeta = { uuid: meta.uuid, importer: {} };
        let importerData: any = newMeta.importer;

        switch (type) {
            case "texture":
            case "sprite-frame": {
                importerData.textureType = type == "texture" ? 0 : 2;
                break;
            }

            case "texture cube":
                importerData.textureType = 0;
                importerData.shape = 1;
                break;

            case "raw":
                importerData.textureType = 0;
                break;

            case "normal map":
                console.warn("Normal map conversion not implemented yet.");
                break;
        }

        for (let subMeta of subMetas) {
            let userData = subMeta.userData;
            if (subMeta.importer == "sprite-frame") {
                if (userData.borderTop !== 0 || userData.borderBottom !== 0 || userData.borderLeft !== 0 || userData.borderRight !== 0) {
                    importerData.sizeGrid = [userData.borderTop, userData.borderRight, userData.borderBottom, userData.borderLeft,];
                }
            }
            else if (subMeta.importer == "texture") {
                importerData.generateMipmap = userData.mipfilter !== "none";
                // if (userData.wrapModeS == "mirrored-repeat")
                //     importerData.wrapMode = 2;
                // else if (userData.wrapModeS == "clamp-to-edge")
                //     importerData.wrapMode = 1;
                if (userData.minfilter == "nearest")
                    importerData.filterMode = 0;
                else
                    importerData.filterMode = 1;
            }
        }

        await fs.promises.copyFile(sourcePath, targetPath);
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", newMeta);
    }
}