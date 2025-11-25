import { registerComponentParser } from "../ComponentParserRegistry";
import { colorToLayaColor } from "../PrefabConversion";

type AnyRecord = Record<string, any> | undefined | null;

registerComponentParser("cc.PointLight", ({ node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    if (node._$type !== "Sprite3D" && node._$type !== "Scene3D")
        node._$type = "Sprite3D";

    const shadow = extractShadowSettings(data);
    const bake = extractBakeSettings(data);

    const comp = ensureComponent(node, "PointLightCom");

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

    // 阴影模式（PointLight 通常不支持阴影，但保留兼容性）
    // 注意：Laya 的 PointLightCom 中 shadowMode 是隐藏的，所以不设置

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
    if (value <= 10)
        return clamp(value, 0, 10);
    const scaled = value / 6500;
    return clamp(Number(scaled.toFixed(3)), 0, 10);
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, value));
}

