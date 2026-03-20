import { registerComponentParser } from "../ComponentParserRegistry";
import { formatUuid } from "../Utils";

function generateUuid(): string {
    // 生成 8-4-4-4-12 格式的 UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

registerComponentParser("cc.Animation", ({ conversion, owner, node, data, is2d }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // 获取动画剪辑列表
    const clips = data._clips || data.clips || [];
    const defaultClipRef = data._defaultClip || data.defaultClip;
    const playOnLoad = data.playOnLoad ?? false;

    if (is2d) {
        // ========== 2D 场景：cc.Animation → Animator2D ==========
        const comp = ensureComponent(node, "Animator2D");

        // 解析所有动画剪辑的 UUID
        const clipUuids: string[] = [];
        for (const clipRef of clips) {
            if (clipRef?.__uuid__) {
                const uuid = formatUuid(clipRef.__uuid__, owner);
                if (uuid) clipUuids.push(uuid);
            }
        }

        // 解析默认剪辑 UUID
        let defaultClipUuid: string | undefined;
        if (defaultClipRef?.__uuid__) {
            defaultClipUuid = formatUuid(defaultClipRef.__uuid__, owner);
        }

        // 构建 Animator2D 的 states 列表
        const states: Array<Record<string, unknown>> = [];
        let stateId = 0;
        let defaultStateName = "";

        for (let i = 0; i < clipUuids.length; i++) {
            const uuid = clipUuids[i];
            const clipName = getClipNameFromUuid(clips[i]?.__uuid__, owner) || `clip_${i}`;

            const state: Record<string, unknown> = {
                "name": clipName,
                "clip": { "_$uuid": uuid },
                "loop": -1,
                "speed": 1,
                "clipEnd": 1,
                "x": 200 + i * 200,
                "y": 300,
                "id": String(stateId),
                "loopState": 0
            };
            states.push(state);

            if (defaultClipUuid && uuid === defaultClipUuid) {
                defaultStateName = clipName;
            }
            stateId++;
        }

        if (!defaultStateName && states.length > 0) {
            defaultStateName = states[0].name as string;
        }

        // 添加"进入"特殊节点（id: "-1"）
        const enterState: Record<string, unknown> = {
            "x": 10, "y": 100,
            "loopState": 0, "_isLooping": 0,
            "id": "-1", "name": "进入",
            "speed": 1, "clipEnd": 1,
        };
        if (defaultStateName) {
            const defaultState = states.find(s => s.name === defaultStateName);
            if (defaultState) {
                enterState.soloTransitions = [{ "id": defaultState.id }];
            }
        }
        states.push(enterState);

        // 添加"任何状态"特殊节点（id: "-2"）
        states.push({
            "x": 550, "y": 100,
            "loopState": 0, "_isLooping": 0,
            "id": "-2", "name": "任何状态",
            "speed": 1, "clipEnd": 1
        });

        // 构建 .mcc 控制器数据
        const mccData: Record<string, unknown> = {
            "_$type": "Animator2D",
            "enabled": true,
            "controllerLayers": [
                {
                    "name": "Base Layer",
                    "defaultStateName": defaultStateName,
                    "playOnWake": playOnLoad,
                    "blendingMode": 0,
                    "states": states,
                    "defaultWeight": 1
                }
            ],
            "layerW": 150
        };

        // 生成 .mcc UUID 并加入待处理列表
        const mccUuid = generateUuid();

        // 确定 .mcc 文件输出路径（基于场景文件路径）
        const scenePath = (conversion as any).currentTargetPath as string;
        if (scenePath) {
            const nodeName = node.name || "animation";
            // 兼容 / 和 \ 路径分隔符
            const lastSep = Math.max(scenePath.lastIndexOf("/"), scenePath.lastIndexOf("\\"));
            const dir = lastSep >= 0 ? scenePath.substring(0, lastSep + 1) : "";
            const sceneFileName = lastSep >= 0 ? scenePath.substring(lastSep + 1) : scenePath;
            const sceneBaseName = sceneFileName.replace(/\.[^.]+$/, "");
            const mccPath = `${dir}${sceneBaseName}_${nodeName}.mcc`;

            if (!owner._pendingAnimation2DControllers) {
                owner._pendingAnimation2DControllers = [];
            }
            owner._pendingAnimation2DControllers.push({
                path: mccPath,
                data: mccData,
                uuid: mccUuid
            });
        }

        // 在 Animator2D 组件上设置 controller 引用（而非 inline controllerLayers）
        comp.controller = {
            "_$uuid": mccUuid,
            "_$type": "AnimationController2D"
        };
    } else {
        // ========== 3D 场景：cc.Animation → Animator（原有逻辑） ==========
        const comp = ensureComponent(node, "Animator");

        // 设置 cullingMode，默认为 0
        comp.cullingMode = 0;
        if (typeof data._cullingMode === "number") {
            comp.cullingMode = data._cullingMode === 1 ? 2 : 0;
        }

        let defaultClipUuid: string | undefined;
        if (defaultClipRef?.__uuid__) {
            defaultClipUuid = formatUuid(defaultClipRef.__uuid__, owner);
        } else if (clips.length > 0) {
            const firstClip = clips[0];
            if (firstClip?.__uuid__) {
                defaultClipUuid = formatUuid(firstClip.__uuid__, owner);
            }
        }

        const states: Array<Record<string, unknown>> = [];
        if (defaultClipUuid) {
            states.push({
                "_$type": "AnimatorState",
                "name": "BaseLayer",
                "clipStart": 0,
                "clip": {
                    "_$uuid": defaultClipUuid,
                    "_$type": "AnimationClip"
                },
                "soloTransitions": []
            });
        }

        if (states.length > 0) {
            comp.controllerLayers = [
                {
                    "_$type": "AnimatorControllerLayer",
                    "name": "BaseLayer",
                    "states": states,
                    "defaultStateName": "BaseLayer"
                }
            ];
        }
    }
});

registerComponentParser("cc.SkeletalAnimation", ({ owner, node, data, is2d }) => {
    if (!data || is2d)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // Cocos SkeletalAnimation 组件转换为 Laya Animator 组件
    const comp = ensureComponent(node, "Animator");

    // 设置 cullingMode，默认为 0
    comp.cullingMode = 0;
    if (typeof data._cullingMode === "number") {
        // Cocos: 0=Always, 1=CullCompletely
        // Laya: 0=AlwaysAnimate, 2=CullCompletely
        comp.cullingMode = data._cullingMode === 1 ? 2 : 0;
    }

    // 获取动画剪辑列表
    const clips = data._clips || data.clips || [];
    const defaultClipRef = data._defaultClip || data.defaultClip;

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

    // 创建 controllerLayers
    const states: Array<Record<string, unknown>> = [];
    if (defaultClipUuid) {
        states.push({
            "_$type": "AnimatorState",
            "name": "BaseLayer",
            "clipStart": 0,
            "clip": {
                "_$uuid": defaultClipUuid,
                "_$type": "AnimationClip"
            },
            "soloTransitions": []
        });
    }

    if (states.length > 0) {
        comp.controllerLayers = [
            {
                "_$type": "AnimatorControllerLayer",
                "name": "BaseLayer",
                "states": states,
                "defaultStateName": "BaseLayer"
            }
        ];
    }
});

registerComponentParser("cc.animation.AnimationController", ({ owner, node, data, is2d }) => {
    if (!data || is2d)
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

/**
 * 从 Cocos UUID 获取动画剪辑名称
 * 查找 allAssets 中对应的 meta 信息获取名称
 */
function getClipNameFromUuid(cocosUuid: string, owner: any): string {
    if (!cocosUuid) return "";

    // allAssets 的 key 就是 uuid，value 是 { sourcePath, userData }
    if (owner?.allAssets) {
        const assetInfo = owner.allAssets.get(cocosUuid);
        if (assetInfo) {
            // 从 userData.name 获取名称
            const name = assetInfo.userData?.name;
            if (name) return name;

            // 从文件路径提取名称
            const sourcePath = assetInfo.sourcePath || "";
            const fileName = sourcePath.split("/").pop()?.replace(/\.anim$/i, "") || "";
            if (fileName) return fileName;
        }
    }

    // 回退：使用 UUID 的前 8 位
    return cocosUuid.substring(0, 8);
}

function ensureComponent(node: any, type: string): any {
    let comp = node._$comp.find((item: any) => item._$type === type);
    if (!comp) {
        comp = { "_$type": type };
        node._$comp.push(comp);
    }
    return comp;
}
