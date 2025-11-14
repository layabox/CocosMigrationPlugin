import { ICocosMigrationTool } from "./ICocosMigrationTool";

export function formatUuid(uuid: string, owner: ICocosMigrationTool): string {
    const asset = owner.allAssets.get(uuid);
    if (asset) {
        if (null != asset.userData.__layaSubName) {
            const parentUUID = uuid.split("@")[0];
            const assetInfo = EditorEnv.assetMgr.getAsset(parentUUID);
            if (assetInfo && assetInfo.children) {
                for (const child of assetInfo.children) {
                    if (child.fileName == asset.userData.__layaSubName) {
                        return child.id;
                    }
                }
            }
            return asset.userData.__layaId;
        }
        return uuid;
    }
    console.warn(`Uuid not found: ${uuid}`);
    return uuid;
}