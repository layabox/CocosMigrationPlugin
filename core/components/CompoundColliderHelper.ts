/**
 * 辅助函数：确保 colliderShape 是 CompoundColliderShape，如果不是则转换
 * 当节点上有多个碰撞器组件时，需要将它们组合成 CompoundColliderShape
 * @param physicsComponent 物理组件（Rigidbody3D 或 PhysicsCollider）
 * @param newShape 新的碰撞器形状
 */
export function ensureCompoundColliderShape(physicsComponent: any, newShape: any): void {
    if (!physicsComponent.colliderShape) {
        // 如果没有 colliderShape，直接设置新的 shape
        physicsComponent.colliderShape = newShape;
        return;
    }

    const existingShape = physicsComponent.colliderShape;
    
    // 如果已经是 CompoundColliderShape，直接添加新的 shape
    if (existingShape._$type === "CompoundColliderShape") {
        if (!Array.isArray(existingShape.shapes)) {
            existingShape.shapes = [];
        }
        existingShape.shapes.push(newShape);
        return;
    }

    // 如果已有单个 shape，创建 CompoundColliderShape 并添加两个 shape
    const compoundShape: any = {
        "_$type": "CompoundColliderShape",
        shapes: [existingShape, newShape]
    };
    physicsComponent.colliderShape = compoundShape;
}

