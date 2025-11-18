import { registerComponentParser } from "../ComponentParserRegistry";

registerComponentParser("cc.BoxCollider", ({ owner, node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // 确保 PhysicsColliderComponent 组件存在
    const ensureComp = (type: string) => {
        let comp = node._$comp.find((c: any) => c._$type === type);
        if (!comp) {
            comp = { "_$type": type };
            node._$comp.push(comp);
        }
        return comp;
    };

    const collider = ensureComp("PhysicsColliderComponent");

    // 创建 BoxColliderShape
    const colliderShape: any = {
        "_$type": "BoxColliderShape"
    };

    // 转换尺寸：Cocos 使用厘米，Laya 使用米，需要除以 100
    const size = data._size || data.size;
    if (size && typeof size === "object") {
        colliderShape.size = {
            "_$type": "Vector3",
            x: (typeof size.x === "number" ? size.x : 1) / 100,
            y: (typeof size.y === "number" ? size.y : 1) / 100,
            z: (typeof size.z === "number" ? size.z : 1) / 100
        };
    } else {
        // 默认尺寸
        colliderShape.size = {
            "_$type": "Vector3",
            x: 1,
            y: 1,
            z: 1
        };
    }

    // 转换中心偏移：Cocos 使用厘米，Laya 使用米，需要除以 100
    const center = data._center || data.center;
    if (center && typeof center === "object") {
        colliderShape.localOffset = {
            "_$type": "Vector3",
            x: (typeof center.x === "number" ? center.x : 0) / 100,
            y: (typeof center.y === "number" ? center.y : 0) / 100,
            z: (typeof center.z === "number" ? center.z : 0) / 100
        };
    } else {
        // 默认偏移为 0
        colliderShape.localOffset = {
            "_$type": "Vector3",
            x: 0,
            y: 0,
            z: 0
        };
    }

    collider.colliderShape = colliderShape;

    // 转换碰撞组（如果有）
    if (typeof data._group === "number") {
        collider.collisionGroup = data._group;
    } else if (typeof data.group === "number") {
        collider.collisionGroup = data.group;
    }
});

