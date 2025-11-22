import { ModelConversion } from "./assets/ModelConversion";
import { ICocosAssetConversion, ICocosMigrationTool } from "./ICocosMigrationTool";
import { ImageConversion } from "./assets/ImageConversion";
import { PrefabConversion } from "./PrefabConversion"
import { MaterialConversion } from "./assets/MaterialConversion";
import { AnimGraphConversion } from "./assets/AnimGraphConversion";
import { ShaderConversion } from "./assets/ShaderConversion";
import { AnimationClipConversion } from "./assets/AnimationClipConversion";


/**
 * 在这里注册每个扩展名对应的处理器
 */
export var ConversionRegistry: Array<{ exts: Array<string>, type: new (owner: ICocosMigrationTool) => ICocosAssetConversion }> = [
    {
        exts: ["png", "jpg", "jpeg", "hdr"],
        type: ImageConversion
    },

    {
        exts: ["fbx", "gltf", "glb", "obj"],
        type: ModelConversion
    },

    {
        exts: ["prefab", "scene"],
        type: PrefabConversion
    },
    {
        exts: ["effect"],
        type: ShaderConversion
    },
    {
        exts: ["mtl"],
        type: MaterialConversion
    },
    {
        exts: ["animgraph"],
        type: AnimGraphConversion
    },
    {
        exts: ["anim"],
        type: AnimationClipConversion
    }
];