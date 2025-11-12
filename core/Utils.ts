import { ICocosMigrationTool } from "./ICocosMigrationTool";

export function formatUuid(uuid: string, owner: ICocosMigrationTool): string {
    const asset = owner.allAssets.get(uuid);
    if (asset) {
        if (null != asset.userData.__layaId) {
            return asset.userData.__layaId;
        }
        return uuid;
    }
    console.warn(`Uuid not found: ${uuid}`);
    return uuid;
}