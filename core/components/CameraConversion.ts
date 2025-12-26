import { registerComponentParser } from "../ComponentParserRegistry";
import { colorToLayaColor } from "../PrefabConversion";
import { formatUuid } from "../Utils";

registerComponentParser("cc.Camera", ({ owner, node, data }) => {
    if (!data)
        return;

    node._$type = "Camera";

    const projection = typeof data._projection === "number" ? data._projection : undefined;
    if (projection !== undefined)
        // Cocos Creator: 0 = ORTHO (正交投影), 1 = PERSPECTIVE (透视投影)
        // Laya: orthographic = true 表示正交投影, false 表示透视投影
        node.orthographic = projection === 0;

    if (typeof data._orthoHeight === "number")
        node.orthographicVerticalSize = data._orthoHeight;

    if (typeof data._fov === "number")
        node.fieldOfView = data._fov;

    if (typeof data._near === "number")
        node.nearPlane = data._near;

    if (typeof data._far === "number")
        node.farPlane = data._far;

    if (data._color)
        node.clearColor = colorToLayaColor(data._color);

    if (typeof data._clearFlags === "number")
        node.clearFlag = mapClearFlag(data._clearFlags);

    if (typeof data._visibility === "number")
        node.cullingMask = toUnsigned32(data._visibility);

    const rect = data._rect;
    if (rect && typeof rect === "object") {
        node.normalizedViewport = {
            "_$type": "Viewport",
            x: clamp01(rect.x ?? 0),
            y: clamp01(rect.y ?? 0),
            width: clamp01(rect.width ?? 1),
            height: clamp01(rect.height ?? 1)
        };
    }

    if (hasOwn(data, "_useHDR"))
        node.enableHDR = !!data._useHDR;

    // 自动开启 MSAA
    node.msaa = true;

    if (hasOwn(data, "_fxaa"))
        node.fxaa = !!data._fxaa;

    if (hasOwn(data, "_depthTextureMode") && typeof data._depthTextureMode === "number")
        node.depthTextureMode = clampRange(data._depthTextureMode, 0, 3);

    if (hasOwn(data, "_depthTextureFormat") && typeof data._depthTextureFormat === "number")
        node.depthTextureFormat = data._depthTextureFormat;

    if (hasOwn(data, "_enableBlitDepth"))
        node.enableBlitDepth = !!data._enableBlitDepth;

    if (hasOwn(data, "_opaquePass"))
        node.opaquePass = !!data._opaquePass;

    const targetTexture = data._targetTexture;
    if (targetTexture?.__uuid__) {
        node.renderTarget = {
            "_$uuid": formatUuid(targetTexture.__uuid__, owner),
            "_$type": "RenderTexture"
        };
    }

    const usePostProcess = !!data._usePostProcess;
    const postProcess = data._postProcess;
    if (usePostProcess && postProcess?.__uuid__) {
        node.postProcess = {
            "_$uuid": formatUuid(postProcess.__uuid__, owner),
            "_$type": "PostProcess"
        };
    }
});

function mapClearFlag(flags: number): number {
    const SKYBOX = 0x8;
    const COLOR = 0x1;
    const DEPTH_OR_STENCIL = 0x2 | 0x4;

    if ((flags & SKYBOX) !== 0)
        return 1;
    if ((flags & COLOR) !== 0)
        return 0;
    if ((flags & DEPTH_OR_STENCIL) !== 0)
        return 2;
    return 3;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(1, Math.max(0, value));
}

function toUnsigned32(value: number): number {
    return value >>> 0;
}

function clampRange(value: number, min: number, max: number): number {
    if (!Number.isFinite(value))
        return min;
    if (value < min)
        return min;
    if (value > max)
        return max;
    return value;
}

function hasOwn(target: any, key: string): boolean {
    return target != null && Object.prototype.hasOwnProperty.call(target, key);
}

