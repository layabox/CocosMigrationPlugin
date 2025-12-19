import { formatUuid } from "../Utils";
import { colorToLayaColor } from "../PrefabConversion";
import fs from "fs";
import path from "path";

type AnyRecord = Record<string, any> | undefined | null;

// 固定的天空盒材质 UUID（每次转换都使用相同的 UUID）
const SKYBOX_MATERIAL_UUID_SKY_PANORAMIC = "327109c9-c01d-4fb8-b731-336d9e54d28d"; // SkyPanoramic 材质 UUID
const SKYBOX_MATERIAL_UUID_SKY_BOX = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"; // SkyBox 材质 UUID（如果需要）

/**
 * 转换 Cocos 的 SkyboxInfo 到 Laya 的 skyRenderer
 * 这个函数在 PrefabConversion 中调用，用于处理场景的 skybox
 * @param skyboxInfo Cocos 的 SkyboxInfo 数据
 * @param scene3DNode Laya 的 Scene3D 节点
 * @param owner CocosMigrationTool 实例
 * @param targetScenePath 场景文件的目标路径（用于确定材质文件的保存位置）
 */
export function convertSkyboxToLaya(
    skyboxInfo: any,
    scene3DNode: any,
    owner: any,
    targetScenePath?: string
): void {
    if (!skyboxInfo || !scene3DNode)
        return;

    // 检查是否启用
    const enabled = skyboxInfo._enabled ?? skyboxInfo.enabled ?? true;
    if (!enabled)
        return;

    // 创建 skyRenderer 对象
    const skyRenderer: any = {};

    // 确定 meshType
    // Cocos 的 _envLightingType: 0=IBL, 1=Ambient, 2=EnvironmentMap
    // Laya 的 meshType: "box" | "dome"
    // 通常使用 "dome" 作为默认值
    const envLightingType = skyboxInfo._envLightingType ?? skyboxInfo.envLightingType ?? 2;
    // 根据环境光照类型决定，通常 EnvironmentMap 使用 dome
    skyRenderer.meshType = envLightingType === 2 ? "dome" : "dome"; // 默认使用 dome

    // 转换材质：创建天空盒材质文件
    // 优先使用 _editableMaterial（可编辑材质），如果不存在则从环境贴图创建材质
    let materialUuid: string | undefined = undefined;
    let useEditableMaterial = false;

    // 1. 尝试使用可编辑材质（但需要检查类型）
    if (skyboxInfo._editableMaterial) {
        const editableMat = skyboxInfo._editableMaterial;
        let editableMatUuid: string | undefined = undefined;
        
        if (typeof editableMat === "string") {
            editableMatUuid = editableMat;
        } else if (editableMat.__uuid__) {
            editableMatUuid = editableMat.__uuid__;
        } else if (editableMat._uuid) {
            editableMatUuid = editableMat._uuid;
        }

        if (editableMatUuid) {
            materialUuid = editableMatUuid;
            useEditableMaterial = true;
        }
    }

    // 2. 如果没有可编辑材质，从环境贴图创建天空盒材质
    if (!materialUuid || !useEditableMaterial) {
        // 优先使用 HDR 环境贴图，然后是普通，最后是 LDR
        const envmap = skyboxInfo._useHDR 
            ? (skyboxInfo._envmapHDR ?? skyboxInfo._envmap)
            : (skyboxInfo._envmap ?? skyboxInfo._envmapLDR);
        
        if (envmap) {
            let envmapUuid: string | undefined = undefined;
            if (typeof envmap === "string") {
                envmapUuid = envmap;
            } else if (envmap.__uuid__) {
                envmapUuid = envmap.__uuid__;
            } else if (envmap._uuid) {
                envmapUuid = envmap._uuid;
            }

            if (envmapUuid) {
                // 创建天空盒材质
                materialUuid = createSkyboxMaterial(
                    skyboxInfo,
                    envmapUuid,
                    owner,
                    targetScenePath
                );
            }
        }
    }

    // 3. 设置材质引用
    if (materialUuid) {
        // materialUuid 已经是材质文件的 UUID（如果是新创建的材质，createSkyboxMaterial 返回的是 resolvedUuid）
        // 如果是可编辑材质，需要格式化
        const resolvedUuid = useEditableMaterial 
            ? formatUuid(materialUuid, owner) 
            : materialUuid; // 新创建的材质已经返回了 resolvedUuid
        
        skyRenderer.material = {
            "_$uuid": resolvedUuid,
            "_$type": "Material"
        };
    } else {
        // 如果没有找到材质，不设置材质，让 Laya 使用默认 skybox 材质
        console.warn("Skybox: No material found, skyRenderer will use default skybox material");
    }

    // 设置到 Scene3D 节点
    scene3DNode.skyRenderer = skyRenderer;
}

/**
 * 从场景数据中提取 SkyboxInfo
 */
export function extractSkyboxInfo(sceneData: any, elements: any[]): any {
    if (!sceneData || !elements)
        return null;

    // 获取 _globals 引用
    const globalsId = sceneData._globals?.__id__;
    if (globalsId === undefined)
        return null;

    // 查找 SceneGlobals 对象
    const globals = elements[globalsId];
    if (!globals || globals.__type__ !== "cc.SceneGlobals")
        return null;

    // 获取 _skybox 引用
    const skyboxId = globals._skybox?.__id__;
    if (skyboxId === undefined)
        return null;

    // 查找 SkyboxInfo 对象
    const skyboxInfo = elements[skyboxId];
    if (!skyboxInfo || skyboxInfo.__type__ !== "cc.SkyboxInfo")
        return null;

    return skyboxInfo;
}

/**
 * 从场景数据中提取 AmbientInfo
 */
export function extractAmbientInfo(sceneData: any, elements: any[]): any {
    if (!sceneData || !elements)
        return null;

    // 获取 _globals 引用
    const globalsId = sceneData._globals?.__id__;
    if (globalsId === undefined)
        return null;

    // 查找 SceneGlobals 对象
    const globals = elements[globalsId];
    if (!globals || globals.__type__ !== "cc.SceneGlobals")
        return null;

    // 获取 ambient 引用
    const ambientId = globals.ambient?.__id__;
    if (ambientId === undefined)
        return null;

    // 查找 AmbientInfo 对象
    const ambientInfo = elements[ambientId];
    if (!ambientInfo || ambientInfo.__type__ !== "cc.AmbientInfo")
        return null;

    return ambientInfo;
}

/**
 * 从场景数据中提取 FogInfo
 */
export function extractFogInfo(sceneData: any, elements: any[]): any {
    if (!sceneData || !elements)
        return null;

    // 获取 _globals 引用
    const globalsId = sceneData._globals?.__id__;
    if (globalsId === undefined)
        return null;

    // 查找 SceneGlobals 对象
    const globals = elements[globalsId];
    if (!globals || globals.__type__ !== "cc.SceneGlobals")
        return null;

    // 获取 fog 引用
    const fogId = globals.fog?.__id__;
    if (fogId === undefined)
        return null;

    // 查找 FogInfo 对象
    const fogInfo = elements[fogId];
    if (!fogInfo || fogInfo.__type__ !== "cc.FogInfo")
        return null;

    return fogInfo;
}

/**
 * 创建天空盒材质文件
 * @param skyboxInfo Cocos 的 SkyboxInfo 数据
 * @param envmapUuid 环境贴图的 UUID
 * @param owner CocosMigrationTool 实例
 * @param targetScenePath 场景文件的目标路径（用于确定材质文件的保存位置）
 * @returns 创建的材质 UUID
 */
function createSkyboxMaterial(
    skyboxInfo: any,
    envmapUuid: string,
    owner: any,
    targetScenePath?: string
): string {
    // 环境贴图的 UUID（用于材质中的纹理引用）
    const baseUuid = envmapUuid.split("@")[0];
    const resolvedEnvmapUuid = formatUuid(baseUuid, owner);

    // 确定材质类型
    // 使用 sky_opaque shader（基于 SkyPanoramic 逻辑，支持 Texture2D 全景图）
    const materialType = "sky_opaque";
    
    // 使用固定的 UUID（每次转换都使用相同的 UUID）
    const materialUuid = SKYBOX_MATERIAL_UUID_SKY_PANORAMIC;

    // 获取旋转角度
    const rotationAngle = skyboxInfo._rotationAngle ?? skyboxInfo.rotationAngle ?? 0;

    // 创建材质数据
    // 渲染状态参考 SkyPanoramicShaderInit.ts
    const materialData: any = {
        version: "LAYAMATERIAL:04",
        props: {
            textures: [],
            type: materialType,
            renderQueue: 2000,
            materialRenderMode: 0,
            s_Cull: 2, // CullMode.Back
            s_Blend: 0,
            s_BlendSrc: 0,
            s_BlendDst: 0,
            s_BlendSrcRGB: 0,
            s_BlendDstRGB: 0,
            s_BlendSrcAlpha: 0,
            s_BlendDstAlpha: 0,
            s_BlendEquation: 0,
            s_BlendEquationRGB: 0,
            s_BlendEquationAlpha: 0,
            s_DepthTest: 1, // DEPTHTEST_LEQUAL
            s_DepthWrite: false, // 天空盒不应该写入深度
            defines: []
        }
    };

    // sky_opaque 使用 u_Texture (Texture2D) - 基于 SkyPanoramic 逻辑
    materialData.props.u_TintColor = [0.5, 0.5, 0.5, 1];
    materialData.props.u_Exposure = 1.3;
    materialData.props.u_Rotation = rotationAngle;
    
    // 添加纹理引用（使用环境贴图的 UUID）
    materialData.props.textures.push({
        path: `res://${resolvedEnvmapUuid}`, // 使用环境贴图的 UUID
        constructParams: [1024, 512, 1, false, false, false], // 默认参数，实际应该从贴图获取
        propertyParams: {
            filterMode: 1,
            wrapModeU: 1,
            wrapModeV: 1,
            anisoLevel: 4
        },
        name: "u_Texture"
    });

    // 创建材质文件（保存到 internal 文件夹）
    // 获取 assets 路径（从 EditorEnv 或 owner 中获取）
    let assetsPath: string | undefined = undefined;
    if (typeof EditorEnv !== "undefined" && EditorEnv.assetsPath) {
        assetsPath = EditorEnv.assetsPath;
    } else if (owner && owner.cocosProjectRoot) {
        // 如果无法获取 EditorEnv，尝试从 owner 推断
        // 这里假设 targetScenePath 在 assets 目录下
        if (targetScenePath) {
            // 找到 assets 目录（向上查找）
            let currentPath = targetScenePath;
            while (currentPath && !currentPath.endsWith("assets")) {
                const parent = path.dirname(currentPath);
                if (parent === currentPath) break; // 到达根目录
                currentPath = parent;
            }
            if (currentPath.endsWith("assets")) {
                assetsPath = currentPath;
            }
        }
    }
    
    if (assetsPath) {
        // 保存到 internal 文件夹
        const internalDir = path.join(assetsPath, "cc-internal");
        const materialFileName = `${materialUuid}.lmat`;
        const materialPath = path.join(internalDir, materialFileName);
        
        // 确保 internal 目录存在
        if (!fs.existsSync(internalDir)) {
            fs.mkdirSync(internalDir, { recursive: true });
        }
        
        // 异步写入材质文件（需要在 complete 阶段执行）
        // 这里我们将材质数据存储到 owner 中，在 complete 阶段写入
        if (!owner._pendingSkyboxMaterials) {
            owner._pendingSkyboxMaterials = [];
        }
        owner._pendingSkyboxMaterials.push({
            path: materialPath,
            data: materialData,
            uuid: materialUuid
        });
    } else {
        console.warn("Skybox: Cannot determine assets path, skybox material will not be saved");
    }

    // 返回材质文件的 UUID（新生成的 UUID），这样 skyRenderer 可以使用正确的材质 UUID
    return materialUuid;
}

/**
 * 转换 Cocos 的 AmbientInfo 到 Laya 的 EnvironmentLighting 属性
 */
export function convertAmbientToLaya(
    ambientInfo: any,
    scene3DNode: any
): void {
    if (!ambientInfo || !scene3DNode)
        return;

    // ambientMode: 0=SolidColor, 1=SphericalHarmonics
    // Cocos 的 AmbientInfo 通常使用 SolidColor 模式
    // 如果 Cocos 有 SphericalHarmonics 数据，可以设置为 1
    // 这里默认使用 SolidColor (0)
    scene3DNode.ambientMode = 0;

    // ambientColor: 从 _skyColor 获取（对应 Cocos 的 "Sky Lighting Color"）
    // 优先使用标准版本 _skyColor，如果没有则使用 HDR 版本，最后才使用 LDR 版本
    // LDR 版本是色调映射后的值，可能不准确
    const skyColor = ambientInfo._skyColor ?? ambientInfo._skyColorHDR ?? ambientInfo._skyColorLDR;
    if (skyColor) {
        // Cocos 的 Vec4 格式是 {x, y, z, w}，需要转换为 {r, g, b, a}
        // 注意：对于 ambientColor，alpha 应该固定为 1，不从 Vec4 的 w 分量获取
        // 因为 Cocos 的 Vec4 的 w 分量可能不是 alpha，而是其他含义（如亮度等）
        let r = skyColor.x ?? skyColor.r ?? 0;
        let g = skyColor.y ?? skyColor.g ?? 0;
        let b = skyColor.z ?? skyColor.b ?? 0;
        
        // 如果值在 0-255 范围内，需要转换为 0-1 范围
        // Cocos 的 _skyColorLDR 通常是 0-1 范围，_skyColor 和 _skyColorHDR 可能是 0-255 范围
        if (r > 1 || g > 1 || b > 1) {
            r = r / 255;
            g = g / 255;
            b = b / 255;
        }
        
        // 确保值在 0-1 范围内
        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));
        
        // 直接创建 Laya 颜色格式，alpha 固定为 1
        scene3DNode.ambientColor = {
            "_$type": "Color",
            r: r,
            g: g,
            b: b,
            a: 1  // ambientColor 不需要 alpha，固定为 1
        };
    }

    // ambientIntensity: 从 _skyIllum 或 _skyIllumLDR 获取
    // 注意：Cocos 的 _skyIllum 是亮度值，可能需要归一化
    const skyIllum = ambientInfo._skyIllumLDR ?? ambientInfo._skyIllum ?? ambientInfo._skyIllumHDR;
    if (skyIllum !== undefined && typeof skyIllum === "number") {
        // Cocos 的亮度值可能很大（如 2400），需要归一化
        // 通常 Laya 的 ambientIntensity 范围是 0-1 或接近 1
        // 这里简单处理：如果值很大，除以一个系数；否则直接使用
        if (skyIllum > 10) {
            scene3DNode.ambientIntensity = skyIllum / 2400; // 归一化到 0-1 范围
        } else {
            scene3DNode.ambientIntensity = Math.max(0, Math.min(1, skyIllum));
        }
    }
}

/**
 * 转换 Cocos 的 FogInfo 到 Laya 的 Fog 属性
 */
export function convertFogToLaya(
    fogInfo: any,
    scene3DNode: any
): void {
    if (!fogInfo || !scene3DNode)
        return;

    // enableFog: 从 _enabled 获取
    const enabled = fogInfo._enabled ?? fogInfo.enabled ?? false;
    scene3DNode.enableFog = enabled;

    // 即使未启用，也要转换其他属性值，以便在 Laya 中启用时能正确显示
    // fogMode: 从 _type 获取
    // Cocos: 0=Linear, 1=EXP, 2=EXP2
    // Laya: 0=Linear, 1=EXP, 2=EXP2
    const fogType = fogInfo._type ?? fogInfo.type ?? 0;
    scene3DNode.fogMode = Math.max(0, Math.min(2, Math.round(fogType)));

    // fogColor: 从 _fogColor 获取
    const fogColor = fogInfo._fogColor ?? fogInfo.fogColor;
    if (fogColor) {
        scene3DNode.fogColor = colorToLayaColor(fogColor);
    }

    // fogStart: 从 _fogStart 获取（仅当 fogMode == 0 时有效）
    const fogStart = fogInfo._fogStart ?? fogInfo.fogStart;
    if (fogStart !== undefined && typeof fogStart === "number" && fogStart >= 0) {
        scene3DNode.fogStart = fogStart;
    }

    // fogEnd: 从 _fogEnd 获取（仅当 fogMode == 0 时有效）
    const fogEnd = fogInfo._fogEnd ?? fogInfo.fogEnd;
    if (fogEnd !== undefined && typeof fogEnd === "number" && fogEnd > 0) {
        scene3DNode.fogEnd = fogEnd;
    }

    // fogDensity: 从 _fogDensity 获取（仅当 fogMode != 0 时有效）
    const fogDensity = fogInfo._fogDensity ?? fogInfo.fogDensity;
    if (fogDensity !== undefined && typeof fogDensity === "number" && fogDensity >= 0) {
        scene3DNode.fogDensity = fogDensity;
    }
}

