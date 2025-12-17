import { registerComponentParser } from "../ComponentParserRegistry";
import { formatUuid } from "../Utils";

registerComponentParser("cc.MeshRenderer", ({ owner, node, data }) => {
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
        meshRenderer.sharedMaterials = materials.map((item: any) => {
            const uuid = item?.__uuid__;
            return uuid ? {
                "_$uuid": formatUuid(uuid, owner),
                "_$type": "Material"
            } : null;
        }).filter(Boolean);
    }

    if (!meshRenderer.lightmapScaleOffset) {
        meshRenderer.lightmapScaleOffset = {
            "_$type": "Vector4"
        };
    }

    // 转换阴影相关属性
    // Cocos: _shadowCastingMode (0=OFF, 1=ON) -> Laya: castShadow (boolean)
    if (typeof data._shadowCastingMode === "number") {
        meshRenderer.castShadow = data._shadowCastingMode !== 0;
    }

    // Cocos: _shadowReceivingMode (0=OFF, 1=ON) -> Laya: receiveShadow (boolean)
    if (typeof data._shadowReceivingMode === "number") {
        meshRenderer.receiveShadow = data._shadowReceivingMode !== 0;
    }

    // 将节点的 scale 除以 100 以匹配 Laya
    // 如果没有 localScale，默认值是 1，需要强制设置成 1/100 = 0.01
    // if (!node.transform) {
    //     node.transform = {};
    // }
    // if (node.transform.localScale) {
    //     const scale = node.transform.localScale;
    //     if (typeof scale.x === "number") scale.x /= 100;
    //     if (typeof scale.y === "number") scale.y /= 100;
    //     if (typeof scale.z === "number") scale.z /= 100;
    // } else {
    //     // 如果没有 localScale，默认值是 1，设置为 1/100 = 0.01
    //     node.transform.localScale = {
    //         "_$type": "Vector3",
    //         x: 0.01,
    //         y: 0.01,
    //         z: 0.01
    //     };
    // }
});

