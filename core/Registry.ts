import { ICocosAssetConversion, ICocosMigrationTool } from "./ICocosMigrationTool";
import { ImageConversion } from "./ImageConversion";
import { PrefabConversion } from "./PrefabConversion"


/**
 * 在这里注册每个扩展名对应的处理器
 */
export var ConversionRegistry: Array<{ exts: Array<string>, type: new (owner: ICocosMigrationTool) => ICocosAssetConversion }> = [
    {
        exts: ["png", "jpg", "jpeg", "hdr"],
        type: ImageConversion
    },

    {
        exts: ["prefab", "scene"],
        type: PrefabConversion
    },
];