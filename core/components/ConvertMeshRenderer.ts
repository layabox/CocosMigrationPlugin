import { registerComponentParser } from "../ComponentParserRegistry";

registerComponentParser("cc.MeshRenderer", ({ conversion, node, data }) => {
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
        const resolved = formatUuid(meshUuid);
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
                "_$uuid": formatUuid(uuid),
                "_$type": "Material"
            } : null;
        }).filter(Boolean);
    }

    if (!meshRenderer.lightmapScaleOffset) {
        meshRenderer.lightmapScaleOffset = {
            "_$type": "Vector4"
        };
    }
});

function formatUuid(uuid: string): string {
    return uuid;
}