import { ICocosMigrationTool } from "./ICocosMigrationTool";
import fpath from "path";
const internalUUIDMap: Record<string, string> = {

};
export function exposure(aperture: number, shutterSpeed: number, sensitivity: number): number {
    const e = aperture * aperture * shutterSpeed * 100 / sensitivity;
    return 1.0 / (1.2 * e);
}
export const apertureData: Record<number, number> = {
    0:1.8,
    1:2.0,
    2:2.2,
    3:2.5,
    4:2.8,
    5:3.2,
    6:3.5,
    7:4.0,
    8:4.5,
    9:5.0,
    10:5.6,
    11:6.3,
    12:7.1,
    13:8.0,
    14:9.0,
    15:10.0,
    16:11.0,
    17:13.0,
    18:14.0,
    19:16.0,
    20:18.0,
    21:20.0,
    22:22.0,
};
export const shutterData: Record<number, number> = {
    0:1,
    1:2,
    2:4,
    3:8,
    4:15,
    5:30,
    6:60,
    7:125,
    8:250,
    9:500,
    10:1000,
    11:2000,
    12:4000,
    13:8000,
    14:16000,
    15:32000,
    16:64000,
    17:128000,
    18:256000,
    19:512000,
    20:1024000,
}
export const ISOData: Record<number, number> = {
    0:100,
    1:200,
    2:400,
    3:800,
    4:1600,
    5:3200,
    6:6400,
}

/**
 * 查找场景或预制体中的相机数据以获取曝光参数
 */
export function findCameraData(conversion: any): any {
    const elements = conversion?.elements;
    if (elements && Array.isArray(elements)) {
        for (const element of elements) {
            if (element && element.__type__ === "cc.Camera") {
                return element;
            }
        }
    }
    return undefined;
}

export function formatUuid(uuid: string, owner: ICocosMigrationTool): string {

    const asset = owner.allAssets.get(uuid);
    if (asset) {
        if (null != asset.userData.__layaSubName) {
            const parentUUID = uuid.split("@")[0];
            const assetInfo = EditorEnv.assetMgr.getAsset(parentUUID);
            if (assetInfo && assetInfo.children) {
                for (const child of assetInfo.children) {
                    // if (0 == asset.userData.__layaSubName.indexOf(child.name + ".")) {
                    //     return child.id;
                    // }
                    if (asset.userData.__layaSubName === child.fileName) {
                        return child.id;
                    }
                }
                //走下面的逻辑有可能出问题，临时解决方案
                if (!asset.userData.__layaId) {
                    console.warn(`Uuid not found: ${uuid}, maybe because of the sub-asset name is not correct, please check the sub-asset name in the asset manager.`);
                    const ext = fpath.extname(asset.userData.__layaSubName);
                    for (const child of assetInfo.children) {
                        const childExt = fpath.extname(child.fileName);
                        if (".lani" === ext && ".lani" === childExt) {
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