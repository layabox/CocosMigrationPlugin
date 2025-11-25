import { registerComponentParser } from "../ComponentParserRegistry";

type AnyRecord = Record<string, any> | undefined | null;

registerComponentParser("cc.LODGroup", ({ node, data, owner }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    if (node._$type !== "Sprite3D" && node._$type !== "Scene3D")
        node._$type = "Sprite3D";

    const comp = ensureComponent(node, "LODGroup");

    // 获取 LOD 级别数组
    // Cocos 可能使用 _levels, levels, _lodLevels, lodLevels
    const levels = extractArray(data, ["_levels", "levels", "_lodLevels", "lodLevels", "_lod", "lod"]);
    
    if (levels && Array.isArray(levels) && levels.length > 0) {
        const lods: any[] = [];
        
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            if (!level || typeof level !== "object")
                continue;

            // 获取 mincullRate (屏幕相对过渡高度)
            // Cocos 使用 screenRelativeTransitionHeight (0-1)，Laya 使用 mincullRate (0-1)
            // 注意：Cocos 的值越大表示越近（更高质量），Laya 的 mincullRate 也是越大表示越近
            // 但通常 Cocos 的数组是从 LOD0（最高质量）到 LODN（最低质量），而 Laya 也是类似的顺序
            let mincullRate = pickNumber([level], [
                "_screenRelativeTransitionHeight", 
                "screenRelativeTransitionHeight",
                "_transitionHeight",
                "transitionHeight",
                "_mincullRate",
                "mincullRate",
                "_cullRate",
                "cullRate"
            ]);
            
            // 如果没有找到，根据索引计算默认值
            // 通常第一个 LOD (索引0) 的 mincullRate 应该接近 1，最后一个接近 0
            if (mincullRate === undefined) {
                // 从高到低：第一个是 1.0，最后一个接近 0
                mincullRate = Math.max(0, 1 - (i / Math.max(1, levels.length - 1)) * 0.7);
            }
            
            // 确保在 0-1 范围内
            mincullRate = clamp(mincullRate, 0, 1);

            // 获取渲染节点
            // Cocos 可能使用 _renderers, renderers, _nodes, nodes, _children, children
            const renderers = extractArray(level, [
                "_renderers", 
                "renderers", 
                "_nodes", 
                "nodes",
                "_children",
                "children",
                "_meshes",
                "meshes"
            ]);

            const lodInfo: any = {
                "_$type": "LODInfo",
                "mincullRate": mincullRate,
                "renders": []
            };

            // 转换渲染节点引用
            if (renderers && Array.isArray(renderers)) {
                for (const renderer of renderers) {
                    if (!renderer)
                        continue;

                    // 可能是节点引用（UUID 或对象）
                    let nodeRef: any = null;
                    
                    if (typeof renderer === "string") {
                        // UUID 字符串
                        nodeRef = { "_$ref": renderer };
                    } else if (renderer._uuid) {
                        // 对象包含 _uuid
                        nodeRef = { "_$ref": renderer._uuid };
                    } else if (renderer.__uuid__) {
                        // 对象包含 __uuid__
                        nodeRef = { "_$ref": renderer.__uuid__ };
                    } else if (renderer._$id) {
                        // 已经是 Laya 格式的引用
                        nodeRef = { "_$ref": renderer._$id };
                    } else if (typeof renderer === "object" && renderer.node) {
                        // 可能是组件，获取其 node
                        const nodeObj = renderer.node;
                        if (nodeObj && (nodeObj._uuid || nodeObj.__uuid__ || nodeObj._$id)) {
                            nodeRef = { 
                                "_$ref": nodeObj._uuid || nodeObj.__uuid__ || nodeObj._$id 
                            };
                        }
                    }

                    if (nodeRef) {
                        lodInfo.renders.push(nodeRef);
                    }
                }
            }

            // 如果这个 LOD 级别有子节点，也可以尝试从子节点获取
            // Cocos 的 LODGroup 通常将不同 LOD 级别的模型作为子节点
            // 子节点可能命名为 LOD0, LOD1, LOD2 等，或者通过其他方式关联
            if (lodInfo.renders.length === 0 && node._$child && Array.isArray(node._$child)) {
                // 尝试通过命名约定找到对应的子节点
                // 这通常需要在节点转换阶段处理，这里只是作为备选方案
            }

            lods.push(lodInfo);
        }

        // 如果成功转换了 LOD 级别，设置到组件
        if (lods.length > 0) {
            comp.lods = lods;
        }
    } else {
        // 如果没有找到 levels 数组，尝试从子节点推断
        // Cocos 的 LODGroup 可能将不同 LOD 级别的模型作为直接子节点
        if (node._$child && Array.isArray(node._$child)) {
            const lods: any[] = [];
            const childCount = node._$child.length;
            
            // 为每个子节点创建一个 LOD 级别
            for (let i = 0; i < childCount; i++) {
                const child = node._$child[i];
                if (!child || !child._$id)
                    continue;

                // 计算 mincullRate：第一个子节点（最高质量）接近 1，最后一个接近 0
                const mincullRate = childCount > 1 
                    ? Math.max(0, 1 - (i / (childCount - 1)) * 0.7)
                    : 1.0;

                lods.push({
                    "_$type": "LODInfo",
                    "mincullRate": mincullRate,
                    "renders": [
                        { "_$ref": child._$id }
                    ]
                });
            }

            if (lods.length > 0) {
                comp.lods = lods;
            }
        }
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

function extractArray(source: AnyRecord, keys: string[]): any[] | undefined {
    if (!source || typeof source !== "object")
        return undefined;
    
    for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) {
            return value;
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

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, value));
}

