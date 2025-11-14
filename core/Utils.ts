import { ICocosMigrationTool } from "./ICocosMigrationTool";
import fpath from "path";
const internalUUIDMap: Record<string, string> = {

};

export function formatUuid(uuid: string, owner: ICocosMigrationTool): string {
    const asset = owner.allAssets.get(uuid);
    if (asset) {
        if (null != asset.userData.__layaSubName) {
            const parentUUID = uuid.split("@")[0];
            const assetInfo = EditorEnv.assetMgr.getAsset(parentUUID);
            if (assetInfo && assetInfo.children) {
                for (const child of assetInfo.children) {
                    if (0 == asset.userData.__layaSubName.indexOf(child.name + ".")) {
                        return child.id;
                    }
                }
                //走下面的逻辑有可能出问题，临时解决方案
                if (!asset.userData.__layaId) {
                    console.warn(`Uuid not found: ${uuid}, maybe because of the sub-asset name is not correct, please check the sub-asset name in the asset manager.`);
                    const ext = fpath.extname(asset.userData.__layaSubName);
                    for (const child of assetInfo.children) {
                        const childExt = fpath.extname(child.fileName);
                        if (".animation" === ext && ".lani" === childExt) {
                            return child.id;
                        }
                    }
                }
            }
            console.warn('uuid获取可能会出错，因为IDE的子id和cocos的子id可能会出现不一致的情况', uuid, asset.userData.__layaId);
            return asset.userData.__layaId;

        }
        return uuid;
    }
    console.warn(`Uuid not found: ${uuid}`);
    return uuid;
}