import fs from "fs";
import path from "path";

import { registerComponentParser } from "../ComponentParserRegistry";
import { formatUuid } from "../Utils";

registerComponentParser("cc.SkinnedMeshRenderer", ({ conversion, owner, node, data, is2d }) => {
    if (!data || is2d)
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
                if (node && typeof node._$id === "string") {
                    collected.push({ "_$ref": node._$id });
                } else {
                    console.warn(`Failed to find node by joint path: ${jointPath}`);
                }
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

    // 对于有 MeshFilter 的节点，scale 也需要除以 100
    // if (meshUuid) {
    //     if (!node.transform) {
    //         node.transform = {};
    //     }
    //     if (node.transform.localScale) {
    //         const scale = node.transform.localScale;
    //         if (typeof scale.x === "number") scale.x /= 100;
    //         if (typeof scale.y === "number") scale.y /= 100;
    //         if (typeof scale.z === "number") scale.z /= 100;
    //     } else {
    //         // 如果没有 localScale，默认值是 1，设置为 1/100 = 0.01
    //         node.transform.localScale = {
    //             "_$type": "Vector3",
    //             x: 0.01,
    //             y: 0.01,
    //             z: 0.01
    //         };
    //     }
    // }

    // 处理骨骼节点的 transform
    // 1. rootBone 下面的子节点（但不包含 rootBone 节点本身）的 scale 都要除以 100
    //    但是不包含 _bones 中的节点
    // 2. 对于 _bones 中的节点，需要对 position 都乘以 100，对于 scale 不做处理
    if (rootBoneNode && bones && bones.length > 0) {
        // 创建 _bones 节点的 ID 集合，用于快速查找
        const bonesIdSet = new Set<string>();
        for (const boneRef of bones) {
            if (boneRef._$ref && typeof boneRef._$ref === "string") {
                bonesIdSet.add(boneRef._$ref);
            }
        }

        // 处理 rootBone 的第一个子节点（排除 rootBone 本身和 _bones 中的节点）的 scale
        // 以及所有符合条件的节点的 position 乘以 100
        const rootBoneId = rootBoneNode._$id;
        if (rootBoneId && typeof rootBoneId === "string") {
            processRootBoneFirstChild(rootBoneNode, bonesIdSet);
            processRootBoneChildrenPosition(rootBoneNode, bonesIdSet);
        }

        // 处理 _bones 中的节点：position 乘以 100
        for (const boneRef of bones) {
            if (boneRef._$ref && typeof boneRef._$ref === "string") {
                const boneNode = findNodeById(conversion, boneRef._$ref);
                if (boneNode) {
                    processBoneNodePosition(boneNode);
                }
            }
        }
    }
});

/**
 * 处理 rootBone 的第一个子节点（排除 _bones 中的节点）的 scale
 */
function processRootBoneFirstChild(rootBoneNode: any, bonesIdSet: Set<string>): void {
    if (!rootBoneNode || typeof rootBoneNode !== "object")
        return;

    const children: any[] | undefined = rootBoneNode._$child;
    if (Array.isArray(children) && children.length > 0) {
        // 只处理第一个子节点
        const firstChild = children[0];
        const childId = firstChild._$id;
        // 排除 _bones 中的节点
        if (childId && typeof childId === "string" && !bonesIdSet.has(childId)) {
            // 处理 scale：除以 100
            if (!firstChild.transform) {
                firstChild.transform = {};
            }
            // if (firstChild.transform.localScale) {
            //     const scale = firstChild.transform.localScale;
            //     if (typeof scale.x === "number") scale.x /= 100;
            //     if (typeof scale.y === "number") scale.y /= 100;
            //     if (typeof scale.z === "number") scale.z /= 100;
            // } else {
            //     // 如果没有 localScale，默认值是 1，设置为 1/100 = 0.01
            //     firstChild.transform.localScale = {
            //         "_$type": "Vector3",
            //         x: 0.01,
            //         y: 0.01,
            //         z: 0.01
            //     };
            // }
        }
    }
}

/**
 * 处理 rootBone 下面所有子节点（排除 _bones 中的节点）的 position：乘以 100
 */
function processRootBoneChildrenPosition(node: any, bonesIdSet: Set<string>): void {
    if (!node || typeof node !== "object")
        return;

    const children: any[] | undefined = node._$child;
    if (Array.isArray(children)) {
        for (const child of children) {
            const childId = child._$id;
            // 排除 _bones 中的节点
            if (childId && typeof childId === "string" && !bonesIdSet.has(childId)) {
                // 处理 position：乘以 100
                // if (child.transform?.localPosition) {
                //     const pos = child.transform.localPosition;
                //     if (typeof pos.x === "number") pos.x *= 100;
                //     if (typeof pos.y === "number") pos.y *= 100;
                //     if (typeof pos.z === "number") pos.z *= 100;
                // }
            }
            // 递归处理子节点
            processRootBoneChildrenPosition(child, bonesIdSet);
        }
    }
}

/**
 * 处理 _bones 中的节点：position 乘以 100
 */
function processBoneNodePosition(boneNode: any): void {
    if (!boneNode || typeof boneNode !== "object")
        return;

    if (boneNode.transform?.localPosition) {
        const pos = boneNode.transform.localPosition;
        // if (typeof pos.x === "number") pos.x *= 100;
        // if (typeof pos.y === "number") pos.y *= 100;
        // if (typeof pos.z === "number") pos.z *= 100;
    }
}

/**
 * 根据节点 ID 查找节点
 */
function findNodeById(conversion: any, nodeId: string): any | null {
    if (!conversion || !nodeId)
        return null;

    const nodeMap: Map<number, any> | undefined = conversion?.nodeMap;
    if (!nodeMap)
        return null;

    // 需要遍历 nodeMap 找到匹配的节点
    for (const [key, node] of nodeMap.entries()) {
        if (node && node._$id === nodeId) {
            return node;
        }
    }
    return null;
}

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

