import { registerComponentParser } from "../ComponentParserRegistry";
import { ensureCompoundColliderShape } from "./CompoundColliderHelper";

registerComponentParser("cc.CapsuleCollider", ({ owner, node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // 检查节点上是否已经有 Rigidbody3D 组件（可能已经解析）
    const hasRigidbody3D = node._$comp.some((c: any) => c._$type === "Rigidbody3D");
    
    // 确保组件存在的辅助函数
    const ensureComp = (type: string) => {
        let comp = node._$comp.find((c: any) => c._$type === type);
        if (!comp) {
            comp = { "_$type": type };
            node._$comp.push(comp);
        }
        return comp;
    };

    // 根据是否有 Rigidbody3D 决定使用哪个组件
    // 如果有 Rigidbody3D，说明 RigidBody 组件已经解析，直接将 shape 添加到 Rigidbody3D
    // 如果没有 Rigidbody3D，创建 PhysicsCollider（静态碰撞器）
    const physicsComponent = hasRigidbody3D 
        ? ensureComp("Rigidbody3D")  // 如果有 Rigidbody3D，使用它
        : ensureComp("PhysicsCollider");  // 如果没有，创建 PhysicsCollider

    // 创建 CapsuleColliderShape
    const colliderShape: any = {
        "_$type": "CapsuleColliderShape"
    };

    // 转换半径 (radius)
    const radius = data._radius ?? data.radius;
    if (typeof radius === "number" && radius > 0) {
        colliderShape.radius = radius;
    } else {
        colliderShape.radius = 0.5; // 默认值
    }

    // 转换高度 (height) -> Laya 使用 length
    // Cocos 的 height 是总高度，Laya 的 length 也是总长度
    const height = data._height ?? data.height;
    if (typeof height === "number" && height > 0) {
        colliderShape.length = height;
    } else {
        colliderShape.length = 2; // 默认值
    }

    // 转换方向 (orientation)
    // Cocos 可能使用不同的枚举值，需要映射到 Laya 的枚举
    // Laya: 0=X-Axis, 1=Y-Axis, 2=Z-Axis
    const orientation = data._orientation ?? data.orientation;
    if (typeof orientation === "number") {
        // Cocos 的 orientation 可能是 0=X, 1=Y, 2=Z，直接使用
        // 或者可能是其他值，需要映射
        if (orientation >= 0 && orientation <= 2) {
            colliderShape.orientation = orientation;
        } else {
            colliderShape.orientation = 1; // 默认 Y-Axis
        }
    } else if (typeof orientation === "string") {
        // 字符串类型（兼容处理）
        const orientLower = String(orientation).toLowerCase();
        if (orientLower === "x" || orientLower === "x-axis") {
            colliderShape.orientation = 0;
        } else if (orientLower === "y" || orientLower === "y-axis") {
            colliderShape.orientation = 1;
        } else if (orientLower === "z" || orientLower === "z-axis") {
            colliderShape.orientation = 2;
        } else {
            colliderShape.orientation = 1; // 默认 Y-Axis
        }
    } else {
        colliderShape.orientation = 1; // 默认 Y-Axis
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

    // 设置 colliderShape
    // 如果已经有 colliderShape，说明有多个碰撞器，需要创建 CompoundColliderShape
    ensureCompoundColliderShape(physicsComponent, colliderShape);

    // 转换碰撞组（如果有）
    if (typeof data._group === "number") {
        physicsComponent.collisionGroup = data._group;
    } else if (typeof data.group === "number") {
        physicsComponent.collisionGroup = data.group;
    } else {
        // 默认碰撞组为 1
        physicsComponent.collisionGroup = 1;
    }

    // 设置 canCollideWith（默认 -1，表示可以与所有组碰撞）
    physicsComponent.canCollideWith = -1;

    // 注意：如果已经有 Rigidbody3D，不需要设置重力（Rigidbody3D 有自己的重力属性）
    // 只有在创建 PhysicsCollider 时才需要设置这些属性
    if (!hasRigidbody3D) {
        // PhysicsCollider 不需要设置重力，重力是 Rigidbody3D 的属性
        // 但可以设置其他 PhysicsCollider 特有的属性（如果有的话）
    }
});

