import { registerComponentParser } from "../ComponentParserRegistry";
import { colorToLayaColor } from "../PrefabConversion";
import { apertureData, exposure, findCameraData, ISOData, shutterData } from "../Utils";

type AnyRecord = Record<string, any> | undefined | null;

registerComponentParser("cc.DirectionalLight", ({ conversion, owner, node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    if (node._$type !== "Sprite3D" && node._$type !== "Scene3D")
        node._$type = "Sprite3D";

    const shadow = extractShadowSettings(data);
    const bake = extractBakeSettings(data);

    const comp = ensureComponent(node, "DirectionLightCom");

    const color = data._color ?? shadow?._color ?? bake?._color;
    // 颜色超出系数：当色温使得颜色通道 > 1.0 时，需要归一化颜色并将超出部分补偿到 intensity
    let colorOverflowFactor = 1.0;
    if (color) {
        const baseColor = colorToLayaColor(color);
        // 处理色温：Cocos 可以启用色温来修改最终光色
        const useColorTemp = data._useColorTemperature ?? false;
        const colorTemp = data._colorTemperature ?? 6550;
        if (useColorTemp && colorTemp > 0) {
            // 将色温（开尔文）转换为 RGB 乘数，使用 Cocos 引擎相同的 CIE 1960 UCS 算法
            const tempRGB = kelvinToRGB(colorTemp);
            // 将色温 RGB 乘到基础颜色上
            baseColor.r *= tempRGB.r;
            baseColor.g *= tempRGB.g;
            baseColor.b *= tempRGB.b;
        }
        // LayaAir IDE 的 Color 类会修改超出 [0,1] 范围的值
        // 将超出部分归一化到颜色，差值补偿到 intensity
        const maxChannel = Math.max(baseColor.r, baseColor.g, baseColor.b);
        if (maxChannel > 1.0) {
            baseColor.r /= maxChannel;
            baseColor.g /= maxChannel;
            baseColor.b /= maxChannel;
            colorOverflowFactor = maxChannel;
        }
        // 预补偿：LayaAir 引擎会对灯光颜色做 gammaToLinearSpace 转换
        // 存储 linearToGammaSpace(sRGBColor)，经引擎转换后恢复为 sRGB
        // 匹配 Cocos 的 cc_mainLitColor.rgb 直传 sRGB 的行为
        baseColor.r = linearToGammaSpace(baseColor.r);
        baseColor.g = linearToGammaSpace(baseColor.g);
        baseColor.b = linearToGammaSpace(baseColor.b);
        comp.color = baseColor;
    }

    // Cocos 有两种光照强度：
    // - _illuminanceLDR: LDR 模式下的强度乘数（如 3.125），用于 legacy/toon 等非 PBR 管线
    // - _illuminanceHDR / _illuminance: HDR 模式下的照度值（如 120000 lux），用于 PBR 管线
    // LayaAir 的 intensity 是直接乘到光色上的，类似 Cocos 的 cc_mainLitColor.w
    // 优先使用 _illuminanceLDR（toon 项目通常使用 LDR 模式）
    const illuminanceLDR = typeof data._illuminanceLDR === "number" ? data._illuminanceLDR : undefined;
    const illuminanceHDR = data._illuminance ?? data._illuminanceHDR;

    // Cocos 与 LayaAir 灯光管线存在亮度差异（约 2 倍）
    // 经验补偿系数，使转换后场景亮度接近 Cocos 原始效果
    const LDR_INTENSITY_SCALE = 1.0;

    if (illuminanceLDR !== undefined) {
        comp.intensity = illuminanceLDR * LDR_INTENSITY_SCALE * colorOverflowFactor;
        console.log(`[DirectionLightConversion] Using LDR intensity: ${illuminanceLDR} × ${LDR_INTENSITY_SCALE} × overflow ${colorOverflowFactor} = ${comp.intensity}`);
    } else if (illuminanceHDR !== undefined) {
        const cameraData = findCameraData(conversion);
        let exposureVal = 1.0;
        if (cameraData) {
            const aperture = apertureData[cameraData._aperture ?? 19];
            const shutter = shutterData[cameraData._shutter ?? 7];
            const ISO = ISOData[cameraData._iso ?? 0];
            exposureVal = exposure(aperture, shutter, ISO);
        } else {
            const defaultAperture = 16.0;
            const defaultShutter = 125;
            const defaultISO = 100;
            exposureVal = exposure(defaultAperture, defaultShutter, defaultISO);
        }
        const finalIntensity = illuminanceHDR * exposureVal * colorOverflowFactor;
        comp.intensity = finalIntensity;
        console.log(`[DirectionLightConversion] Using HDR intensity: ${illuminanceHDR} × exposure ${exposureVal} × overflow ${colorOverflowFactor} = ${finalIntensity}`);
    }

    const angle = pickNumber([data, shadow], ["_shadowAngle", "shadowAngle", "_angle", "angle"]);
    if (angle !== undefined)
        comp.angle = angle;

    const maxBounces = pickNumber([data, shadow], ["_maxBounces", "maxBounces", "_bounce", "bounce"]);
    if (maxBounces !== undefined)
        comp.maxBounces = maxBounces;

    const castShadow = pickBoolean([shadow, data], ["enabled", "castShadow", "_shadowEnabled", "shadowEnabled"]);
    if (castShadow !== undefined)
        comp.castShadow = castShadow;

    // 场景级阴影检查
    const sceneShadows = (conversion as any).shadowsInfo;
    let isPlanarShadow = false;
    if (sceneShadows) {
        const sceneShadowEnabled = sceneShadows._enabled ?? sceneShadows.enabled;
        // 如果场景级阴影系统被禁用，强制关闭 castShadow
        if (sceneShadowEnabled === false) {
            comp.castShadow = false;
        }
        // Cocos ShadowsInfo._type: 0=ShadowMap, 1=Planar Shadow
        // Planar Shadow 在 Cocos 不使用阴影贴图（几何投影到平面），LayaAir 没有对应模式
        // 解决方案：保留灯光的 CSM 设置，适当增大 shadowDistance 使阴影边界超出可视范围
        // Cocos Planar Shadow 无距离限制，但灯光上仍有 shadowDistance 属性（为 CSM 模式准备）
        const shadowType = sceneShadows._type ?? sceneShadows.type;
        if (shadowType === 1) {
            isPlanarShadow = true;
        }
    }

    const shadowModeRaw = pickNumber([shadow, data], ["pcf", "shadowPcf", "_shadowPcf", "shadowMode", "_shadowMode", "shadowType"]);
    if (shadowModeRaw !== undefined || castShadow !== undefined)
        comp.shadowMode = mapShadowMode(shadowModeRaw, comp.castShadow);

    // 阴影强度
    if (isPlanarShadow && sceneShadows) {
        // Planar Shadow 模式下，阴影强度由 _shadowColor.a 控制（不透明度）
        // Cocos Planar Shadow 是独立的视觉叠加层，不经过 toon shader 的 shadowCover 参数
        // LayaAir 阴影贴图需经过 toon shader 的 shadowCover (默认 0.5) 二次衰减
        // 补偿公式：shadowStrength = alpha / shadowCover = alpha * 2
        const shadowColor = sceneShadows._shadowColor ?? sceneShadows.shadowColor;
        if (shadowColor && shadowColor.a !== undefined) {
            const alpha = shadowColor.a > 1 ? shadowColor.a / 255 : shadowColor.a;
            comp.shadowStrength = clamp(alpha * 2, 0, 1);
        } else {
            comp.shadowStrength = 1;
        }
    } else {
        const shadowStrength = pickNumber([shadow, data], ["shadowSaturation", "_shadowSaturation", "shadowStrength", "_shadowStrength"]);
        if (shadowStrength !== undefined)
            comp.shadowStrength = clamp(shadowStrength, 0, 1);
    }

    const shadowDistance = pickNumber([shadow, data], ["shadowDistance", "_shadowDistance", "distance", "maxDistance"]);
    if (shadowDistance !== undefined) {
        const occlusionRange = pickNumber([shadow, data], ["shadowInvisibleOcclusionRange", "_shadowInvisibleOcclusionRange"]) ?? 0;
        if (isPlanarShadow) {
            // Cocos Planar Shadow 无距离限制，灯光上的 shadowDistance 是给 CSM 模式准备的（较小值如 80）
            // LayaAir 需要阴影贴图替代 Planar Shadow，适当增大使边界推到可视区域外
            comp.shadowDistance = Math.max(shadowDistance * 3, 200);
        } else {
            comp.shadowDistance = Math.max(shadowDistance, occlusionRange, 100);
        }
    } else if (isPlanarShadow) {
        comp.shadowDistance = 200;
    }

    // Cocos 的 shadowBias 语义与 LayaAir 不同：
    // - Cocos: 直接的深度偏移量（如 0.0001，非常小）
    // - LayaAir: 乘以 texelSize 的系数（默认 1.0，实际偏移 = bias * frustumSize/resolution）
    // 不能直接传值，使用 LayaAir 合适的默认值
    // Cocos 的 shadowBias 语义与 LayaAir 不同：
    // - Cocos: 直接的深度偏移量（世界空间，如 0.0001）
    // - LayaAir: texelSize 系数（默认 1.0，实际偏移 = bias × frustumSize / resolution）
    // Cocos Planar Shadow 不使用阴影贴图，灯光上的 bias 值是未调整的默认值
    // 对于 ShadowMap 模式，尝试将 Cocos 的 bias 转换为 LayaAir 的系数
    const shadowDepthBias = pickNumber([shadow, data], ["shadowBias", "_shadowBias", "bias", "depthBias"]);
    if (!isPlanarShadow && shadowDepthBias !== undefined && shadowDepthBias > 0.01) {
        comp.shadowDepthBias = shadowDepthBias;
    } else {
        // Planar Shadow 或 Cocos 默认小 bias → 使用适合 LayaAir 的值
        comp.shadowDepthBias = 1.5;
    }

    // Cocos _shadowNormalBias 直接传递，Planar Shadow 模式下 Cocos 值通常为 0
    const shadowNormalBias = pickNumber([shadow, data], ["shadowNormalBias", "_shadowNormalBias", "normalBias"]);
    comp.shadowNormalBias = shadowNormalBias ?? 0;

    const shadowNearPlane = pickNumber([shadow, data], ["shadowNear", "_shadowNear", "nearPlane", "near"]);
    if (shadowNearPlane !== undefined)
        comp.shadowNearPlane = shadowNearPlane;

    // 阴影贴图分辨率：优先使用灯光自身设置，否则从场景级 ShadowsInfo._size 获取
    const shadowRes = pickNumber([shadow, data], ["shadowMapSize", "_shadowMapSize", "shadowResolution", "_shadowResolution"]);
    if (shadowRes !== undefined) {
        comp.shadowResolution = shadowRes;
    } else {
        const sceneShadows = (conversion as any).shadowsInfo;
        if (sceneShadows) {
            const size = sceneShadows._size ?? sceneShadows.size;
            if (size) {
                const res = size.x ?? size.width ?? 2048;
                comp.shadowResolution = res;
            }
        }
    }

    // 级联模式：保留 Cocos 的 CSM 设置，不因 Planar Shadow 强制覆盖
    const cascades = pickNumber([shadow, data], ["shadowCsmLevel", "_shadowCsmLevel", "csmLevel", "_csmLevel", "shadowCascades", "cascades", "cascadeCount"]);
    if (cascades !== undefined)
        comp.shadowCascadesMode = mapShadowCascades(cascades);

    const bakedType = pickNumber([bake, data], ["_lightmapBakedType", "lightmapBakedType", "type", "mode"]);
    if (bakedType !== undefined)
        comp.lightmapBakedType = clamp(Math.round(bakedType), 0, 2);
    else {
        const bakeable = pickBoolean([bake, data], ["_bakeable", "bakeable", "isBaked"]);
        if (bakeable !== undefined)
            comp.lightmapBakedType = bakeable ? 2 : 1;
    }
});


function ensureComponent(node: any, type: string): any {
    let comp = node._$comp.find((item: any) => item._$type === type);
    if (!comp) {
        comp = { "_$type": type };
        node._$comp.push(comp);
    }
    return comp;
}

function extractShadowSettings(data: AnyRecord): AnyRecord {
    if (!data || typeof data !== "object")
        return undefined;
    const candidates = [
        data.shadow,
        data._shadow,
        data.shadowSettings,
        data._shadowSettings,
        data.shadowInfo,
        data._shadowInfo,
        data.shadowData,
        data._shadowData,
        data.staticSettings?.shadow,
        data._staticSettings?.shadow
    ];
    return candidates.find(item => item && typeof item === "object");
}

function extractBakeSettings(data: AnyRecord): AnyRecord {
    if (!data || typeof data !== "object")
        return undefined;
    const candidates = [
        data.bakeSettings,
        data._bakeSettings,
        data.lightmapSettings,
        data._lightmapSettings,
        data.staticSettings?.bake,
        data._staticSettings?.bake,
        data.staticSettings?.bakeSettings,
        data._staticSettings?.bakeSettings
    ];
    return candidates.find(item => item && typeof item === "object");
}

function pickNumber(sources: AnyRecord[], keys: string[]): number | undefined {
    for (const source of sources) {
        if (!source || typeof source !== "object")
            continue;
        for (const key of keys) {
            const value = source[key];
            if (typeof value === "number" && Number.isFinite(value))
                return value;
        }
    }
    return undefined;
}

function pickBoolean(sources: AnyRecord[], keys: string[]): boolean | undefined {
    for (const source of sources) {
        if (!source || typeof source !== "object")
            continue;
        for (const key of keys) {
            const value = source[key];
            if (typeof value === "boolean")
                return value;
        }
    }
    return undefined;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, value));
}

function mapShadowMode(value: number | undefined, castShadow?: boolean): number {
    if (!castShadow)
        return 0;
    if (value === undefined)
        return 1;
    const normalized = Math.max(0, Math.floor(value));
    switch (normalized) {
        case 0:
            return 1;
        case 1:
            return 2;
        case 2:
        default:
            return 3;
    }
}

function mapShadowCascades(value: number): number {
    if (!Number.isFinite(value))
        return 0;
    if (value <= 1)
        return 0;
    if (value <= 2)
        return 1;
    return 2;
}

/**
 * linearToGammaSpace: gammaToLinearSpace 的逆函数
 * LayaAir 引擎的 gammaToLinearSpace 使用完整 sRGB 标准曲线：
 *   if (v <= 0.04045) return v / 12.92;
 *   else return pow((v + 0.055) / 1.055, 2.4);
 * 此函数做反向转换，使得 gammaToLinearSpace(linearToGammaSpace(x)) = x
 */
function linearToGammaSpace(value: number): number {
    if (value <= 0.0) return 0.0;
    if (value >= 1.0) return 1.0;
    // sRGB 标准逆转换
    if (value <= 0.0031308)
        return value * 12.92;
    else
        return 1.055 * Math.pow(value, 1.0 / 2.4) - 0.055;
}

/**
 * 将色温（开尔文）转换为 RGB 乘数
 * 使用 Cocos Creator 引擎完全相同的算法：CIE 1960 UCS Planckian locus + XYZ to BT.709 RGB
 * 参考: cocos/render-scene/scene/light.ts → ColorTemperatureToRGB
 */
function kelvinToRGB(kelvin: number): { r: number; g: number; b: number } {
    // Cocos 限制范围 1000~15000K
    if (kelvin < 1000) kelvin = 1000;
    else if (kelvin > 15000) kelvin = 15000;

    // Approximate Planckian locus in CIE 1960 UCS
    const kSqr = kelvin * kelvin;
    const u = (0.860117757 + 1.54118254e-4 * kelvin + 1.28641212e-7 * kSqr)
            / (1.0 + 8.42420235e-4 * kelvin + 7.08145163e-7 * kSqr);
    const v = (0.317398726 + 4.22806245e-5 * kelvin + 4.20481691e-8 * kSqr)
            / (1.0 - 2.89741816e-5 * kelvin + 1.61456053e-7 * kSqr);

    const d = (2.0 * u - 8.0 * v + 4.0);
    const x = (3.0 * u) / d;
    const y = (2.0 * v) / d;
    const z = (1.0 - x) - y;

    const X = (1.0 / y) * x;
    const Z = (1.0 / y) * z;

    // XYZ to RGB with BT.709 primaries
    return {
        r:  3.2404542 * X + -1.5371385 + -0.4985314 * Z,
        g: -0.9692660 * X +  1.8760108 +  0.0415560 * Z,
        b:  0.0556434 * X + -0.2040259 +  1.0572252 * Z
    };
}

