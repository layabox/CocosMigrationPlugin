import { registerComponentParser } from "../ComponentParserRegistry";

// 注册 cc.RigidBody 转换器（Cocos Creator 3D 物理）
registerComponentParser("cc.RigidBody", ({ owner, node, data }) => {
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

    const rigidBody = ensureComp("Rigidbody3D");

    // 检查是否已经有 PhysicsCollider（可能由 BoxCollider 等组件创建）
    // 如果有，将其 colliderShape 转移到 Rigidbody3D，并移除 PhysicsCollider
    const existingPhysicsCollider = node._$comp.find((c: any) => c._$type === "PhysicsCollider");
    if (existingPhysicsCollider && existingPhysicsCollider.colliderShape) {
        // 将 colliderShape 转移到 Rigidbody3D
        rigidBody.colliderShape = existingPhysicsCollider.colliderShape;
        // 转移碰撞组属性
        if (typeof existingPhysicsCollider.collisionGroup === "number") {
            rigidBody.collisionGroup = existingPhysicsCollider.collisionGroup;
        }
        if (typeof existingPhysicsCollider.canCollideWith === "number") {
            rigidBody.canCollideWith = existingPhysicsCollider.canCollideWith;
        }
        // 移除 PhysicsCollider（因为 Rigidbody3D 已经包含了它的功能）
        const index = node._$comp.indexOf(existingPhysicsCollider);
        if (index !== -1) {
            node._$comp.splice(index, 1);
        }
    }

    // 转换刚体类型
    // Cocos: 数字枚举 0=Static, 1=Dynamic, 2=Kinematic, 3=Animated (或可能是 4=Animated)
    // Laya: isKinematic (true = Kinematic/Animated, false = Dynamic/Static)
    const type = data._type ?? data.type;
    if (typeof type === "number") {
        // 数字类型：0=Static, 1=Dynamic, 2=Kinematic, 3或4=Animated
        if (type === 2 || type === 3 || type === 4) {
            // Kinematic (2) 或 Animated (3/4) 都映射为 isKinematic = true
            rigidBody.isKinematic = true;
        } else {
            // Static (0) 或 Dynamic (1) 映射为 isKinematic = false
            rigidBody.isKinematic = false;
        }
    } else if (typeof type === "string") {
        // 字符串类型（兼容处理）
        const typeLower = String(type).toLowerCase();
        if (typeLower === "kinematic" || typeLower === "animated") {
            rigidBody.isKinematic = true;
        } else {
            rigidBody.isKinematic = false;
        }
    } else {
        rigidBody.isKinematic = false; // 默认 Dynamic
    }

    // 质量 (mass)
    const mass = data._mass ?? data.mass;
    if (typeof mass === "number" && mass > 0) {
        rigidBody.mass = mass;
    } else if (!rigidBody.isKinematic) {
        rigidBody.mass = 1; // 默认值（仅在非Kinematic时设置）
    }

    // 重力 (gravity) - Vector3
    // 注意：Cocos 有 _useGravity 标志，如果为 false，则重力应该为 0
    const useGravity = data._useGravity ?? data.useGravity;
    const gravity = data._gravity || data.gravity;
    
    if (!rigidBody.isKinematic) {
        if (useGravity === false) {
            // 如果禁用重力，设置为零向量
            rigidBody.gravity = {
                "_$type": "Vector3",
                x: 0,
                y: 0,
                z: 0
            };
        } else if (gravity && typeof gravity === "object") {
            // 使用指定的重力值
            rigidBody.gravity = {
                "_$type": "Vector3",
                x: typeof gravity.x === "number" ? gravity.x : 0,
                y: typeof gravity.y === "number" ? gravity.y : -9.8,
                z: typeof gravity.z === "number" ? gravity.z : 0
            };
        } else {
            // 默认重力
            rigidBody.gravity = {
                "_$type": "Vector3",
                x: 0,
                y: -9.8,
                z: 0
            };
        }
    }

    // 线性阻尼 (linearDamping)
    const linearDamping = data._linearDamping ?? data.linearDamping;
    if (typeof linearDamping === "number") {
        rigidBody.linearDamping = linearDamping;
    }

    // 角阻尼 (angularDamping)
    const angularDamping = data._angularDamping ?? data.angularDamping;
    if (typeof angularDamping === "number") {
        rigidBody.angularDamping = angularDamping;
    }

    // 线性速度 (linearVelocity) - Vector3
    const linearVelocity = data._linearVelocity || data.linearVelocity;
    if (linearVelocity && typeof linearVelocity === "object") {
        rigidBody.linearVelocity = {
            "_$type": "Vector3",
            x: typeof linearVelocity.x === "number" ? linearVelocity.x : 0,
            y: typeof linearVelocity.y === "number" ? linearVelocity.y : 0,
            z: typeof linearVelocity.z === "number" ? linearVelocity.z : 0
        };
    }

    // 角速度 (angularVelocity) - Vector3
    const angularVelocity = data._angularVelocity || data.angularVelocity;
    if (angularVelocity && typeof angularVelocity === "object") {
        rigidBody.angularVelocity = {
            "_$type": "Vector3",
            x: typeof angularVelocity.x === "number" ? angularVelocity.x : 0,
            y: typeof angularVelocity.y === "number" ? angularVelocity.y : 0,
            z: typeof angularVelocity.z === "number" ? angularVelocity.z : 0
        };
    }

    // 线性因子 (linearFactor) - Vector3
    const linearFactor = data._linearFactor || data.linearFactor;
    if (linearFactor && typeof linearFactor === "object") {
        rigidBody.linearFactor = {
            "_$type": "Vector3",
            x: typeof linearFactor.x === "number" ? linearFactor.x : 1,
            y: typeof linearFactor.y === "number" ? linearFactor.y : 1,
            z: typeof linearFactor.z === "number" ? linearFactor.z : 1
        };
    } else {
        rigidBody.linearFactor = {
            "_$type": "Vector3",
            x: 1,
            y: 1,
            z: 1
        };
    }

    // 角因子 (angularFactor) - Vector3
    const angularFactor = data._angularFactor || data.angularFactor;
    if (angularFactor && typeof angularFactor === "object") {
        rigidBody.angularFactor = {
            "_$type": "Vector3",
            x: typeof angularFactor.x === "number" ? angularFactor.x : 1,
            y: typeof angularFactor.y === "number" ? angularFactor.y : 1,
            z: typeof angularFactor.z === "number" ? angularFactor.z : 1
        };
    } else {
        rigidBody.angularFactor = {
            "_$type": "Vector3",
            x: 1,
            y: 1,
            z: 1
        };
    }

    // 弹性系数 (restitution)
    const restitution = data._restitution ?? data.restitution;
    if (typeof restitution === "number" && !rigidBody.isKinematic) {
        rigidBody.restitution = restitution;
    }

    // 摩擦系数 (friction)
    const friction = data._friction ?? data.friction;
    if (typeof friction === "number" && !rigidBody.isKinematic) {
        rigidBody.friction = friction;
    }

    // 滚动摩擦 (rollingFriction)
    const rollingFriction = data._rollingFriction ?? data.rollingFriction;
    if (typeof rollingFriction === "number" && !rigidBody.isKinematic) {
        rigidBody.rollingFriction = rollingFriction;
    }

    // 触发器 (trigger) - 在Cocos中可能是isTrigger
    const trigger = data._trigger ?? data.trigger ?? data._isTrigger ?? data.isTrigger;
    if (typeof trigger === "boolean") {
        rigidBody.trigger = trigger;
    }

    // 碰撞组 (collisionGroup) - 从 PhysicsColliderComponent 继承
    const group = data._group ?? data.group;
    if (typeof group === "number") {
        rigidBody.collisionGroup = group;
    } else {
        rigidBody.collisionGroup = 1; // 默认值
    }

    // 可碰撞组 (canCollideWith) - 从 PhysicsColliderComponent 继承
    const canCollideWith = data._canCollideWith ?? data.canCollideWith;
    if (typeof canCollideWith === "number") {
        rigidBody.canCollideWith = canCollideWith;
    } else {
        rigidBody.canCollideWith = -1; // 默认 -1 表示可以与所有组碰撞
    }
});
