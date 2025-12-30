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
/**
 * 转换优先级：索引越小越先处理
 * 基础资源（图片、模型、材质等）应该先处理
 * 预制体和场景依赖这些资源，应该最后处理
 */
export var ConversionRegistry: Array<{ exts: Array<string>, type: new (owner: ICocosMigrationTool) => ICocosAssetConversion }> = [
    // 1. 图片资源 - 最先处理
    {
        exts: ["png", "jpg", "jpeg", "hdr"],
        type: ImageConversion
    },

    // 2. 模型资源
    {
        exts: ["fbx", "gltf", "glb", "obj"],
        type: ModelConversion
    },

    // 3. Shader
    {
        exts: ["effect"],
        type: ShaderConversion
    },

    // 4. 材质（依赖 Shader 和图片）
    {
        exts: ["mtl"],
        type: MaterialConversion
    },

    // 5. 动画资源
    {
        exts: ["animgraph"],
        type: AnimGraphConversion
    },
    {
        exts: ["anim"],
        type: AnimationClipConversion
    },

    // 6. 预制体和场景 - 最后处理（依赖上面所有资源）
    {
        exts: ["prefab", "scene"],
        type: PrefabConversion
    }
];