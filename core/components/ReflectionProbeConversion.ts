import { registerComponentParser } from "../ComponentParserRegistry";
import { colorToLayaColor } from "../PrefabConversion";

type AnyRecord = Record<string, any> | undefined | null;

registerComponentParser("cc.ReflectionProbe", ({ node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    if (node._$type !== "Sprite3D" && node._$type !== "Scene3D")
        node._$type = "Sprite3D";

    const comp = ensureComponent(node, "ReflectionProbe");

    // Volume 基类属性：包围盒
    // Cocos 可能使用 size + center 或 boundsMin + boundsMax
    const boundsMin = extractVector3(data, ["_boundsMin", "boundsMin", "_min", "min"]);
    const boundsMax = extractVector3(data, ["_boundsMax", "boundsMax", "_max", "max"]);
    
    if (boundsMin) {
        comp.boundsMin = boundsMin;
    }
    if (boundsMax) {
        comp.boundsMax = boundsMax;
    }

    // 如果没有 boundsMin/boundsMax，尝试从 size 和 center 计算
    if (!boundsMin || !boundsMax) {
        const size = extractVector3(data, ["_size", "size", "_extent", "extent"]);
        const center = extractVector3(data, ["_center", "center"]);
        
        if (size) {
            // 如果有 size，计算 boundsMin 和 boundsMax
            const halfSize = {
                "_$type": "Vector3",
                x: (size.x || 0) * 0.5,
                y: (size.y || 0) * 0.5,
                z: (size.z || 0) * 0.5
            };
            
            if (center) {
                comp.boundsMin = {
                    "_$type": "Vector3",
                    x: (center.x || 0) - halfSize.x,
                    y: (center.y || 0) - halfSize.y,
                    z: (center.z || 0) - halfSize.z
                };
                comp.boundsMax = {
                    "_$type": "Vector3",
                    x: (center.x || 0) + halfSize.x,
                    y: (center.y || 0) + halfSize.y,
                    z: (center.z || 0) + halfSize.z
                };
            } else {
                // 没有 center，假设中心在原点
                comp.boundsMin = {
                    "_$type": "Vector3",
                    x: -halfSize.x,
                    y: -halfSize.y,
                    z: -halfSize.z
                };
                comp.boundsMax = halfSize;
            }
        }
    }

    // 重要性
    const importance = pickNumber([data], ["_importance", "importance", "_priority", "priority"]);
    if (importance !== undefined) {
        comp.importance = importance;
    }

    // 环境模式 (ambientMode)
    // Laya: 0=SolidColor, 1=SphericalHarmonics
    const ambientMode = pickNumber([data], ["_ambientMode", "ambientMode", "_ambientType", "ambientType", "mode"]);
    if (ambientMode !== undefined) {
        comp.ambientMode = clamp(Math.round(ambientMode), 0, 1);
    }

    // 环境强度
    const ambientIntensity = pickNumber([data], ["_ambientIntensity", "ambientIntensity", "_ambientStrength", "ambientStrength"]);
    if (ambientIntensity !== undefined) {
        comp.ambientIntensity = ambientIntensity;
    }

    // 环境颜色
    const ambientColor = data._ambientColor ?? data.ambientColor;
    if (ambientColor) {
        comp.ambientColor = colorToLayaColor(ambientColor);
    }

    // 反射强度
    const reflectionIntensity = pickNumber([data], ["_reflectionIntensity", "reflectionIntensity", "_intensity", "intensity"]);
    if (reflectionIntensity !== undefined) {
        comp.reflectionIntensity = Math.max(0, reflectionIntensity);
    }

    // 盒投影
    const boxProjection = pickBoolean([data], ["_boxProjection", "boxProjection", "_boxProj", "boxProj"]);
    if (boxProjection !== undefined) {
        comp.boxProjection = boxProjection;
    }

    // HDR
    const enableHDR = pickBoolean([data], ["_enableHDR", "enableHDR", "_hdr", "hdr"]);
    if (enableHDR !== undefined) {
        comp.enableHDR = enableHDR;
    }

    // 清除颜色
    const clearColor = data._clearColor ?? data.clearColor;
    if (clearColor) {
        comp.clearColor = colorToLayaColor(clearColor);
    }

    // 远平面
    const farPlane = pickNumber([data], ["_farPlane", "farPlane", "_far", "far", "_zFar", "zFar"]);
    if (farPlane !== undefined && farPlane > 0) {
        comp.farPlane = farPlane;
    }

    // 近平面
    const nearPlane = pickNumber([data], ["_nearPlane", "nearPlane", "_near", "near", "_zNear", "zNear"]);
    if (nearPlane !== undefined && nearPlane >= 0) {
        comp.nearPlane = nearPlane;
    }

    // 剔除遮罩
    const cullingMask = pickNumber([data], ["_cullingMask", "cullingMask", "_layerMask", "layerMask", "_mask", "mask"]);
    if (cullingMask !== undefined) {
        comp.cullingMask = cullingMask;
    }

    // 清除标志
    // Laya: 0=SolidColor, 1=Sky, 2=DepthOnly, 3=Nothing
    const clearFlag = pickNumber([data], ["_clearFlag", "clearFlag", "_clearMode", "clearMode"]);
    if (clearFlag !== undefined) {
        comp.clearFlag = clamp(Math.round(clearFlag), 0, 3);
    }

    // 分辨率
    const resolution = pickNumber([data], ["_resolution", "resolution", "_res", "res", "_size", "size"]);
    if (resolution !== undefined) {
        // Laya 支持的分辨率：2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048
        const validResolutions = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
        let closestRes = validResolutions[0];
        let minDiff = Math.abs(resolution - closestRes);
        for (const res of validResolutions) {
            const diff = Math.abs(resolution - res);
            if (diff < minDiff) {
                minDiff = diff;
                closestRes = res;
            }
        }
        comp.resolution = closestRes;
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

function extractVector3(source: AnyRecord, keys: string[]): any | undefined {
    if (!source || typeof source !== "object")
        return undefined;
    
    for (const key of keys) {
        const value = source[key];
        if (value && typeof value === "object") {
            // 检查是否是 Vector3 格式 {x, y, z} 或 {_x, _y, _z}
            const x = value.x ?? value._x ?? value[0];
            const y = value.y ?? value._y ?? value[1];
            const z = value.z ?? value._z ?? value[2];
            
            if (typeof x === "number" || typeof y === "number" || typeof z === "number") {
                return {
                    "_$type": "Vector3",
                    x: typeof x === "number" ? x : 0,
                    y: typeof y === "number" ? y : 0,
                    z: typeof z === "number" ? z : 0
                };
            }
        }
    }
    return undefined;
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

