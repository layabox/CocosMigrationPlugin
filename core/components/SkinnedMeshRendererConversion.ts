import fs from "fs";
import path from "path";

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

    let bones: Array<{ "_$ref": string }> | null = null;

    if (rootBoneNode) {
        const jointPaths = skeletonUuid ? readSkeletonJointPaths(owner.cocosProjectRoot, skeletonUuid) : null;
        if (jointPaths && jointPaths.length > 0) {
            const pathMap = new Map<string, any>();
            buildPathMap(rootBoneNode, "", pathMap);
            const collected: Array<{ "_$ref": string }> = [];
            for (const jointPath of jointPaths) {
                const node = findNodeByJointPath(pathMap, jointPath, getNodeDisplayName(rootBoneNode));
                if (node && typeof node._$id === "string")
                    collected.push({ "_$ref": node._$id });
            }
            if (collected.length > 0)
                bones = collected;
        }

        if (!bones || bones.length === 0) {
            bones = collectBoneRefs(rootBoneNode, expectedBones);
        }

        if (bones && bones.length > 0)
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

function readSkeletonJointPaths(projectRoot: string | null | undefined, skeletonUuid: string): string[] | null {
    if (!projectRoot)
        return null;

    const folder = skeletonUuid.slice(0, 2);
    const filePath = path.join(projectRoot, "library", folder, `${skeletonUuid}.json`);
    if (!fs.existsSync(filePath))
        return null;

    try {
        const content = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(content);
        const joints = data?._joints;
        return Array.isArray(joints) ? joints as string[] : null;
    }
    catch (err) {
        console.warn(`Failed to read skeleton data: ${filePath}`, err);
        return null;
    }
}

function buildPathMap(node: any, currentPath: string, map: Map<string, any>): void {
    if (!node)
        return;

    const nodeName: string = node.name ?? node._$name ?? node._name ?? "";
    const nextPath = nodeName ? (currentPath ? `${currentPath}/${nodeName}` : nodeName) : currentPath;

    if (nextPath && !map.has(nextPath))
        map.set(nextPath, node);

    const children: any[] | undefined = node._$child;
    if (Array.isArray(children)) {
        for (const child of children)
            buildPathMap(child, nextPath, map);
    }
}

function findNodeByJointPath(pathMap: Map<string, any>, jointPath: string, rootName?: string): any | null {
    const segments = jointPath.split("/").filter(Boolean);
    if (rootName && segments[0] !== rootName) {
        const prefixedKey = [rootName, ...segments].join("/");
        if (pathMap.has(prefixedKey))
            segments.unshift(rootName);
    }
    while (segments.length > 0) {
        const key = segments.join("/");
        const node = pathMap.get(key);
        if (node)
            return node;
        segments.shift();
    }
    return null;
}

function getNodeDisplayName(node: any): string | undefined {
    if (!node || typeof node !== "object")
        return undefined;
    return node.name ?? node._$name ?? node._name ?? undefined;
}

