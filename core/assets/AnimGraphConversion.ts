import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";

interface ICocosRef {
    __id__: number;
}

interface ILayaState extends Record<string, unknown> {
    id: string;
    name?: string;
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

        const entryNode = this.getNode(nodes, entryRef);
        const anyNode = this.getNode(nodes, anyRef);

        const stateIdMap = new Map<number, string>();
        const convertedStates: ILayaState[] = [];
        let stateIndex = 0;

        const motionStates = stateRefs
            .map(ref => ({ refId: ref.__id__, node: this.getNode(nodes, ref) }))
            .filter(item => item.node?.__type__ === "cc.animation.Motion");

        for (const { refId, node } of motionStates) {
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
                loopState: 0
            };

            if (motionInfo?.clipUuid) {
                layaState.clip = {
                    "_$uuid": motionInfo.clipUuid
                };
            }

            const stateTransitions = this.collectTransitions(nodes, transitions, refId, stateIdMap);
            if (stateTransitions.length > 0)
                layaState.transitions = stateTransitions;

            convertedStates.push(layaState);
        }

        const entryTransitions = this.collectTransitions(nodes, transitions, entryRef?.__id__, stateIdMap)
            .map(item => ({ id: item.id }));
        const defaultState = entryTransitions.length > 0
            ? convertedStates.find(s => s.id === entryTransitions[0].id)
            : convertedStates[0];

        const entryPosition = this.getNodePosition(entryNode, { x: 10, y: 100 });
        convertedStates.push({
            x: entryPosition.x,
            y: entryPosition.y,
            loopState: 0,
            _isLooping: 0,
            id: "-1",
            name: entryNode?.name || "Entry",
            speed: 1,
            clipEnd: 1,
            soloTransitions: entryTransitions.length > 0 ? entryTransitions : undefined
        });

        const anyPosition = this.getNodePosition(anyNode, { x: entryPosition.x + 200, y: entryPosition.y });
        convertedStates.push({
            x: anyPosition.x,
            y: anyPosition.y,
            loopState: 0,
            _isLooping: 0,
            id: "-2",
            name: anyNode?.name || "Any State",
            speed: 1,
            clipEnd: 1
        });

        return {
            states: convertedStates,
            defaultStateName: defaultState?.name
        };
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
                return {
                    clipUuid: this.normalizeUuid(rawUuid)
                };
            }
        }

        return null;
    }

    private collectTransitions(nodes: any[], transitions: any[], fromId: number | undefined, stateIdMap: Map<number, string>): Array<Record<string, unknown>> {
        if (fromId === undefined || fromId === null)
            return [];

        const results: Array<Record<string, unknown>> = [];
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

            results.push({
                id: targetId,
                duration: transition.duration ?? 0,
                exitConditionEnabled: !!transition.exitConditionEnabled,
                exitCondition: transition._exitCondition ?? 0,
                conditions: conditions && conditions.length > 0 ? conditions : undefined
            });
        }

        return results;
    }

    private convertCondition(condition: any): Record<string, unknown> {
        switch (condition?.__type__) {
            case "cc.animation.TriggerCondition":
                return {
                    type: "trigger",
                    parameter: condition.trigger
                };
            case "cc.animation.BinaryCondition":
                return {
                    type: "binary",
                    operator: condition.operator,
                    parameter: condition.parameter,
                    threshold: condition.threshold
                };
            default:
                return {
                    type: "unknown",
                    raw: condition
                };
        }
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

    private normalizeUuid(uuid: string): string {
        return stripAt(uuid);
    }

    private createEmptyController() {
        return {
            "_$type": "Animator",
            enabled: true,
            cullingMode: 2,
            controllerLayers: [] as Array<Record<string, unknown>>,
            sleep: false,
            layerW: 150
        };
    }
}

function stripAt(uuid: string): string {
    const at = uuid.indexOf("@");
    return at >= 0 ? uuid.substring(0, at) : uuid;
}