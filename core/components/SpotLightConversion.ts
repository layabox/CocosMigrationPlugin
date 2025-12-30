import { registerComponentParser } from "../ComponentParserRegistry";
import { colorToLayaColor } from "../PrefabConversion";

type AnyRecord = Record<string, any> | undefined | null;

registerComponentParser("cc.SpotLight", ({ node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    if (node._$type !== "Sprite3D" && node._$type !== "Scene3D")
        node._$type = "Sprite3D";

    const shadow = extractShadowSettings(data);
    const bake = extractBakeSettings(data);

    const comp = ensureComponent(node, "SpotLightCom");

    // 颜色
    const color = data._color ?? shadow?._color ?? bake?._color;
    if (color)
        comp.color = colorToLayaColor(color);

    // 强度/亮度
    const intensitySource = pickNumber(
        [data, shadow, bake],
        ["_illuminance", "illuminance", "_intensity", "intensity", "_strength", "strength"]
    );
    if (intensitySource !== undefined) {
        const normalized = normalizeIntensity(intensitySource);
        comp.intensity = normalized;
    }

    // 范围 (range)
    const range = pickNumber([data], ["_range", "range", "_size", "size"]);
    if (range !== undefined) {
        comp.range = range;
    }

    // 聚光灯角度 (spotAngle)
    // Cocos 可能使用 _spotAngle, spotAngle, _angle, angle, _outerAngle, outerAngle
    const spotAngle = pickNumber(
        [data],
        ["_spotAngle", "spotAngle", "_angle", "angle", "_outerAngle", "outerAngle", "_spotSize", "spotSize"]
    );
    if (spotAngle !== undefined) {
        // Laya 的 spotAngle 范围是 0-179 度
        comp.spotAngle = clamp(spotAngle, 0, 179);
    }

    // 混合 (blend) - 可能从内角计算得出
    // 如果 Cocos 有 innerAngle 和 outerAngle，可以用它们计算 blend
    const innerAngle = pickNumber([data], ["_innerAngle", "innerAngle"]);
    const outerAngle = pickNumber([data], ["_outerAngle", "outerAngle", "_spotAngle", "spotAngle", "_angle", "angle"]);
    if (innerAngle !== undefined && outerAngle !== undefined && outerAngle > 0) {
        // blend 表示从内角到外角的衰减，可以用 (outerAngle - innerAngle) / outerAngle 来估算
        const calculatedBlend = Math.max(0, Math.min(1, (outerAngle - innerAngle) / outerAngle));
        comp.blend = calculatedBlend;
    } else {
        // 如果没有内角，尝试直接获取 blend 值
        const blend = pickNumber([data], ["_blend", "blend", "_falloff", "falloff"]);
        if (blend !== undefined) {
            comp.blend = clamp(blend, 0, 1);
        }
    }

    // 烘焙相关属性
    const power = pickNumber([data, bake], ["_power", "power"]);
    if (power !== undefined) {
        comp.power = power;
    }

    const radius = pickNumber([data, bake], ["_radius", "radius"]);
    if (radius !== undefined) {
        comp.radius = radius;
    }

    const maxBounces = pickNumber([data, bake], ["_maxBounces", "maxBounces", "_bounce", "bounce"]);
    if (maxBounces !== undefined) {
        comp.maxBounces = maxBounces;
    }

    const castShadow = pickBoolean([shadow, data], ["enabled", "castShadow", "_shadowEnabled", "shadowEnabled"]);
    if (castShadow !== undefined) {
        comp.castShadow = castShadow;
    }

    // 阴影模式
    const shadowModeRaw = pickNumber([shadow, data], ["pcf", "shadowPcf", "_shadowPcf", "shadowMode", "_shadowMode", "shadowType"]);
    if (shadowModeRaw !== undefined || castShadow !== undefined) {
        comp.shadowMode = mapShadowMode(shadowModeRaw, comp.castShadow);
    }

    const shadowStrength = pickNumber([shadow, data], ["intensity", "shadowStrength", "_shadowStrength"]);
    if (shadowStrength !== undefined) {
        comp.shadowStrength = clamp(shadowStrength, 0, 1);
    }

    const shadowDistance = pickNumber([shadow, data], ["shadowDistance", "_shadowDistance", "distance", "maxDistance"]);
    if (shadowDistance !== undefined) {
        comp.shadowDistance = shadowDistance;
    }

    const shadowDepthBias = pickNumber([shadow, data], ["shadowBias", "_shadowBias", "bias", "depthBias"]);
    if (shadowDepthBias !== undefined) {
        comp.shadowDepthBias = shadowDepthBias;
    }

    const shadowNormalBias = pickNumber([shadow, data], ["shadowNormalBias", "_shadowNormalBias", "normalBias"]);
    if (shadowNormalBias !== undefined) {
        comp.shadowNormalBias = shadowNormalBias;
    }

    const shadowNearPlane = pickNumber([shadow, data], ["shadowNear", "_shadowNear", "nearPlane", "near"]);
    if (shadowNearPlane !== undefined) {
        comp.shadowNearPlane = shadowNearPlane;
    }

    // 烘焙类型
    const bakedType = pickNumber([bake, data], ["_lightmapBakedType", "lightmapBakedType", "type", "mode"]);
    if (bakedType !== undefined) {
        comp.lightmapBakedType = clamp(Math.round(bakedType), 0, 2);
    } else {
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

function normalizeIntensity(value: number): number {
    if (!Number.isFinite(value))
        return 1;
    // Cocos illuminance/luminance can be large values (e.g., 65000 lux)
    // Laya intensity is typically 0-1, with 1 being the default
    // If value > 100, assume it's in lux/lumens and normalize
    if (value > 100) {
        // Cocos default illuminance 65000 -> Laya intensity 1
        const scaled = value / 65000;
        return clamp(Number(scaled.toFixed(3)), 0, 10);
    }
    // If value <= 100, assume it's already a reasonable intensity value
    return clamp(value, 0, 10);
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

