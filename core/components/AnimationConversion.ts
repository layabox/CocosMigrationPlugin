import { registerComponentParser } from "../ComponentParserRegistry";
import { formatUuid } from "../Utils";

registerComponentParser("cc.Animation", ({ owner, node, data }) => {
    return;//暂时不转换
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // Cocos Animation 组件转换为 Laya Animator 组件
    const comp = ensureComponent(node, "Animator");

    // 获取动画剪辑列表
    const clips = data._clips || data.clips || [];
    const defaultClipRef = data._defaultClip || data.defaultClip;

    // 如果有动画剪辑，创建简单的 Animator Controller
    if (clips.length > 0 || defaultClipRef) {
        // 获取默认动画剪辑的 UUID
        let defaultClipUuid: string | undefined;
        if (defaultClipRef?.__uuid__) {
            defaultClipUuid = formatUuid(defaultClipRef.__uuid__, owner);
        } else if (clips.length > 0) {
            // 如果没有指定默认剪辑，使用第一个
            const firstClip = clips[0];
            if (firstClip?.__uuid__) {
                defaultClipUuid = formatUuid(firstClip.__uuid__, owner);
            }
        }

        // 创建简单的控制器层
        const states: Array<Record<string, unknown>> = [];
        if (defaultClipUuid) {
            states.push({
                name: "default",
                _isLooping: 0,
                speed: 1,
                clipEnd: 1,
                x: 0,
                y: 0,
                id: "0",
                clip: {
                    "_$uuid": defaultClipUuid
                }
            });
        }

        const controllerLayer = {
            name: "Layer1",
            defaultStateName: defaultClipUuid ? "default" : undefined,
            playOnWake: data._playOnLoad !== false, // 默认 true
            blendingMode: 0,
            states: states.length > 0 ? states : undefined
        };

        comp.controller = {
            "_$type": "AnimationController",
            controllerLayers: [controllerLayer],
            animatorParams: undefined
        };
    }

    // 转换其他属性
    if (typeof data._cullingMode === "number") {
        // Cocos: 0=Always, 1=CullCompletely
        // Laya: 0=AlwaysAnimate, 2=CullCompletely
        comp.cullingMode = data._cullingMode === 1 ? 2 : 0;
    }

    if (typeof data._sleep === "boolean") {
        comp.sleep = data._sleep;
    }
});

registerComponentParser("cc.SkeletalAnimation", ({ owner, node, data }) => {
    if (!data || null !== data.defaultClip)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // Cocos SkeletalAnimation 组件转换为 Laya Animator 组件
    const comp = ensureComponent(node, "Animator");

    // 获取动画剪辑列表
    const clips = data._clips || data.clips || [];
    const defaultClipRef = data._defaultClip || data.defaultClip;

    // 如果有动画剪辑，创建简单的 Animator Controller
    if (clips.length > 0 || defaultClipRef) {
        // 获取默认动画剪辑的 UUID
        let defaultClipUuid: string | undefined;
        if (defaultClipRef?.__uuid__) {
            defaultClipUuid = formatUuid(defaultClipRef.__uuid__, owner);
        } else if (clips.length > 0) {
            // 如果没有指定默认剪辑，使用第一个
            const firstClip = clips[0];
            if (firstClip?.__uuid__) {
                defaultClipUuid = formatUuid(firstClip.__uuid__, owner);
            }
        }

        // 创建简单的控制器层
        const states: Array<Record<string, unknown>> = [];
        if (defaultClipUuid) {
            states.push({
                name: "default",
                _isLooping: 0,
                speed: 1,
                clipEnd: 1,
                x: 0,
                y: 0,
                id: "0",
                clip: {
                    "_$uuid": defaultClipUuid
                }
            });
        }

        const controllerLayer = {
            name: "Layer1",
            defaultStateName: defaultClipUuid ? "default" : undefined,
            playOnWake: data._playOnLoad !== false, // 默认 true
            blendingMode: 0,
            states: states.length > 0 ? states : undefined
        };

        comp.controller = {
            "_$type": "AnimationController",
            controllerLayers: [controllerLayer],
            animatorParams: undefined
        };
    }

    // 转换其他属性
    if (typeof data._cullingMode === "number") {
        // Cocos: 0=Always, 1=CullCompletely
        // Laya: 0=AlwaysAnimate, 2=CullCompletely
        comp.cullingMode = data._cullingMode === 1 ? 2 : 0;
    }

    if (typeof data._sleep === "boolean") {
        comp.sleep = data._sleep;
    }
});

registerComponentParser("cc.animation.AnimationController", ({ owner, node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // Cocos AnimationController 组件转换为 Laya Animator 组件
    const comp = ensureComponent(node, "Animator");

    // 获取动画图（animgraph）引用
    const graphRef = data._graph || data.graph;
    if (graphRef?.__uuid__) {
        // animgraph 文件会被转换为 .controller 文件
        // 需要将 animgraph UUID 转换为对应的 controller UUID
        const animgraphUuid = graphRef.__uuid__;
        const controllerUuid = formatUuid(animgraphUuid, owner);

        // 在 Laya 中，controller 引用应该指向转换后的 .controller 文件
        // 由于 animgraph 已经转换为 .controller，直接使用转换后的 UUID
        comp.controller = {
            "_$uuid": controllerUuid,
            "_$type": "AnimationController"
        };
    }

    // 转换其他属性
    if (typeof data._cullingMode === "number") {
        // Cocos: 0=Always, 1=CullCompletely
        // Laya: 0=AlwaysAnimate, 2=CullCompletely
        comp.cullingMode = data._cullingMode === 1 ? 2 : 0;
    }

    if (typeof data._sleep === "boolean") {
        comp.sleep = data._sleep;
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

