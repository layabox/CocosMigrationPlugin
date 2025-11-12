import { registerComponentParser } from "../ComponentParserRegistry";
import { formatUuid } from "../Utils";

registerComponentParser("cc.SkinnedMeshRenderer", ({ conversion, owner, node, data }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    if (!node._$type || node._$type === "Sprite3D")
        node._$type = "SkinnedMeshSprite3D";

    const ensureComp = (type: string) => {
        let comp = node._$comp.find((item: any) => item._$type === type);
        if (!comp) {
            comp = { "_$type": type };
            node._$comp.push(comp);
        }
        return comp;
    };

    const meshUuid: string | undefined = data._mesh?.__uuid__;
    if (meshUuid) {
        const meshFilter = ensureComp("MeshFilter");
        meshFilter.sharedMesh = {
            "_$uuid": formatUuid(meshUuid, owner),
            "_$type": "Mesh"
        };
    }

    const renderer = ensureComp("SkinnedMeshRenderer");

    const materials: any[] = Array.isArray(data._materials) ? data._materials : [];
    if (materials.length > 0) {
        renderer.sharedMaterials = materials.map((item: any) => {
            const uuid = item?.__uuid__;
            return uuid ? {
                "_$uuid": formatUuid(uuid, owner),
                "_$type": "Material"
            } : null;
        }).filter(Boolean);
    }

    if (typeof data._shadowCastingMode === "number")
        renderer.castShadow = data._shadowCastingMode !== 0;

    if (typeof data._shadowReceivingMode === "number")
        renderer.receiveShadow = data._shadowReceivingMode !== 0;

    const rootBoneNode = resolveNode(conversion, data._skinningRoot);
    if (rootBoneNode)
        renderer.rootBone = { "_$ref": rootBoneNode._$id };

    const skeletonUuid: string | undefined = data._skeleton?.__uuid__;
    const skeletonInfo = skeletonUuid ? owner.allAssets.get(skeletonUuid) : undefined;
    const expectedBones = typeof skeletonInfo?.userData?.jointsLength === "number"
        ? skeletonInfo.userData.jointsLength
        : undefined;

    if (rootBoneNode) {
        const bones = collectBoneRefs(rootBoneNode, expectedBones);
        if (bones.length > 0)
            renderer._bones = bones;
    }
});

function resolveNode(conversion: any, ref: any): any | null {
    if (!ref || typeof ref.__id__ !== "number")
        return null;
    const nodeMap: Map<number, any> | undefined = conversion?.nodeMap;
    if (!nodeMap)
        return null;
    return nodeMap.get(ref.__id__) ?? null;
}

function collectBoneRefs(root: any, limit?: number): Array<{ "_$ref": string }> {
    const result: Array<{ "_$ref": string }> = [];
    const visited = new Set<string>();
    const queue: any[] = [];

    if (root)
        queue.push(root);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== "object")
            continue;

        const id = current._$id;
        if (typeof id !== "string" || visited.has(id))
            continue;

        visited.add(id);
        result.push({ "_$ref": id });

        if (limit && result.length >= limit)
            break;

        const children: any[] | undefined = current._$child;
        if (Array.isArray(children)) {
            for (const child of children)
                queue.push(child);
        }
    }

    return result;
}

