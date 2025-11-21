import { registerComponentParser } from "../ComponentParserRegistry";

registerComponentParser("cc.BoxCollider", ({ owner, node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // 确保 Rigidbody3D 组件存在
    const ensureComp = (type: string) => {
        let comp = node._$comp.find((c: any) => c._$type === type);
        if (!comp) {
            comp = { "_$type": type };
            node._$comp.push(comp);
        }
        return comp;
    };

    const rigidbody = ensureComp("PhysicsCollider");

    // 创建 BoxColliderShape
    const colliderShape: any = {
        "_$type": "BoxColliderShape"
    };

    // 转换尺寸：直接使用原始值，不进行单位转换
    const size = data._size || data.size;
    if (size && typeof size === "object") {
        colliderShape.size = {
            "_$type": "Vector3",
            x: typeof size.x === "number" ? size.x : 1,
            y: typeof size.y === "number" ? size.y : 1,
            z: typeof size.z === "number" ? size.z : 1
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

    // 转换中心偏移：直接使用原始值，不进行单位转换
    const center = data._center || data.center;
    if (center && typeof center === "object") {
        colliderShape.localOffset = {
            "_$type": "Vector3",
            x: typeof center.x === "number" ? center.x : 0,
            y: typeof center.y === "number" ? center.y : 0,
            z: typeof center.z === "number" ? center.z : 0
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

    rigidbody.colliderShape = colliderShape;

    // 转换碰撞组（如果有）
    if (typeof data._group === "number") {
        rigidbody.collisionGroup = data._group;
    } else if (typeof data.group === "number") {
        rigidbody.collisionGroup = data.group;
    } else {
        // 默认碰撞组为 1
        rigidbody.collisionGroup = 1;
    }

    // 设置 canCollideWith（默认 -1，表示可以与所有组碰撞）
    rigidbody.canCollideWith = -1;

    // 设置重力（默认 {x: 0, y: -10, z: 0}）
    rigidbody.gravity = {
        "_$type": "Vector3",
        x: 0,
        y: -10,
        z: 0
    };
});

