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
    if (color)
        comp.color = colorToLayaColor(color);

    // const intensitySource = pickNumber(
    //     [data, shadow, bake],
    //     ["_illuminance", "illuminance", "_intensity", "intensity", "_strength", "strength"]
    // );
    const illuminance = data._illuminance;

    if (illuminance !== undefined) {
        // 获取相机曝光参数
        const cameraData = findCameraData(conversion);
        let exposureVal = 1.0;
        if (cameraData) {
            const aperture = apertureData[cameraData._aperture ?? 19];
            const shutter = shutterData[cameraData._shutter ?? 7];
            const ISO = ISOData[cameraData._iso ?? 0];
            exposureVal = exposure(aperture, shutter, ISO);
        }

        // 最终强度 = lux * exposure
        const finalIntensity = illuminance * exposureVal;
        //comp.strength = finalIntensity;
        comp.intensity = finalIntensity;
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

    const shadowModeRaw = pickNumber([shadow, data], ["pcf", "shadowPcf", "_shadowPcf", "shadowMode", "_shadowMode", "shadowType"]);
    if (shadowModeRaw !== undefined || castShadow !== undefined)
        comp.shadowMode = mapShadowMode(shadowModeRaw, comp.castShadow);

    const shadowStrength = pickNumber([shadow, data], ["intensity", "shadowStrength", "_shadowStrength"]);
    if (shadowStrength !== undefined)
        comp.shadowStrength = clamp(shadowStrength, 0, 1);

    const shadowDistance = pickNumber([shadow, data], ["shadowDistance", "_shadowDistance", "distance", "maxDistance"]);
    if (shadowDistance !== undefined)
        comp.shadowDistance = shadowDistance;

    const shadowDepthBias = pickNumber([shadow, data], ["shadowBias", "_shadowBias", "bias", "depthBias"]);
    if (shadowDepthBias !== undefined)
        comp.shadowDepthBias = shadowDepthBias;

    const shadowNormalBias = pickNumber([shadow, data], ["shadowNormalBias", "_shadowNormalBias", "normalBias"]);
    if (shadowNormalBias !== undefined)
        comp.shadowNormalBias = shadowNormalBias;

    const shadowNearPlane = pickNumber([shadow, data], ["shadowNear", "_shadowNear", "nearPlane", "near"]);
    if (shadowNearPlane !== undefined)
        comp.shadowNearPlane = shadowNearPlane;

    const cascades = pickNumber([shadow, data], ["shadowCsmLevel", "_shadowCsmLevel", "csmLevel", "shadowCascades", "cascades", "cascadeCount"]);
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

