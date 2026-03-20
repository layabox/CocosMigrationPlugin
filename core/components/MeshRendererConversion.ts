import { registerComponentParser } from "../ComponentParserRegistry";
import { formatUuid } from "../Utils";

registerComponentParser("cc.MeshRenderer", ({ owner, node, data, is2d, isOverride }) => {
    if (!data || is2d)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    const ensureComp = (type: string) => {
        let comp = node._$comp.find((c: any) => c._$type === type);
        if (!comp) {
            comp = { "_$type": type };
            node._$comp.push(comp);
        }
        return comp;
    };

    // 如果是覆盖模式，只处理被覆盖的属性
    if (isOverride) {
        console.log(`[MeshRendererConversion] isOverride=true, data=`, JSON.stringify(data));
        
        // 处理材质覆盖
        if (data._materials !== undefined) {
            const materials: any[] = Array.isArray(data._materials) ? data._materials : [];
            console.log(`[MeshRendererConversion] Processing material override, materials=`, JSON.stringify(materials));
            
            if (materials.length > 0) {
                const meshRenderer = ensureComp("MeshRenderer");
                const convertedMaterials: any[] = [];
                let hasValidMaterial = false;
                
                for (let i = 0; i < materials.length; i++) {
                    const item = materials[i];
                    if (item && item.__uuid__) {
                        const resolvedUuid = formatUuid(item.__uuid__, owner);
                        console.log(`[MeshRendererConversion] Material[${i}]: ${item.__uuid__} -> ${resolvedUuid}`);
                        convertedMaterials[i] = {
                            "_$uuid": resolvedUuid,
                            "_$type": "Material"
                        };
                        hasValidMaterial = true;
                    }
                }
                
                if (hasValidMaterial) {
                    // 对于覆盖模式，始终保留数组结构（包括稀疏数组）
                    meshRenderer.sharedMaterials = convertedMaterials;
                    console.log(`[MeshRendererConversion] Set sharedMaterials=`, JSON.stringify(meshRenderer.sharedMaterials));
                }
            }
        }
        
        // 处理阴影覆盖
        if (typeof data._shadowCastingMode === "number") {
            const meshRenderer = ensureComp("MeshRenderer");
            meshRenderer.castShadow = data._shadowCastingMode !== 0;
        }
        
        if (typeof data._shadowReceivingMode === "number") {
            const meshRenderer = ensureComp("MeshRenderer");
            meshRenderer.receiveShadow = data._shadowReceivingMode !== 0;
        }
        
        return;
    }

    // 非覆盖模式：完整转换
    const meshUuid: string | undefined = data._mesh?.__uuid__;
    if (meshUuid) {
        const resolved = formatUuid(meshUuid, owner);
        const meshFilter = ensureComp("MeshFilter");
        meshFilter.sharedMesh = {
            "_$uuid": resolved,
            "_$type": "Mesh"
        };
    }

    const meshRenderer = ensureComp("MeshRenderer");

    const materials: any[] = Array.isArray(data._materials) ? data._materials : [];
    if (materials.length > 0) {
        // 处理材质数组，保留索引位置（用于预制体覆盖场景）
        const convertedMaterials: any[] = [];
        let hasValidMaterial = false;
        for (let i = 0; i < materials.length; i++) {
            const item = materials[i];
            if (item && item.__uuid__) {
                convertedMaterials[i] = {
                    "_$uuid": formatUuid(item.__uuid__, owner),
                "_$type": "Material"
                };
                hasValidMaterial = true;
            }
        }
        // 如果有有效的材质，设置到 sharedMaterials
        // 对于预制体覆盖，保留稀疏数组结构；对于普通转换，过滤掉 null 值
        if (hasValidMaterial) {
            // 检查是否是稀疏数组（用于预制体覆盖）
            const isSparseArray = convertedMaterials.length > 0 && 
                convertedMaterials.some((m, i) => m === undefined && i < convertedMaterials.length);
            if (isSparseArray) {
                // 保留稀疏数组结构，用于预制体覆盖
                meshRenderer.sharedMaterials = convertedMaterials;
            } else {
                // 普通转换，过滤掉 null/undefined 值
                meshRenderer.sharedMaterials = convertedMaterials.filter(m => m != null);
            }
        }
    }

    if (!meshRenderer.lightmapScaleOffset) {
        meshRenderer.lightmapScaleOffset = {
            "_$type": "Vector4"
        };
    }

    // 转换阴影相关属性
    // Cocos: _shadowCastingMode (0=OFF, 1=ON) -> Laya: castShadow (boolean)
    // Cocos 默认值是 0（不投射阴影），未显式设置时应默认关闭
    if (typeof data._shadowCastingMode === "number") {
        meshRenderer.castShadow = data._shadowCastingMode !== 0;
    } else {
        meshRenderer.castShadow = false;
    }

    // Cocos: _shadowReceivingMode (0=OFF, 1=ON) -> Laya: receiveShadow (boolean)
    // Cocos 默认值是 1（接收阴影），未显式设置时也应默认开启
    if (typeof data._shadowReceivingMode === "number") {
        meshRenderer.receiveShadow = data._shadowReceivingMode !== 0;
    } else {
        meshRenderer.receiveShadow = true;
    }
});

