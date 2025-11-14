import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import { formatUuid } from "../Utils";
import fpath from "path";

interface ICocosRef {
    __id__: number;
}

interface ILayaState extends Record<string, unknown> {
    id: string;
    name?: string;
}

interface ILayaTransition extends Record<string, unknown> {
    id: string;
    exitByTime?: boolean;
    exitTime?: number;
    transduration?: number;
    conditions?: Array<Record<string, unknown>>;
}

interface ICollectedTransition {
    entry: ILayaTransition;
    raw: any;
}

export class AnimGraphConversion implements ICocosAssetConversion {
    constructor(private owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        try {
            const cocosGraph: any[] = await IEditorEnv.utils.readJsonAsync(sourcePath);
            const controller = this.convertGraph(cocosGraph);

            targetPath = targetPath.replace(/\.animgraph$/i, ".controller");
            await IEditorEnv.utils.writeJsonAsync(targetPath, controller);
            await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
        }
        catch (err) {
            console.error("Failed to convert animgraph:", sourcePath, err);
            throw err;
        }
    }

    private convertGraph(nodes: any[]): any {
        if (!Array.isArray(nodes) || nodes.length === 0)
            return this.createEmptyController();

        const root = nodes[0];
        this.variableIndexMap = new Map();
        const animatorParams = this.convertVariables(nodes, root?._variables);
        const layerRefs: ICocosRef[] = root?._layers ?? [];

        const controllerLayers: Array<Record<string, unknown>> = [];
        layerRefs.forEach((ref, index) => {
            const layerObj = this.getNode(nodes, ref);
            const stateMachine = this.getNode(nodes, layerObj?._stateMachine);
            const converted = this.convertLayer(nodes, layerObj, stateMachine, index);
            if (converted)
                controllerLayers.push(converted);
        });

        return {
            "_$type": "Animator",
            enabled: true,
            cullingMode: 2,
            controllerLayers,
            animatorParams,
            sleep: false,
            layerW: 150
        };
    }

    private convertLayer(nodes: any[], layerObj: any, stateMachine: any, index: number): Record<string, unknown> | null {
        if (!stateMachine)
            return null;

        const {
            states,
            defaultStateName
        } = this.convertStateMachine(nodes, stateMachine);

        return {
            name: layerObj?.name || `Layer${index + 1}`,
            defaultStateName: defaultStateName ?? (states.find((s: any) => !["-1", "-2"].includes(s.id))?.name ?? ""),
            playOnWake: layerObj?.playOnWake ?? true,
            blendingMode: layerObj?.blendingMode ?? 0,
            states,
            defaultWeight: layerObj?.weight ?? 1
        };
    }

    private convertStateMachine(nodes: any[], stateMachine: any): {
        states: ILayaState[];
        defaultStateName?: string;
    } {
        const stateRefs: ICocosRef[] = stateMachine?._states ?? [];
        const transitions: any[] = (stateMachine?._transitions ?? [])
            .map((ref: ICocosRef) => this.getNode(nodes, ref))
            .filter(Boolean);

        const entryRef = stateMachine?._entryState;
        const anyRef = stateMachine?._anyState;
        const exitRef = stateMachine?._exitState;

        const entryNode = this.getNode(nodes, entryRef);
        const anyNode = this.getNode(nodes, anyRef);
        const exitNode = this.getNode(nodes, exitRef);

        const stateIdMap = new Map<number, string>();
        const convertedStates: ILayaState[] = [];
        let stateIndex = 0;

        // 处理所有状态（包括 Motion 和 Sub-State Machine）
        const allStates = stateRefs
            .map(ref => ({ refId: ref.__id__, node: this.getNode(nodes, ref) }))
            .filter(item => item.node);

        for (const { refId, node } of allStates) {
            // 检查是否是子状态机（Sub-State Machine）
            const subStateMachineRef = node._stateMachine || node.stateMachine;
            if (subStateMachineRef) {
                // 这是一个子状态机，需要递归转换
                const subStateMachine = this.getNode(nodes, subStateMachineRef);
                if (subStateMachine) {
                    const stateId = String(stateIndex++);
                    stateIdMap.set(refId, stateId);
                    const position = this.getNodePosition(node, { x: stateIndex * 120, y: 120 });

                    // 递归转换子状态机
                    const subMachineResult = this.convertStateMachine(nodes, subStateMachine);
                    
                    // 获取视图属性
                    const extras = node?.__editorExtras__;
                    const stageX = extras?.stageX;
                    const stageY = extras?.stageY;
                    const stageScale = extras?.stageScale;

                    const layaState: ILayaState = {
                        name: node.name || `SubState${stateId}`,
                        x: position.x,
                        y: position.y,
                        id: stateId,
                        states: subMachineResult.states.length > 0 ? subMachineResult.states : undefined
                    };

                    // 添加视图属性
                    if (typeof stageX === "number")
                        layaState.stageX = stageX;
                    if (typeof stageY === "number")
                        layaState.stageY = stageY;
                    if (typeof stageScale === "number")
                        layaState.stageScale = stageScale;

                    const stateTransitionsRaw = this.collectTransitions(nodes, transitions, refId, stateIdMap);
                    if (stateTransitionsRaw.length > 0)
                        layaState.soloTransitions = stateTransitionsRaw.map(t => t.entry);

                    convertedStates.push(layaState);
                }
            } else if (node.__type__ === "cc.animation.Motion") {
                // 检查 Motion 的 motion 是否指向 AnimationBlend1D（可能是子状态机）
                const motionRef = node.motion;
                const motionTarget = motionRef ? this.getNode(nodes, motionRef) : null;
                const isSubStateMachine = motionTarget?.__type__ === "cc.animation.AnimationBlend1D" 
                    && motionTarget.__editorExtras__?.viewport;

                if (isSubStateMachine) {
                    // 这是一个子状态机（AnimationBlend1D 作为文件夹）
                    const stateId = String(stateIndex++);
                    stateIdMap.set(refId, stateId);
                    const position = this.getNodePosition(node, { x: stateIndex * 120, y: 120 });

                    // 转换 AnimationBlend1D 为子状态机
                    const subStates = this.convertAnimationBlend1DToSubStateMachine(nodes, motionTarget);
                    
                    // 获取视图属性（从 AnimationBlend1D 的 viewport）
                    const viewport = motionTarget.__editorExtras__?.viewport;
                    const stageX = viewport?.left;
                    const stageY = viewport?.top;
                    const stageScale = viewport?.scale;

                    const layaState: ILayaState = {
                        name: node.name || motionTarget.name || `SubState${stateId}`,
                        x: position.x,
                        y: position.y,
                        id: stateId,
                        states: subStates.length > 0 ? subStates : undefined
                    };

                    // 添加视图属性
                    if (typeof stageX === "number")
                        layaState.stageX = stageX;
                    if (typeof stageY === "number")
                        layaState.stageY = stageY;
                    if (typeof stageScale === "number")
                        layaState.stageScale = stageScale;

                    const stateTransitionsRaw = this.collectTransitions(nodes, transitions, refId, stateIdMap);
                    if (stateTransitionsRaw.length > 0)
                        layaState.soloTransitions = stateTransitionsRaw.map(t => t.entry);

                    convertedStates.push(layaState);
                } else {
                    // 普通 Motion 状态
                    const stateId = String(stateIndex++);
                    stateIdMap.set(refId, stateId);

                    const motionInfo = this.resolveMotion(nodes, node);
                    const position = this.getNodePosition(node, { x: stateIndex * 120, y: 120 });

                    const layaState: ILayaState = {
                        name: node.name || `State${stateId}`,
                        loop: -1,
                        speed: node.speed ?? 1,
                        clipEnd: 1,
                        x: position.x,
                        y: position.y,
                        id: stateId,
                        _isLooping: motionInfo?.isLooping ?? 0
                    };

                    if (motionInfo?.clipUuid) {
                        layaState.clip = {
                            "_$uuid": motionInfo.clipUuid
                        };
                    }

                    const stateTransitionsRaw = this.collectTransitions(nodes, transitions, refId, stateIdMap);
                    if (stateTransitionsRaw.length > 0)
                        layaState.soloTransitions = stateTransitionsRaw.map(t => t.entry);

                    convertedStates.push(layaState);
                }
            }
        }

        const entryTransitionsRaw = this.collectTransitions(nodes, transitions, entryRef?.__id__, stateIdMap);
        const entryTransitions = entryTransitionsRaw.map(item => item.entry);
        const defaultState = entryTransitionsRaw.length > 0
            ? convertedStates.find(s => s.id === entryTransitionsRaw[0].entry.id)
            : convertedStates[0];

        const entryPosition = this.getNodePosition(entryNode, { x: 10, y: 100 });
        convertedStates.push({
            x: entryPosition.x,
            y: entryPosition.y,
            _isLooping: 0,
            id: "-1",
            name: entryNode?.name || "Entry",
            speed: 1,
            clipEnd: 1,
            soloTransitions: entryTransitions.length > 0 ? entryTransitions : undefined
        });

        const anyTransitions = this.collectTransitions(nodes, transitions, anyRef?.__id__, stateIdMap)
            .map(item => item.entry);

        const anyPosition = this.getNodePosition(anyNode, { x: entryPosition.x + 200, y: entryPosition.y });
        convertedStates.push({
            x: anyPosition.x,
            y: anyPosition.y,
            _isLooping: 0,
            id: "-2",
            name: anyNode?.name || "Any State",
            speed: 1,
            clipEnd: 1,
            soloTransitions: anyTransitions.length > 0 ? anyTransitions : undefined
        });

        // 添加 Exit 状态（如果存在）
        if (exitNode) {
            const exitPosition = this.getNodePosition(exitNode, { x: anyPosition.x, y: anyPosition.y + 150 });
            convertedStates.push({
                x: exitPosition.x,
                y: exitPosition.y,
                _isLooping: 0,
                id: "-3",
                name: exitNode?.name || "Exit",
                speed: 1,
                clipEnd: 1
            });
        }

        return {
            states: convertedStates,
            defaultStateName: defaultState?.name
        };
    }

    private convertAnimationBlend1DToSubStateMachine(nodes: any[], blend1D: any): ILayaState[] {
        const states: ILayaState[] = [];
        
        // 转换 AnimationBlend1D 的 items 为状态
        const items = blend1D._items || [];
        let itemIndex = 0;
        const itemStates: ILayaState[] = [];
        const usedNames = new Set<string>(); // 用于跟踪已使用的名字，避免重名
        
        for (const itemRef of items) {
            const item = this.getNode(nodes, itemRef);
            if (!item)
                continue;

            const itemMotionRef = item.motion;
            const itemMotion = itemMotionRef ? this.getNode(nodes, itemMotionRef) : null;
            
            if (itemMotion?.__type__ === "cc.animation.ClipMotion") {
                const rawUuid: string | undefined = itemMotion.clip?.__uuid__;
                if (typeof rawUuid === "string") {
                    const clipAsset = this.owner.allAssets.get(rawUuid);
                    // 始终使用默认值（0），不根据 wrapMode 设置
                    // 如果 Cocos 没有明确设置循环，应该使用默认值
                    let isLooping = 0; // 默认

                    // 获取动画剪辑的名字
                    let clipName: string | undefined;
                    if (clipAsset?.userData?.__layaSubName) {
                        // 从 __layaSubName 中提取名字（格式：name.ext）
                        const subName = clipAsset.userData.__layaSubName;
                        const ext = fpath.extname(subName);
                        clipName = subName.substring(0, subName.length - ext.length);
                    } else {
                        // 尝试从 IDE 的 assetMgr 中获取
                        const parentUUID = rawUuid.split("@")[0];
                        const assetInfo = EditorEnv.assetMgr.getAsset(parentUUID);
                        if (assetInfo && assetInfo.children) {
                            for (const child of assetInfo.children) {
                                if (child.id === rawUuid || child.id.endsWith(rawUuid.split("@")[1] || "")) {
                                    // 从文件名中提取名字（去掉扩展名）
                                    const ext = fpath.extname(child.fileName);
                                    clipName = child.fileName.substring(0, child.fileName.length - ext.length);
                                    break;
                                }
                            }
                        }
                    }

                    // 确保名字唯一
                    let finalName = clipName || itemMotion.name || blend1D.name || `State${itemIndex}`;
                    let nameIndex = 1;
                    while (usedNames.has(finalName)) {
                        finalName = `${clipName || itemMotion.name || blend1D.name || `State${itemIndex}`}_${nameIndex}`;
                        nameIndex++;
                    }
                    usedNames.add(finalName);

                    const clipUuid = formatUuid(rawUuid, this.owner);
                    const itemPosition = this.getNodePosition(itemMotion, { 
                        x: -89.60849504698342 + itemIndex * 100, 
                        y: -16.801432311342808 
                    });

                    const stateId = String(itemIndex);
                    const itemState: ILayaState = {
                        x: itemPosition.x,
                        y: itemPosition.y,
                        _isLooping: isLooping,
                        id: stateId,
                        name: finalName,
                        speed: 1,
                        clipEnd: 1,
                        clip: {
                            "_$uuid": clipUuid
                        }
                    };
                    
                    itemStates.push(itemState);
                    itemIndex++;
                }
            }
        }

        // 添加实际的状态
        states.push(...itemStates);

        // 创建 Entry 状态（在最后，因为需要引用第一个状态）
        const entryState: ILayaState = {
            x: -432.76515151515156,
            y: -17.2348484848485,
            _isLooping: 0,
            id: "-1",
            name: "Entry",
            speed: 1,
            clipEnd: 1
        };
        
        // Entry 转换到第一个状态
        if (itemStates.length > 0) {
            entryState.soloTransitions = [{
                id: itemStates[0].id,
                exitByTime: false,
                exitTime: 0,
                transduration: 0
            }];
        }
        states.push(entryState);

        // 创建 Any State 状态
        states.push({
            x: -86.33341392649908,
            y: -167.23081882656356,
            _isLooping: 0,
            id: "-2",
            name: "Any",
            speed: 1,
            clipEnd: 1
        });

        // 创建 Exit 状态
        states.push({
            x: 125,
            y: 0,
            _isLooping: 0,
            id: "-3",
            name: "Exit",
            speed: 1,
            clipEnd: 1
        });

        return states;
    }

    private resolveMotion(nodes: any[], motionNode: any) {
        const motionRef = motionNode?.motion;
        if (!motionRef)
            return null;

        const motion = this.getNode(nodes, motionRef);
        if (!motion)
            return null;

        if (motion.__type__ === "cc.animation.ClipMotion") {
            const rawUuid: string | undefined = motion.clip?.__uuid__;
            if (typeof rawUuid === "string") {
                // 始终使用默认值（0），不根据 wrapMode 设置
                // 如果 Cocos 没有明确设置循环，应该使用默认值
                let isLooping = 0; // 默认

                return {
                    clipUuid: formatUuid(rawUuid, this.owner),
                    isLooping
                };
            }
        }

        return null;
    }

    private collectTransitions(nodes: any[], transitions: any[], fromId: number | undefined, stateIdMap: Map<number, string>): ICollectedTransition[] {
        if (fromId === undefined || fromId === null)
            return [];

        const results: ICollectedTransition[] = [];
        for (const transition of transitions) {
            const fromRefId = transition?.from?.__id__;
            if (fromRefId !== fromId)
                continue;

            const toRefId = transition?.to?.__id__;
            const targetId = stateIdMap.get(toRefId);
            if (!targetId)
                continue;

            const conditions = Array.isArray(transition.conditions)
                ? transition.conditions
                    .map((ref: ICocosRef) => this.getNode(nodes, ref))
                    .filter(Boolean)
                    .map((cond: any) => this.convertCondition(cond))
                : undefined;

            const entry: ILayaTransition = {
                id: targetId,
                exitByTime: !!transition.exitConditionEnabled,
                exitTime: transition._exitCondition ?? 0,
                transduration: transition.duration ?? 0,
                conditions: conditions && conditions.length > 0 ? conditions : undefined
            };

            results.push({ entry, raw: transition });
        }

        return results;
    }

    private convertVariables(nodes: any[], variableMap: Record<string, ICocosRef> | undefined | null): Array<Record<string, unknown>> {
        if (!variableMap)
            return [];

        const result: Array<Record<string, unknown>> = [];
        let index = 0;
        for (const [name, ref] of Object.entries(variableMap)) {
            const node = this.getNode(nodes, ref);
            const converted = this.convertVariableNode(node);
            if (!converted)
                continue;

            this.variableIndexMap.set(name, index);
            result.push({
                id: index++,
                name,
                type: converted.type,
                val: converted.value
            });
        }
        return result;
    }

    private convertVariableNode(node: any): { type: number; value: any } | null {
        if (!node || typeof node !== "object")
            return null;

        switch (node.__type__) {
            case "cc.animation.PlainVariable": {
                const cocosType: number = typeof node._type === "number" ? node._type : 0;
                const rawValue = node._value;
                let type = 0;
                let value: any = rawValue ?? 0;
                if (cocosType === 2 || typeof rawValue === "boolean") {
                    type = 1;
                    value = !!rawValue;
                }
                else {
                    type = 0;
                    value = typeof rawValue === "number" ? rawValue : Number(rawValue ?? 0);
                }
                return { type, value };
            }
            case "cc.animation.TriggerVariable":
                return { type: 2, value: 0 };
            default:
                return null;
        }
    }

    private convertCondition(condition: any): { type: number; id: number } | null {
        switch (condition?.__type__) {
            case "cc.animation.TriggerCondition":
                return {
                    type: 2,
                    id: this.getParameterIndex(condition.trigger)
                };
            case "cc.animation.BinaryCondition":
                return {
                    type: 1,
                    id: this.getParameterIndex(condition.parameter)
                };
            default:
                return null;
        }
    }

    private getParameterIndex(name: string | undefined): number {
        if (typeof name !== "string")
            return -1;
        return this.variableIndexMap.get(name) ?? -1;
    }

    private getNode(nodes: any[], ref: ICocosRef | undefined): any {
        if (!ref || typeof ref.__id__ !== "number")
            return null;
        return nodes[ref.__id__] ?? null;
    }

    private getNodePosition(node: any, fallback: { x: number, y: number }) {
        const extras = node?.__editorExtras__;
        if (extras && typeof extras.centerX === "number" && typeof extras.centerY === "number") {
            return { x: extras.centerX, y: extras.centerY };
        }
        return fallback;
    }


    private variableIndexMap: Map<string, number> = new Map();

    private createEmptyController() {
        return {
            "_$type": "Animator",
            enabled: true,
            cullingMode: 2,
            controllerLayers: [] as Array<Record<string, unknown>>,
            animatorParams: [] as Array<Record<string, unknown>>,
            sleep: false,
            layerW: 150
        };
    }
}

function stripAt(uuid: string): string {
    const at = uuid.indexOf("@");
    return at >= 0 ? uuid.substring(0, at) : uuid;
}