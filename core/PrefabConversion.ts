import { ICocosAssetConversion, ICocosMigrationTool } from "./ICocosMigrationTool";
import { getComponentParser, registerComponentParser as registerExternalComponentParser } from "./ComponentParserRegistry";
import { convertSkyboxToLaya, extractSkyboxInfo, extractAmbientInfo, extractFogInfo, extractShadowsInfo, convertAmbientToLaya, convertFogToLaya } from "./components/SkyboxConversion";
import fpath from "path";
import fs from "fs";
import { logger } from "./Logger";

export class PrefabConversion implements ICocosAssetConversion {
    /** 允许外部模块注册额外的组件解析器。 */
    static registerComponentParser = registerExternalComponentParser;

    private overrideTargets = new Map<string, any>();
    private rewriteTasks = new Map<string, any>();

    private overrides: any[];
    private nodeHooks: Array<any>;
    private nodeMap: Map<number, any>;
    private removedElements: Set<number>;
    private elements: Array<any>;
    private inCanvas: number;
    private currentTargetPath: string | undefined; // 保存当前转换的目标路径
    shadowsInfo: any; // 场景级阴影设置（cc.ShadowsInfo），供组件解析器访问

    constructor(private owner: ICocosMigrationTool) {
    }

    async run(sourcePath: string, targetPath: string, meta: any) {
        let elements = await IEditorEnv.utils.readJsonAsync(sourcePath);

        targetPath = Laya.Utils.replaceFileExtension(targetPath, elements[1]?.__type__ == "cc.Scene" ? "ls" : "lh");
        this.currentTargetPath = targetPath; // 保存目标路径

        let node = this.parseElements(elements);

        if (this.overrides.length > 0) {
            this.rewriteTasks.set(targetPath, { data: node, overrides: this.overrides, elements, nodeMap: this.nodeMap });
        }

        // 先写入材质文件（在 .lh 之前），确保 IDE 能先索引材质 UUID
        await this.writePendingSkyboxMaterials();
        await this.writePendingParticleMaterials();

        // 对于 .ls 场景文件，使用 fs.writeFileSync 直接写入，
        // 绕过 IDE 的 writeJsonAsync（它基于 _$type schema 过滤属性，会丢失 Scene3D 的 ambient/fog 等）
        // 对于 .lh 预制体文件，必须使用 writeJsonAsync 以触发 IDE 资源索引
        if (targetPath.endsWith(".ls")) {
            fs.writeFileSync(targetPath, JSON.stringify(node, null, 2), "utf-8");
            fs.writeFileSync(targetPath + ".meta", JSON.stringify({ uuid: meta.uuid }), "utf-8");
        } else {
            await IEditorEnv.utils.writeJsonAsync(targetPath, node);
            fs.writeFileSync(targetPath + ".meta", JSON.stringify({ uuid: meta.uuid }), "utf-8");
        }

        // 写入待处理的 2D 动画控制器文件
        await this.writePendingAnimation2DControllers();
    }

    parseElements(elements: Array<any>): any {
        this.elements = elements;

        this.overrides = [];
        this.nodeHooks = [];
        this.nodeMap = new Map();
        this.removedElements = new Set();
        this.inCanvas = 0;

        let ccAsset = elements[0];
        //ccAsset.name

        // 提前提取场景级阴影设置，供灯光组件解析器使用
        const sceneElement = elements[1];
        if (sceneElement && sceneElement.__type__ === "cc.Scene") {
            this.shadowsInfo = extractShadowsInfo(sceneElement, this.elements);
        } else {
            this.shadowsInfo = null;
        }

        // 第一阶段：解析所有节点（包括子节点），但不解析组件
        let node = this.parseNode(null, 1);
        node = Object.assign({ "_$ver": 1 }, node);
        if (node._$type === "Scene") {
            delete node.anchorY;
            let children: any[] = node._$child;
            if (children) {
                let scene3dNode: any;

                // 第一步：从根节点的直接子节点中提取 3D 节点
                for (let i = 0, n = children.length; i < n; i++) {
                    let child = children[i];
                    if (!child._$type || EditorEnv.typeRegistry.isDerivedOf(child._$type, "Sprite3D")) {
                        if (!scene3dNode) {
                            scene3dNode = {
                                "_$id": IEditorEnv.utils.genShortId(),
                                "_$type": "Scene3D",
                                "name": "Scene3D",
                                "_$child": []
                            };
                        }
                        scene3dNode._$child.push(child);
                        children.splice(i, 1);
                        i--;
                        n--;
                    }
                }
                
                // 第二步：递归检查所有 2D 节点，提取其中嵌套的 3D 节点
                const extracted3DNodes: any[] = [];
                for (let child of children) {
                    this.extractNested3DNodes(child, extracted3DNodes);
                }
                
                // 如果有嵌套的 3D 节点，确保 Scene3D 存在并添加这些节点
                if (extracted3DNodes.length > 0) {
                    if (!scene3dNode) {
                        scene3dNode = {
                            "_$id": IEditorEnv.utils.genShortId(),
                            "_$type": "Scene3D",
                            "name": "Scene3D",
                            "_$child": []
                        };
                    }
                    for (let node3d of extracted3DNodes) {
                        scene3dNode._$child.push(node3d);
                    }
                }
                
                if (scene3dNode) {
                    children.unshift(scene3dNode);

                    // 转换场景全局设置：从场景的 _globals 中提取各种信息
                    const sceneData = this.elements[1];
                    if (sceneData && sceneData.__type__ === "cc.Scene") {
                        // 转换 skybox
                        const skyboxInfo = extractSkyboxInfo(sceneData, this.elements);
                        if (skyboxInfo) {
                            convertSkyboxToLaya(skyboxInfo, scene3dNode, this.owner, this.currentTargetPath);
                        }

                        // 转换环境光照
                        const ambientInfo = extractAmbientInfo(sceneData, this.elements);
                        if (ambientInfo) {
                            convertAmbientToLaya(ambientInfo, scene3dNode);
                        }

                        // 转换雾效
                        const fogInfo = extractFogInfo(sceneData, this.elements);
                        if (fogInfo) {
                            convertFogToLaya(fogInfo, scene3dNode);
                        }

                        // 重构 Scene3D 对象：确保属性在 _$child 之前
                        // LayaAir 反序列化器要求属性在 _$child 之前才能正确读取
                        const savedChild = scene3dNode._$child;
                        delete scene3dNode._$child;
                        scene3dNode._$child = savedChild;
                    }
                }
            }
        }

        //有些节点不在children里，需要补充处理下
        let i = 0;
        for (let element of this.elements) {
            if (element.__type__ == "cc.Node" && !this.nodeMap.has(i)) {
                this.parseNode(element._parent ? this.nodeMap.get(element._parent.__id__) : null, i);
            }
            i++;
        }

        this.nodeHooks.forEach(hook => hook());

        return node;
    }

    async complete() {
        for (let [targetPath, task] of this.rewriteTasks) {
            let data = task.data;
            let overrides = task.overrides;
            this.elements = task.elements;
            this.nodeMap = task.nodeMap;
            this.nodeHooks = [];

            for (let info of overrides) {
                let targetInfo = this.overrideTargets.get(info.targetId);
                
                // 检查是否是组件属性覆盖（如 _materials, _mesh 等）
                const compPropertyMap: Record<string, string> = {
                    "_materials": "cc.MeshRenderer",
                    "_mesh": "cc.MeshRenderer",
                    "_shadowCastingMode": "cc.MeshRenderer",
                    "_shadowReceivingMode": "cc.MeshRenderer",
                };
                
                const propName = Array.isArray(info.propertyPath) ? info.propertyPath[0] : info.propertyPath;
                const inferredType = compPropertyMap[propName];
                
                // 对于预制体实例的组件属性覆盖，需要重新查找预制体内部的节点 ID
                // 因为 overrideTargets 中存储的是场景中临时创建的节点 ID，而不是预制体内部的节点 ID
                if (info.instanceNode._$prefab && inferredType) {
                    const prefabUuid = info.instanceNode._$prefab;
                    
                    // 组件属性覆盖：尝试从 LayaAir 预制体中获取节点 ID
                    logger.debug("PrefabConversion", `Trying to find prefab node for component override: targetId=${info.targetId}, prefabUuid=${prefabUuid}, inferredType=${inferredType}`);
                    const findResult = await this.findPrefabNodeIdByComponentFileId(prefabUuid, info.targetId, inferredType);
                    logger.debug("PrefabConversion", `findPrefabNodeIdByComponentFileId returned: ${findResult ? `nodeId=${findResult.nodeId}, actualCompType=${findResult.actualCompType}` : 'null'}`);

                    if (findResult) {
                        // 使用预制体内部的节点 ID 创建 targetInfo
                        // 强制使用 inferredType（如 cc.MeshRenderer）作为 compData.__type__，
                        // 因为只有 MeshRendererConversion 支持 override 模式，
                        // SkinnedMeshRendererConversion 会延迟到 hook 导致 props._$comp 为空
                        // 但记录实际的 LayaAir 组件类型，用于后续创建正确的 override entry
                        targetInfo = {
                            node: { _$type: "Sprite3D", _$id: findResult.nodeId },
                            parentNode: info.instanceNode,
                            compData: { __type__: inferredType },
                            actualLayaCompType: findResult.actualCompType
                        };
                        logger.debug("PrefabConversion", `Using prefab internal node ID: ${findResult.nodeId}, actualLayaCompType: ${findResult.actualCompType}`);
                    } else if (!targetInfo) {
                        logger.warn("PrefabConversion", `Cannot find prefab node for component fileId: ${info.targetId} in prefab ${prefabUuid}`);
                        continue;
                    }
                }
                // 如果找不到 targetInfo，尝试根据 propertyPath 推断
                else if (!targetInfo) {
                    if (info.instanceNode._$prefab) {
                        const prefabUuid = info.instanceNode._$prefab;
                        
                        // 节点属性覆盖：尝试从 LayaAir 预制体中根据节点 fileId 获取节点 ID
                        logger.debug("PrefabConversion", `Trying to find node for node property override: targetId=${info.targetId}, prefabUuid=${prefabUuid}, propName=${propName}`);
                        const nodeId = await this.findPrefabNodeIdByNodeFileId(prefabUuid, info.targetId);
                        
                        if (nodeId) {
                            // 创建一个虚拟的 targetInfo，用于处理节点属性覆盖
                            targetInfo = {
                                node: { _$type: "Sprite3D", _$id: nodeId },
                                parentNode: info.instanceNode,
                                compData: null
                            };
                            logger.debug("PrefabConversion", `Found prefab node ID: ${nodeId} for node fileId: ${info.targetId}`);
                        } else {
                            // 无法解析的覆写目标 → 跳过，防止错误地应用到根节点
                            logger.debug("PrefabConversion", `Skipping unresolvable node override: targetId=${info.targetId}, propName=${propName}`);
                            continue;
                        }
                    } else {
                        logger.warn("PrefabConversion", `cannot find override target: ${info.targetId} in ${targetPath}, inferredType=${inferredType}, hasPrefab=${!!info.instanceNode._$prefab}`);
                        continue;
                    }
                }

                let instanceNode = info.instanceNode;
                let targetNode = targetInfo.node;
                let compData = targetInfo.compData;
                let targetId = targetInfo.parentNode ? targetNode._$id : null;
                let parentNode = targetInfo.parentNode || info.instanceNodeParent;
                logger.debug("PrefabConversion", `Resolved: targetNode._$id=${targetNode._$id}, targetId=${targetId}, hasParentNode=${!!targetInfo.parentNode}, hasCompData=${!!compData}`);

                let is2d = EditorEnv.typeRegistry.isDerivedOf(targetNode._$type, "Sprite");

                if (info.propertyPath == "_$child") {
                    let entry = this.createOverrideEntry(instanceNode, targetId);
                    if (!entry._$child)
                        entry._$child = [];
                    entry._$child.push(info.value);
                }
                else if (info.propertyPath == "_$comp" || compData) {
                    let props: any = { _$type: targetNode._$type, _$child: [], _$comp: [] };
                    if (info.propertyPath == "_$comp")
                        this.parseComponent(props, info.value, false, is2d);
                    else {
                        // 处理数组属性覆盖，如 ["_materials", "0"] 表示覆盖 _materials[0]
                        let propValue = info.value;
                        if (info.propertyPath.length > 1) {
                            // 如果 propertyPath 有多个元素，说明是数组/对象的子属性
                            // 例如 ["_materials", "0"] 表示 _materials[0]
                            const arrayIndex = parseInt(info.propertyPath[1]);
                            if (!isNaN(arrayIndex)) {
                                // 构造数组，将值放在正确的索引位置
                                propValue = [];
                                propValue[arrayIndex] = info.value;
                            }
                        }
                        logger.debug("PrefabConversion", `Parsing component override: type=${compData.__type__}, propName=${info.propertyPath[0]}, propValue=${JSON.stringify(propValue)}`);
                        this.parseComponent(props, { __type__: compData.__type__, [info.propertyPath[0]]: propValue }, true, is2d);
                        logger.debug("PrefabConversion", `After parseComponent, props._$comp=${JSON.stringify(props._$comp)}`);
                    }
                    if (props._$comp.length > 0) {
                        let comp = props._$comp[0];
                        // 如果实际组件类型与推断类型不同（如 SkinnedMeshRenderer vs MeshRenderer），
                        // 使用实际类型创建 override entry，确保与预制体中的组件类型匹配
                        let overrideCompType = comp._$type;
                        if ((targetInfo as any)?.actualLayaCompType && (targetInfo as any).actualLayaCompType !== overrideCompType) {
                            logger.debug("PrefabConversion", `Remapping comp type: ${overrideCompType} -> ${(targetInfo as any).actualLayaCompType}`);
                            overrideCompType = (targetInfo as any).actualLayaCompType;
                        }
                        logger.debug("PrefabConversion", `Creating override entry: instanceNode._$id=${instanceNode._$id}, targetId=${targetId}, compType=${overrideCompType}`);
                        let entry = this.createOverrideEntry(instanceNode, targetId, overrideCompType);
                        delete comp._$type;
                        IEditorEnv.utils.mergeObjs(entry, comp, true);
                        logger.debug("PrefabConversion", `After merge, entry=${JSON.stringify(entry)}`);

                        if (info.propertyPath == "_$comp") {
                            entry._$type = entry._$override;
                            delete entry._$override;
                        }
                    }
                    if (!IEditorEnv.utils.isEmptyObj(props) && (props._$type == null || props._$type == targetNode._$type)) {
                        let entry = this.createOverrideEntry(instanceNode, targetId);
                        delete props._$type;
                        IEditorEnv.utils.mergeObjs(entry, props, true);
                    }
                }
                else {
                    let props: any = {};
                    this.parseNodeProps(parentNode, props, info.propertyPath[0], info.value, is2d, true);
                    let entry = this.createOverrideEntry(instanceNode, targetId);
                    IEditorEnv.utils.mergeObjs(entry, props, true);
                }
            }

            this.nodeHooks.forEach(hook => hook());
            // 对于 .ls 场景文件，使用 fs.writeFileSync 直接写入（保留 Scene3D 属性）
            // 对于 .lh 预制体文件，使用 writeJsonAsync 以触发 IDE 资源索引
            if (targetPath.endsWith(".ls")) {
                fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), "utf-8");
            } else {
                await IEditorEnv.utils.writeJsonAsync(targetPath, data);
            }
        }
    }

    private createOverrideEntry(prefabRootNode: any, targetId: string, compType?: string): any {
        logger.debug("PrefabConversion", `createOverrideEntry: prefabRootNode._$id=${prefabRootNode._$id}, prefabRootNode._$prefab=${prefabRootNode._$prefab}, targetId=${targetId}, compType=${compType}`);
        let entry: any;
        if (targetId) {
            if (!prefabRootNode._$child)
                prefabRootNode._$child = [];
            // 查找已存在的覆盖条目（通过 _$override 或 _$id 匹配）
            entry = prefabRootNode._$child.find((c: any) => c._$override === targetId || c._$id === targetId);
            logger.debug("PrefabConversion", `createOverrideEntry: Found existing entry: ${entry ? JSON.stringify(entry) : 'null'}`);
            if (!entry) {
                entry = { _$override: targetId };
                prefabRootNode._$child.push(entry);
                logger.debug("PrefabConversion", `createOverrideEntry: Created new entry with _$override=${targetId}`);
            }
        }
        else
            entry = prefabRootNode;
        if (compType) {
            if (!entry._$comp)
                entry._$comp = [];
            let comp = entry._$comp.find((c: any) => c._$override === compType);
            logger.debug("PrefabConversion", `createOverrideEntry: Found existing comp: ${comp ? JSON.stringify(comp) : 'null'}`);
            if (!comp) {
                comp = { _$override: compType };
                entry._$comp.push(comp);
                logger.debug("PrefabConversion", `createOverrideEntry: Created new comp with _$override=${compType}`);
            }
            return comp;
        }
        else
            return entry;
    }

    /**
     * 递归提取嵌套在 2D 节点中的 3D 节点
     * 在 LayaAir 中，3D 节点必须是 Scene3D 的子节点，不能嵌套在 2D 节点（如 GWidget）下
     * @param node 当前检查的节点
     * @param extracted3DNodes 用于收集提取出的 3D 节点的数组
     */
    private extractNested3DNodes(node: any, extracted3DNodes: any[]): void {
        if (!node._$child || node._$child.length === 0) {
            return;
        }
        
        // 检查当前节点是否是 2D 节点
        const is2DNode = node._$type && (
            node._$type === "GWidget" ||
            node._$type === "GImage" ||
            node._$type === "GTextField" ||
            node._$type === "GButton" ||
            node._$type === "GBox" ||
            node._$type === "GPanel" ||
            node._$type === "GList" ||
            node._$type === "GProgressBar" ||
            node._$type === "GSlider" ||
            node._$type === "GTextInput" ||
            node._$type === "GLoader" ||
            EditorEnv.typeRegistry.isDerivedOf(node._$type, "Sprite")
        );
        
        if (is2DNode) {
            // 从 2D 节点中提取 3D 子节点
            const children = node._$child;
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                const is3DChild = !child._$type || EditorEnv.typeRegistry.isDerivedOf(child._$type, "Sprite3D");
                
                if (is3DChild) {
                    // 将 3D 节点从 2D 父节点中移除，并添加到提取列表
                    console.warn(`[PrefabConversion] Extracting 3D node "${child.name || 'unnamed'}" from 2D parent "${node.name || 'unnamed'}"`);
                    extracted3DNodes.push(child);
                    children.splice(i, 1);
                }
            }
            
            // 如果移除后 _$child 为空，删除该属性
            if (children.length === 0) {
                delete node._$child;
            }
        }
        
        // 递归检查剩余的子节点
        if (node._$child) {
            for (const child of node._$child) {
                this.extractNested3DNodes(child, extracted3DNodes);
            }
        }
    }

    private parseNode(parentNode: any, dataId: number): any {
        let node: any = { _$id: IEditorEnv.utils.genShortId() };
        this.nodeMap.set(dataId, node);
        let elements = this.elements;
        let data = elements[dataId];

        if (data._prefab) {
            let prefabInfo = elements[data._prefab.__id__];
            let prefabInst = prefabInfo.instance ? elements[prefabInfo.instance.__id__] : null;
            if (prefabInst) {
                node._$prefab = prefabInfo.asset.__uuid__.split("@")[0];
                let propertyOverrides: any[] = prefabInst.propertyOverrides;
                console.log(`[PrefabConversion] parseNode: prefab=${node._$prefab}, propertyOverrides.length=${propertyOverrides?.length || 0}`);
                if (propertyOverrides?.length > 0) {
                    for (let idInfo of propertyOverrides) {
                        let info = elements[idInfo.__id__];
                        if (!info.targetInfo) {
                            console.log(`[PrefabConversion] Skipping override without targetInfo: propertyPath=${JSON.stringify(info.propertyPath)}`);
                            continue;
                        }

                        let targetId = elements[info.targetInfo.__id__].localID[0];
                        console.log(`[PrefabConversion] Adding override: targetId=${targetId}, propertyPath=${JSON.stringify(info.propertyPath)}, value=${JSON.stringify(info.value)?.substring(0, 100)}`);
                        this.overrides.push({
                            targetId,
                            propertyPath: info.propertyPath,
                            value: info.value,
                            instanceNode: node,
                            instanceNodeParent: parentNode
                        });
                    }
                }
                if (prefabInst.mountedComponents?.length > 0) {
                    for (let idInfo of prefabInst.mountedComponents) {
                        let info = elements[idInfo.__id__];
                        if (!info.targetInfo)
                            continue;

                        let targetId = elements[info.targetInfo.__id__].localID[0];
                        for (let item of info.components) {
                            if (item != null)
                                this.overrides.push({
                                    targetId,
                                    propertyPath: "_$comp",
                                    value: elements[item.__id__],
                                    instanceNode: node,
                                    instanceNodeParent: parentNode
                                });
                        }
                    }
                }
                if (prefabInst.mountedChildren?.length > 0) {
                    for (let idInfo of prefabInst.mountedChildren) {
                        let info = elements[idInfo.__id__];
                        if (!info.targetInfo)
                            continue;

                        let targetId = elements[info.targetInfo.__id__].localID[0];
                        for (let item of info.nodes) {
                            if (item) {
                                let mountedChild = this.parseNode(node, item.__id__);
                                this.overrides.push({
                                    targetId,
                                    propertyPath: "_$child",
                                    value: mountedChild,
                                    instanceNode: node,
                                    instanceNodeParent: parentNode
                                });
                            }
                        }
                    }
                }

                return node;
            }
            else if (prefabInfo.fileId) {
                this.overrideTargets.set(prefabInfo.fileId, { node, parentNode });
            }
        }

        let isCanvas = data._components && data._components.findIndex((comp: any) =>
            elements[comp.__id__].__type__ === "cc.Canvas") >= 0;
        if (isCanvas)
            this.inCanvas++;

        let is2d = this.inCanvas > 0 || data._components && data._components.findIndex((comp: any) =>
            elements[comp.__id__].__type__ === "cc.UITransform") >= 0;

        if (data.__type__ != "cc.Scene") {
            if (is2d)
                node._$type = "GWidget";
            else
                node._$type = "Sprite3D";

            for (let k in data) {
                this.parseNodeProps(parentNode, node, k, data[k], is2d);
            }
        }
        else {
            node._$type = "Scene";
            node.name = "Scene2D";
            //子节点需要这个计算坐标
            let ccResolution = this.owner.projectConfig.general.designResolution;
            node.width = ccResolution.width;
            node.height = ccResolution.height;
            node.anchorY = 1;

            let resolution = EditorEnv.playerSettings.data.resolution;
            if (node.width === resolution.designWidth && node.height === resolution.designHeight) {
                node.left = 0;
                node.right = 0;
                node.top = 0;
                node.bottom = 0;
            }
        }

        node._$child = [];
        node._$comp = [];

        // 解析组件
        if (data._components?.length > 0) {
            let spriteData: any;
            for (let idInfo of data._components) {
                let compData = elements[idInfo.__id__];
                if (compData.__prefab) {
                    let prefabInfo = elements[compData.__prefab.__id__];
                    if (prefabInfo.fileId)
                        this.overrideTargets.set(prefabInfo.fileId, { node, parentNode, compData });
                }

                if (compData.__type__ === "cc.Sprite") { //放最后处理
                    spriteData = compData;
                    continue;
                }
                // 直接解析组件
                this.parseComponent(node, compData, false, is2d);
            }
            // 最后解析 cc.Sprite 组件（保持原有逻辑）
            if (spriteData)
                this.parseComponent(node, spriteData, false, is2d);
        }

        // 修复 FBX 模型节点的缩放差异
        // LayaAir 的 convertUnits=1 强制按厘米处理，但 FBX 的 UnitScaleFactor 可能不为 1
        // Cocos 使用 UnitScaleFactor×0.01，LayaAir 固定 0.01，差异 = UnitScaleFactor
        // 仅当 UnitScaleFactor != 1 时需要补偿（如英寸 FBX 的 USF=2.54）
        if (!is2d && node._$comp) {
            const meshFilterComp = node._$comp.find((c: any) => c._$type === "MeshFilter");
            const hasSkinnedMeshRenderer = node._$comp.some((c: any) => c._$type === "SkinnedMeshRenderer");
            if (meshFilterComp && !hasSkinnedMeshRenderer) {
                const meshUuid = meshFilterComp.sharedMesh?._$uuid;
                const fbxUuid = meshUuid?.split("@")[0];
                const fbxAsset = fbxUuid ? this.owner.allAssets.get(fbxUuid) : null;
                const unitScaleFactor = fbxAsset?.userData?.unitScaleFactor ?? 1;

                if (unitScaleFactor !== 1) {
                    if (!node.transform)
                        node.transform = {};
                    if (node.transform.localScale) {
                        node.transform.localScale.x *= unitScaleFactor;
                        node.transform.localScale.y *= unitScaleFactor;
                        node.transform.localScale.z *= unitScaleFactor;
                    } else {
                        node.transform.localScale = {
                            _$type: "Vector3",
                            x: unitScaleFactor,
                            y: unitScaleFactor,
                            z: unitScaleFactor
                        };
                    }
                    logger.debug("PrefabConversion", `Fixed FBX scale for ${node.name}: ×${unitScaleFactor} (UnitScaleFactor)`);
                }
            }
        }

        if (data._children?.length > 0) {
            for (let idInfo of data._children) {
                if (this.removedElements.has(idInfo.__id__))
                    continue;

                let childNode = this.parseNode(node, idInfo.__id__);
                if (!childNode)
                    continue;

                if (is2d) {
                    if (childNode._$type == "Camera") {
                        childNode._$type = "Sprite";
                        delete childNode.transform;
                    }

                    if (childNode.x == null) { //坐标需要转换，所以必须处理
                        childNode.x = (node.anchorX ?? 0) * (node.width ?? 0);
                        childNode.y = (node.anchorY ?? 1) * (node.height ?? 0);
                    }
                }

                node._$child.push(childNode);
            }
        }

        if (node._$child.length == 0)
            delete node._$child;
        if (node._$comp.length == 0)
            delete node._$comp;

        if (isCanvas)
            this.inCanvas--;

        return node;
    }


    private parseNodeProps(parentNode: any, node: any, key: string, value: any, is2d: boolean, isOverride?: boolean) {
        switch (key) {
            case "_name":
                node.name = value;
                break;
            case "_active":
                logger.debug("PrefabConversion", `parseNodeProps _active: node=${node.name}, value=${value}, is2d=${is2d}, isOverride=${isOverride}`);
                if (value === false || isOverride) {
                    if (is2d)
                        node.visible = value;
                    else
                        node.active = value;
                    logger.debug("PrefabConversion", `Set active=${value} for node ${node.name}`);
                }
                break;
            case "_lpos":
                if (is2d) {
                    if (parentNode) {
                        /**
                        * cocos子节点原点在父节点的锚点，Laya子节点原点固定在父节点左上角，不受锚点影响
                        * cocos是左下角为原点，Y轴向上，Laya是左上角为原点，Y轴向下
                        */
                        node.x = value.x + (parentNode.anchorX ?? 0) * (parentNode.width ?? 0);
                        node.y = -value.y + (parentNode.anchorY ?? 0) * (parentNode.height ?? 0);
                    }
                    else {
                        node.x = value.x;
                        node.y = value.y;
                    }
                }
                else {
                    if (isOverride || (value.x !== 0 || value.y !== 0 || value.z !== 0)) {
                        if (!node.transform)
                            node.transform = {};
                        const converted = convertTransformFromCocos(value);
                        node.transform.localPosition = { _$type: "Vector3", x: converted.x, y: converted.y, z: converted.z };
                    }
                }
                break;
            case "_lrot":
                if (is2d) {
                    if (isOverride || value.z !== 0)
                        node.rotation = value.z;
                }
                else {
                    if (isOverride || !(value.x === 0 && value.y === 0 && value.z === 0 && value.w === 1)) {
                        if (!node.transform)
                            node.transform = {};
                        const converted = convertQuaternionFromCocos(value);
                        node.transform.localRotation = { _$type: "Quaternion", x: converted.x, y: converted.y, z: converted.z, w: converted.w };
                    }
                }
                break;
            case "_lscale":
                if (is2d) {
                    if (isOverride || (value.x !== 1 || value.y !== 1)) {
                        node.scaleX = value.x;
                        node.scaleY = value.y;
                    }
                }
                else {
                    if (isOverride || (value.x !== 1 || value.y !== 1 || value.z !== 1)) {
                        if (!node.transform)
                            node.transform = {};
                        const converted = convertScaleFromCocos(value);
                        node.transform.localScale = { _$type: "Vector3", x: converted.x, y: converted.y, z: converted.z };
                    }
                }
                break;
        }
    }

    private parseComponent(node: any, data: any, isOverride?: boolean, is2d?: boolean): void {
        if (!data || !data.__type__)
            return;

        const type = data.__type__;
        const externalParser = getComponentParser(type);
        if (externalParser) {
            const result = externalParser({
                conversion: this,
                owner: this.owner,
                node,
                data,
                isOverride: !!isOverride,
                is2d: !!is2d
            });
            if (result !== false)
                return;
        }
        switch (type) {
            case "cc.UITransform": {
                let contentSize = data._contentSize;
                if (contentSize) {
                    node.width = contentSize.width;
                    node.height = contentSize.height;
                }
                let anchor = data._anchorPoint;
                if (anchor && (isOverride || anchor.x !== 0)) {
                    node.anchorX = anchor.x;
                }
                if (anchor && (isOverride || anchor.y !== 1)) {
                    node.anchorY = 1 - anchor.y;
                }
                break;
            }

            case "cc.LabelOutline":
                //since v3.8.2, please use [[Label.enableOutline]] instead.
                break;

            case "cc.LabelShadow":
                console.warn("LabelShadow conversion not implemented yet.");
                break;

            case "cc.UIOpacity":
                if (data._opacity != null)
                    node.alpha = data._opacity / 255;
                break;

            case "cc.UISkew":
                if (data._skew != null && (isOverride || data._skew.x !== 0 || data._skew.y !== 0)) {
                    node.skewX = -data._skew.x;
                    node.skewY = -data._skew.y;
                }
                break;

            case "cc.Widget": {
                if (isOverride) {
                    //暂时没办法支持cc.Widget的override，因为分不清是哪个
                    break;
                }
                if (!node.relations)
                    node.relations = [];
                let relation: any = { _$type: "Relation", data: [] };
                node.relations.push(relation);
                let targetId = data._target ? data._target.__id__ : this.getNodeParentId(this.elements[this.getComponentOwnerId(data)]);
                if (targetId) {
                    this.nodeHooks.push(() => {
                        let targetNode = this.nodeMap.get(targetId);
                        if (targetNode)
                            relation.target = { _$ref: targetNode._$id };
                    });
                }
                let alignFlags = data._alignFlags;
                if (alignFlags != null) {
                    if (alignFlags & 8 && alignFlags & 32)
                        relation.data.push(1, 0);
                    else if (alignFlags & 8) //left
                        relation.data.push(3, 0);
                    else if (alignFlags & 16) //center
                        relation.data.push(6, 0);
                    else if (alignFlags & 32) //right
                        relation.data.push(7, 0);

                    if (alignFlags & 1 && alignFlags & 4)
                        relation.data.push(2, 0);
                    else if (alignFlags & 1) //top
                        relation.data.push(10, 0);
                    else if (alignFlags & 2) //middle
                        relation.data.push(13, 0);
                    else if (alignFlags & 4) //bottom
                        relation.data.push(14, 0);
                }

                break;
            }

            case "cc.Sprite": {
                if ((node._$type === "GWidget" || node._$type === "GImage") && !node.mask) {
                    node._$type = "GImage";
                    if (data._spriteFrame) {
                        let spf = this.getSpriteFrame(data._spriteFrame.__uuid__);
                        if (spf) {
                            node.src = "res://" + spf.uuid;
                            if (spf.width !== node.width || spf.height !== node.height)
                                node.autoSize = false;
                        }
                    }
                    if (data._color) {
                        node.color = colorToHexString(data._color);
                        if (data._color.a !== 255)
                            node.alpha = data._color.a / 255;
                    }
                    if (data._useGrayscale || isOverride)
                        node.grayed = data._useGrayscale;
                    if (data._type == 2) { //tiled
                        node.mesh = { "_$type": "TiledMesh" };
                    }
                    else if (data._type == 3) { //filled
                        let mesh: any = node.mesh = { "_$type": "ProgressMesh" };
                        let center = data._fillCenter;
                        if (data._fillType === 0) { //水平
                            mesh.method = 1;
                        }
                        else if (data._fillType === 1) { //垂直
                            mesh.method = 2;
                        }
                        else {
                            if (center.x === 0 && center.y === 0) {
                                mesh.method = 3; //90
                                mesh.origin = 2; //bottom-left
                            }
                            else if (center.x === 1 && center.y === 0) {
                                mesh.method = 3; //90
                                mesh.origin = 3; //bottom-right
                            }
                            else if (center.x === 1 && center.y === 1) {
                                mesh.method = 3; //90
                                mesh.origin = 1; //top-right
                            }
                            else if (center.x === 0 && center.y === 1) {
                                mesh.method = 3; //90
                                mesh.origin = 0; //top-left
                            }
                            else if (center.x === 0.5 && center.y === 0) {
                                mesh.method = 4; //180
                                mesh.origin = 1; //bottom
                            }
                            else if (center.x === 1 && center.y === 0.5) {
                                mesh.method = 4; //180
                                mesh.origin = 3; //right
                            }
                            else if (center.x === 0.5 && center.y === 1) {
                                mesh.method = 4; //180
                                mesh.origin = 0; //top
                            }
                            else if (center.x === 0 && center.y === 0.5) {
                                mesh.method = 4; //180
                                mesh.origin = 2; //left
                            }
                            else
                                mesh.method = 5; //360
                        }
                        mesh.amount = data._fillRange >= 0 ? data._fillRange : (1 + data._fillRange);
                    }
                    return node;
                }
                else if ((node._$type === "GPanel" || node._$type === "GList"
                    || node._$type === "GProgressBar" || node._$type === "GSlider") && data._spriteFrame) {
                    let spf = this.getSpriteFrame(data._spriteFrame.__uuid__);
                    if (spf) {
                        node.background = {
                            "_$type": spf.hasSizeGrid ? "Draw9GridTextureCmd" : "DrawTextureCmd",
                            "texture": {
                                "_$uuid": spf.uuid,
                                "_$type": "Texture"
                            }
                        };
                    }
                }
                break;
            }

            case "cc.Label":
            case "cc.RichText": {
                node._$type = "GTextField";
                node.fontSize = data._fontSize;
                if (data._fontColor)
                    node.color = colorToHexString(data._fontColor);
                else if (data._color)
                    node.color = colorToHexString(data._color);
                if (data._fontFamily !== "Arial")
                    node.font = data._fontFamily;
                if (data._maxWidth)
                    node.maxWidth = data._maxWidth;
                if (data._horizontalAlign)
                    node.align = data._horizontalAlign === 2 ? "right" : data._horizontalAlign === 1 ? "center" : "left";
                if (data._verticalAlign)
                    node.valign = data._verticalAlign === 2 ? "bottom" : data._verticalAlign === 1 ? "middle" : "top";
                node.leading = data._lineHeight - data._fontSize;
                if (data.__type__ === "cc.RichText") {
                    node.html = true;
                    if (data._string != null)
                        node.text = data._string.replaceAll("<color=", "<font color=").replaceAll("</color>", "</font>")
                            .replaceAll("<size=", "<font size=").replaceAll("</size>", "</font>");
                }
                else
                    node.text = data._string;
                break;
            }

            case "cc.Mask": {
                if (isOverride)
                    break;

                let maskNode: any = {
                    "_$id": IEditorEnv.utils.genShortId(),
                    "_$type": "GWidget",
                    "name": "mask",
                    "width": node.width,
                    "height": node.height,
                    "relations": [
                        {
                            "_$type": "Relation",
                            "data": [1, 0, 2, 0],
                            "target": { "_$ref": node._$id }
                        }
                    ]
                };

                let shapeData = this.createShape(this.findComponent(data, "cc.Sprite"));
                if (shapeData)
                    maskNode.background = shapeData;
                // 确保 _$child 存在（可能在 parseNode 中被删除了）
                if (!Array.isArray(node._$child))
                    node._$child = [];
                node._$child.push(maskNode);
                node.mask = { _$ref: maskNode._$id };
                break;
            }

            case "cc.Button": {
                this.createButton(node, data);
                break;
            }

            case "cc.Toggle": {
                node.mode = 1;
                this.createButton(node, data);
                if (data._isChecked || isOverride)
                    node.selected = data._isChecked;
                if (data._checkMark) {
                    let checkMarkId = this.getNodeId(data._checkMark);
                    this.nodeHooks.push(() => {
                        let checkMark = this.nodeMap.get(checkMarkId);
                        delete checkMark.active;
                        if (!checkMark.gears)
                            checkMark.gears = [];
                        checkMark.gears.push({
                            "_$type": "GearDisplay",
                            "controller": {
                                "_$ref": node._$id,
                                "_$ctrl": "button"
                            },
                            "pages": [
                                1, 3
                            ]
                        });
                    });
                }
                break;
            }

            case "cc.ToggleContainer": {
                if (!node.width)
                    node.width = 100;
                if (!node.height)
                    node.height = 30;
                this.nodeHooks.push(() => {
                    let cnt = 0;
                    if (node._$child) {
                        node._$child.forEach((child: any) => {
                            if (child._$type === "GButton" && child.mode === 1) {
                                child.mode = 2;
                                child.selectedController = {
                                    "_$ref": node._$id,
                                    "_$ctrl": "c1"
                                };
                                child.selectedPage = cnt;
                                cnt++;
                            }
                        });
                        node.controllers = {
                            "_$type": "Record",
                            "c1": {
                                "_$type": "Controller",
                                "pages": new Array(cnt).fill("")
                            },
                        };
                    }
                });
                break;
            }

            case "cc.ProgressBar": {
                node._$type = "GProgressBar";
                node.value = data._progress;
                node.max = 1;
                if (data._reverse)
                    node._reverse = data._reverse;
                if (data._barSprite) {
                    let barSpriteId = this.getNodeId(data._barSprite);
                    this.nodeHooks.push(() => {
                        let barSprite = this.nodeMap.get(barSpriteId);
                        if (data._mode === 1)
                            node._vBar = { "_$ref": barSprite._$id };
                        else
                            node._hBar = { "_$ref": barSprite._$id };
                    });
                }
                break;
            }

            case "cc.Slider":
                node._$type = "GSlider";
                node.value = data._progress;
                node.max = 1;
                let barSprite: any = {
                    "_$id": IEditorEnv.utils.genShortId(),
                    "_$type": "GWidget",
                    "name": "bar",
                };
                node._$child.push(barSprite);
                if (node._direction === 1) {
                    barSprite.width = node.width;
                    barSprite.height = node.height * data._progress;
                    node._vBar = { "_$ref": barSprite._$id };
                }
                else {
                    barSprite.width = node.width * data._progress;
                    barSprite.height = node.height;
                    node._hBar = { "_$ref": barSprite._$id };
                }

                if (data._handle) {
                    let handleId = this.getNodeId(data._handle);
                    this.nodeHooks.push(() => {
                        let handle = this.nodeMap.get(handleId);
                        if (!handle.relations)
                            handle.relations = [];
                        handle.relations.push({
                            "_$type": "Relation",
                            "data": node._direction === 1 ? [12, 0] : [5, 0], //top-bottom or left-right
                            "target": { "_$ref": barSprite._$id }
                        });
                        node._gripButton = { "_$ref": handle._$id };
                    });
                }
                break;

            case "cc.EditBox": {
                node._$type = "GTextInput";
                if (data._textLabel) {
                    let labelNodeId = this.getNodeId(data._textLabel);
                    this.removedElements.add(labelNodeId);
                    let textLabelNode = this.parseNode(node, labelNodeId);
                    const textProps = ["color", "fontSize", "font", "align", "valign", "maxWidth", "leading", "html"];
                    for (let k in textProps) {
                        let prop = textProps[k];
                        if (textLabelNode[prop] !== undefined)
                            node[prop] = textLabelNode[prop];
                    }
                }
                if (data._placeholderLabel) {
                    let labelNodeId = this.getNodeId(data._placeholderLabel);
                    this.removedElements.add(labelNodeId);
                    let placeholderLabelNode = this.parseNode(node, labelNodeId);
                    if (placeholderLabelNode.color)
                        node.promptColor = placeholderLabelNode.color;
                    if (placeholderLabelNode.text)
                        node.prompt = placeholderLabelNode.text;
                }
                if (data._backgroundImage) {
                    let spf = this.getSpriteFrame(data._backgroundImage.__uuid__);
                    if (spf) {
                        node.background = {
                            "_$type": spf.hasSizeGrid ? "Draw9GridTextureCmd" : "DrawTextureCmd",
                            "texture": {
                                "_$uuid": spf.uuid,
                                "_$type": "Texture"
                            }
                        };
                    }
                }
                if (data._inputFlag === 0)
                    node.type = "password";
                node.text = data._string;
                break;
            }

            case "cc.Layout": {
                node._$type = "GBox";
                node.layout = { foldInvisibles: true };
                if (data._layoutType === 1) { //单行
                    node.layout.type = 2;
                    if (!data._isAlign)
                        node.layout.valign = 3;
                    else
                        node.layout.valign = 1;
                    if (data._resizeMode === 1) { //container
                        node.layout.stretchX = 1;
                    }
                    else if (data._resizeMode === 2) { //children
                        node.layout.stretchX = 2;
                    }
                }
                else if (data._layoutType === 2) { //单列
                    node.layout.type = 1;
                    if (!data._isAlign)
                        node.layout.align = 3;
                    else
                        node.layout.align = 1;
                    if (data._resizeMode === 1) { //container
                        node.layout.stretchY = 1;
                    }
                    else if (data._resizeMode === 2) { //children
                        node.layout.stretchY = 2;
                    }
                }
                else if (data._layoutType === 3) { //网格
                    if (data._startAxis === 0)
                        node.layout.type = 3;
                    else
                        node.layout.type = 4;
                    if (data._resizeMode === 1) { //container
                        node.layout.stretchX = 1;
                        node.layout.stretchY = 1;
                    }
                    else if (data._resizeMode === 2) { //children
                        node.layout.stretchX = 2;
                        node.layout.stretchY = 2;
                    }
                }

                if (data._paddingLeft !== 0 || data._paddingRight !== 0 || data._paddingTop !== 0 || data._paddingBottom !== 0) {
                    node.layout.padding = [
                        data._paddingTop,
                        data._paddingRight,
                        data._paddingBottom,
                        data._paddingLeft
                    ];
                }
                if (data._spacingX !== 0)
                    node.layout.columnGap = data._spacingX;
                if (data._spacingY !== 0)
                    node.layout.rowGap = data._spacingY;

                break;
            }

            case "cc.ScrollView": {
                if (data._content)
                    this.moveContentNodes(node, data, data._content);
                if (data.horizontal || data.vertical) {
                    let scroller: any = node.scroller = { _$type: "Scroller" };
                    if (node.horizontal && node.vertical)
                        scroller.direction = 2;
                    else if (node.horizontal)
                        scroller.direction = 1;
                }

                if (data._horizontalScrollBar) {
                    this.removeElement(data._horizontalScrollBar);
                }
                if (data._verticalScrollBar) {
                    this.removeElement(data._verticalScrollBar);
                }

                node._$type = "GPanel";
                break;
            }

            case "cc.PageView": {
                node._$type = "GPanel";
                if (data._content)
                    this.moveContentNodes(node, data, data._content);
                if (data._indicator)
                    this.removeElement(data._indicator);
                node.layout = {
                    "type": 2,
                    "pageMode": true,
                    "valign": 1
                };
                node.scroller = {
                    "_$type": "Scroller",
                    "direction": 1,
                    "barDisplay": 5,
                    "pageMode": true
                };
                break;
            }

            case "cc.Canvas":
            case "cc.Graphics":
                break;

            // case "cc.Camera": {
            //     node._$type = "Camera";
            //     node.clearColor = colorToLayaColor(data._color);
            //     break;
            // }

            // case "cc.DirectionalLight": {
            //     let comp: any = { _$type: "DirectionLightCom" };
            //     comp.color = colorToLayaColor(data._color);
            //     node._$comp.push(comp);
            //     break;
            // }

            default:
                console.warn(`ignoring component: ${data.__type__}`);
                break;
        }
    }

    private getNodeId(idInfo: any): number {
        let p = this.elements[idInfo.__id__];
        return p.node ? p.node.__id__ : idInfo.__id__;
    }

    private getNodeParentId(data: any): number {
        return data._parent?.__id__ || data.__editorExtras__?.mountedRoot?.__id__;
    }

    private getComponentOwnerId(data: any): number {
        return data.node?.__id__ || data.__editorExtras__?.mountedRoot?.__id__;
    }

    private findComponent(nodeOrAnyComp: any, compType: string): any {
        let components = nodeOrAnyComp._components || this.elements[this.getComponentOwnerId(nodeOrAnyComp)]?._components;
        if (!components)
            return null;

        for (let idInfo of components) {
            let comp = this.elements[idInfo.__id__];
            if (comp.__type__ === compType) {
                return comp;
            }
        }
        return null;
    }

    private removeElement(idInfo: any): void {
        let id = typeof (idInfo) === "object" ? idInfo.__id__ : idInfo;
        let p = this.elements[id];
        if (p.node)
            id = p.node.__id__;
        this.removedElements.add(id);
    }

    private moveContentNodes(node: any, data: any, contentIdInfo: any) {
        let nodeId = this.getComponentOwnerId(data);
        let p = contentIdInfo.__id__;
        while (p) {
            let p2 = this.getNodeParentId(this.elements[p]);
            if (!p2 || p2 === nodeId)
                break;

            p = p2;
        }
        let viewNode = this.parseNode(node, p);
        this.removeElement(p);
        let contentNode = this.nodeMap.get(contentIdInfo.__id__);

        if (contentNode._$child) {
            // 确保目标节点的 _$child 存在（可能在 parseNode 中被删除了）
            if (!Array.isArray(node._$child))
                node._$child = [];
            for (let child of contentNode._$child) {
                if (viewNode != contentNode) {
                    child.x += viewNode.x - (viewNode.anchorX ?? 0) * viewNode.width;
                    child.y += viewNode.y - (viewNode.anchorY ?? 0) * viewNode.height;
                }
                child.x += contentNode.x - (contentNode.anchorX ?? 0) * contentNode.width;
                child.y += contentNode.y - (contentNode.anchorY ?? 0) * contentNode.height;
                node._$child.push(child);
            }
        }
    }

    private createButton(node: any, data: any) {
        node._$type = "GButton";
        node.controllers = {
            "_$type": "Record",
            "button": {
                "_$type": "Controller",
                "pages": [
                    "up",
                    "down",
                    "over",
                    "selectedOver"
                ]
            },
        };
        node._$child = [
            {
                "_$id": IEditorEnv.utils.genShortId(),
                "_$type": "GLoader",
                "name": "loader",
                "width": node.width,
                "height": node.height,
                "fitMode": 1,
                "gears": [],
                "relations": [
                    {
                        "_$type": "Relation",
                        "target": {
                            "_$ref": node._$id
                        },
                        "data": [
                            1,
                            0,
                            2,
                            0
                        ]
                    }
                ]
            }
        ];
        if (!data._interactable)
            node._mouseState = 1;

        let loader = node._$child[0];
        let sprite = this.findComponent(data, "cc.Sprite");
        if (sprite) {
            if (sprite._spriteFrame) {
                let spf = this.getSpriteFrame(sprite._spriteFrame.__uuid__);
                if (spf)
                    loader.src = "res://" + spf.uuid;
            }
            if (sprite._color)
                loader.color = colorToHexString(sprite._color);
        }

        if (data._transition === 0) { //none
        }
        else if (data._transition === 1) { //color
            loader.gears.push({
                "_$type": "GearStrColor",
                "controller": {
                    "_$ref": node._$id,
                    "_$ctrl": "button"
                },
                "propPath": "color",
                "values": {
                    "_$type": "Record"
                }
            });
            let values = loader.gears[0].values;
            loader.color = colorToHexString(data._normalColor);
            if (data._hoverColor)
                values["2"] = colorToHexString(data._hoverColor);
            if (data._pressedColor) {
                values["1"] = colorToHexString(data._pressedColor);
                values["3"] = colorToHexString(data._pressedColor);
            }
        }
        else if (data._transition === 2) { //sprite
            loader.gears.push({
                "_$type": "GearString",
                "controller": {
                    "_$ref": node._$id,
                    "_$ctrl": "button"
                },
                "propPath": "src",
                "values": {
                    "_$type": "Record"
                }
            });
            let values = loader.gears[0].values;
            if (data._hoveredSprite) {
                let spf = this.getSpriteFrame(data._hoveredSprite.__uuid__);
                if (spf)
                    values[2] = "res://" + spf.uuid;
            }
            if (data._pressedSprite) {
                let spf = this.getSpriteFrame(data._pressedSprite.__uuid__);
                if (spf) {
                    values[1] = "res://" + spf.uuid;
                    values[3] = "res://" + spf.uuid;
                }
            }
        }
        else if (data._transition === 3) { //scale
            if (data._zoomScale > 1) {
                node.downEffect = 2;
            }
            else {
                node.downEffect = 3;
            }
        }
    }

    private createShape(spriteData: any) {
        if (!spriteData)
            return null;

        let shape = spriteData._type;
        if (shape == 1) {
            return {
                "_$type": "DrawEllipseCmd",
                "x": 0.5,
                "y": 0.5,
                "width": 0.5,
                "height": 0.5,
                "percent": true,
                "lineWidth": 0,
                "fillColor": "#ffffff"
            };
        }
        else if (shape == 3) {
            if (spriteData && spriteData._spriteFrame) {
                let spf = this.getSpriteFrame(spriteData._spriteFrame.__uuid__);
                if (spf) {
                    return {
                        "_$type": "DrawTextureCmd",
                        "texture": {
                            "_$uuid": spf.uuid,
                            "_$type": "Texture"
                        }
                    };
                }
            }
        }
        else {
            return {
                "_$type": "DrawRectCmd",
                "fillColor": "#ffffff"
            };
        }

        return null;
    }

    private _spriteFrameCache: Map<string, any> = new Map();
    getSpriteFrame(uuid: string): { uuid: string, width: number, height: number, hasSizeGrid?: boolean } | null {
        let res = this._spriteFrameCache.get(uuid);
        if (res)
            return res;

        let asset = this.owner.allAssets.get(uuid);
        if (!asset) {
            console.warn("missing spriteFrame asset: " + uuid);
            return null;
        }

        let data = asset.userData;
        res = {
            uuid: uuid.split("@")[0],
            width: data.width,
            height: data.height,
            hasSizeGrid: data.borderTop !== 0 || data.borderBottom !== 0 || data.borderLeft !== 0 || data.borderRight !== 0
        };

        this._spriteFrameCache.set(uuid, res);
        return res;
    }

    /**
     * 从 LayaAir 预制体中查找包含指定组件的节点 ID
     * 通过读取 Cocos 原始预制体文件，根据 fileId 找到节点名称，
     * 然后在 LayaAir 转换后的预制体中通过节点名称匹配找到对应的 _$id
     * @param prefabUuid 预制体 UUID
     * @param componentFileId Cocos 组件的 fileId
     * @param componentType 组件类型（如 cc.MeshRenderer）
     * @returns LayaAir 预制体中节点的 _$id，如果找不到则返回 null
     */
    private async findPrefabNodeIdByComponentFileId(prefabUuid: string, componentFileId: string, componentType: string): Promise<{ nodeId: string, actualCompType: string } | null> {
        try {
            // 1. 首先读取 Cocos 原始预制体文件，找到 fileId 对应的节点名称
            logger.debug("PrefabConversion", `findPrefabNodeIdByComponentFileId: cocosProjectRoot=${this.owner.cocosProjectRoot}`);
            const prefabDir = fpath.join(this.owner.cocosProjectRoot, "library", prefabUuid.substring(0, 2));

            logger.debug("PrefabConversion", `findPrefabNodeIdByComponentFileId: prefabUuid=${prefabUuid}, componentFileId=${componentFileId}`);

            // 动态查找 Cocos library 中匹配的 prefab JSON 文件
            // 不同 Cocos 项目的 FBX sub-asset ID 不同（如 @d9541, @74dd3 等）
            let cocosPrefabPath: string | null = null;
            if (fs.existsSync(prefabDir)) {
                const files = fs.readdirSync(prefabDir);
                // 优先查找带 @ 后缀的 JSON 文件（FBX 导入的预制体）
                const prefabFiles = files.filter((f: string) => f.startsWith(prefabUuid) && f.endsWith('.json'));
                logger.debug("PrefabConversion", `Found ${prefabFiles.length} candidate files: ${prefabFiles.join(', ')}`);

                // 遍历候选文件，找到包含 cc.Prefab 类型的文件（即预制体数据文件）
                for (const file of prefabFiles) {
                    const candidatePath = fpath.join(prefabDir, file);
                    try {
                        const candidateData = await IEditorEnv.utils.readJsonAsync(candidatePath);
                        if (Array.isArray(candidateData) && candidateData.length > 0 && candidateData[0].__type__ === "cc.Prefab") {
                            cocosPrefabPath = candidatePath;
                            logger.debug("PrefabConversion", `Found Cocos prefab file: ${file}`);
                            break;
                        }
                    } catch (e) {
                        // 跳过无法解析的文件
                    }
                }
            }

            let nodeName: string | null = null;

            if (cocosPrefabPath) {
                logger.debug("PrefabConversion", `Cocos prefab file exists: ${cocosPrefabPath}`);
                const cocosPrefabData = await IEditorEnv.utils.readJsonAsync(cocosPrefabPath);
                if (Array.isArray(cocosPrefabData)) {
                    // 遍历 Cocos 预制体数据，找到 fileId 对应的组件所属的节点
                    for (let i = 0; i < cocosPrefabData.length; i++) {
                        const item = cocosPrefabData[i];
                        // 检查是否是 cc.CompPrefabInfo，包含 fileId
                        if (item.__type__ === "cc.CompPrefabInfo" && item.fileId === componentFileId) {
                            // 找到了组件的 prefab info，现在需要找到对应的组件
                            // 组件的 __prefab 指向这个 CompPrefabInfo
                            for (let j = 0; j < cocosPrefabData.length; j++) {
                                const comp = cocosPrefabData[j];
                                if (comp.__prefab && comp.__prefab.__id__ === i) {
                                    // 找到了组件，现在获取它所属的节点
                                    if (comp.node && comp.node.__id__ !== undefined) {
                                        const nodeData = cocosPrefabData[comp.node.__id__];
                                        if (nodeData && nodeData._name) {
                                            nodeName = nodeData._name;
                                            logger.debug("PrefabConversion", `Found node name "${nodeName}" for component fileId: ${componentFileId}`);
                                            break;
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            } else {
                logger.warn("PrefabConversion", `Cocos prefab file not found for UUID: ${prefabUuid} in ${prefabDir}`);
            }

            logger.debug("PrefabConversion", `Found nodeName: ${nodeName}`);

            // 2. 读取 LayaAir 预制体文件
            const prefabLibPath = fpath.join(EditorEnv.projectPath, "library", prefabUuid.substring(0, 2), `${prefabUuid}@0.lh`);
            
            if (!fs.existsSync(prefabLibPath)) {
                logger.debug("PrefabConversion", `LayaAir prefab file not found (findPrefabNodeIdByComponentFileId): ${prefabLibPath}`);
                return null;
            }
            
            const prefabData = await IEditorEnv.utils.readJsonAsync(prefabLibPath);
            if (!prefabData) {
                logger.debug("PrefabConversion", `Failed to read LayaAir prefab file (findPrefabNodeIdByComponentFileId): ${prefabLibPath}`);
                return null;
            }
            
            // 将 Cocos 组件类型映射到 LayaAir 组件类型
            const compTypeMap: Record<string, string> = {
                "cc.MeshRenderer": "MeshRenderer",
                "cc.SkinnedMeshRenderer": "SkinnedMeshRenderer",
                "cc.Camera": "Camera",
            };
            const layaCompType = compTypeMap[componentType] || componentType;

            // 构建兼容类型集合：MeshRenderer 同时匹配 SkinnedMeshRenderer（继承关系）
            const compatibleTypes: Set<string> = new Set([layaCompType]);
            if (layaCompType === "MeshRenderer") {
                compatibleTypes.add("SkinnedMeshRenderer");
            }

            // 3. 在 LayaAir 预制体中查找节点
            const findNode = (node: any): { nodeId: string, actualCompType: string } | null => {
                if (!node) return null;

                // 如果有节点名称，优先通过名称匹配
                if (nodeName && node.name === nodeName) {
                    // 确认该节点有对应的组件
                    if (node._$comp && Array.isArray(node._$comp)) {
                        for (const comp of node._$comp) {
                            if (compatibleTypes.has(comp._$type)) {
                                logger.debug("PrefabConversion", `Found LayaAir node by name: ${nodeName}, _$id: ${node._$id}, compType: ${comp._$type}`);
                                return { nodeId: node._$id, actualCompType: comp._$type };
                            }
                        }
                    }
                }

                // 递归检查子节点
                if (node._$child && Array.isArray(node._$child)) {
                    for (const child of node._$child) {
                        const result = findNode(child);
                        if (result) return result;
                    }
                }

                return null;
            };

            let result = findNode(prefabData);

            // 4. 如果通过名称没找到，回退到通过组件类型查找（第一个匹配的）
            if (!result) {
                logger.debug("PrefabConversion", `Node not found by name, falling back to component type search`);
                const findByCompType = (node: any): { nodeId: string, actualCompType: string } | null => {
                    if (!node) return null;

                    if (node._$comp && Array.isArray(node._$comp)) {
                        for (const comp of node._$comp) {
                            if (compatibleTypes.has(comp._$type)) {
                                return { nodeId: node._$id, actualCompType: comp._$type };
                            }
                        }
                    }

                    if (node._$child && Array.isArray(node._$child)) {
                        for (const child of node._$child) {
                            const r = findByCompType(child);
                            if (r) return r;
                        }
                    }

                    return null;
                };
                result = findByCompType(prefabData);
            }

            return result;
        } catch (error) {
            logger.error("PrefabConversion", `Error finding prefab node:`, error);
            return null;
        }
    }

    /**
     * 从 LayaAir 预制体中根据节点的 fileId 查找节点 ID
     * 通过读取 Cocos 原始预制体文件，根据 fileId 找到节点名称，
     * 然后在 LayaAir 转换后的预制体中通过节点名称匹配找到对应的 _$id
     * @param prefabUuid 预制体 UUID
     * @param nodeFileId Cocos 节点的 fileId
     * @returns LayaAir 预制体中节点的 _$id，如果找不到则返回 null
     */
    private async findPrefabNodeIdByNodeFileId(prefabUuid: string, nodeFileId: string): Promise<string | null> {
        try {
            // 1. 首先读取 Cocos 原始预制体文件，找到 fileId 对应的节点名称
            const prefabDir = fpath.join(this.owner.cocosProjectRoot, "library", prefabUuid.substring(0, 2));

            logger.debug("PrefabConversion", `findPrefabNodeIdByNodeFileId: prefabUuid=${prefabUuid}, nodeFileId=${nodeFileId}`);

            // 动态查找 Cocos library 中匹配的 prefab JSON 文件
            let cocosPrefabPath: string | null = null;
            if (fs.existsSync(prefabDir)) {
                const files = fs.readdirSync(prefabDir);
                const prefabFiles = files.filter((f: string) => f.startsWith(prefabUuid) && f.endsWith('.json'));
                for (const file of prefabFiles) {
                    const candidatePath = fpath.join(prefabDir, file);
                    try {
                        const candidateData = await IEditorEnv.utils.readJsonAsync(candidatePath);
                        if (Array.isArray(candidateData) && candidateData.length > 0 && candidateData[0].__type__ === "cc.Prefab") {
                            cocosPrefabPath = candidatePath;
                            break;
                        }
                    } catch (e) {
                        // 跳过无法解析的文件
                    }
                }
            }

            let nodeName: string | null = null;

            if (cocosPrefabPath) {
                const cocosPrefabData = await IEditorEnv.utils.readJsonAsync(cocosPrefabPath);
                if (Array.isArray(cocosPrefabData)) {
                    // 遍历 Cocos 预制体数据，找到 fileId 对应的节点
                    for (let i = 0; i < cocosPrefabData.length; i++) {
                        const item = cocosPrefabData[i];
                        // 检查是否是 cc.PrefabInfo，包含 fileId
                        if (item.__type__ === "cc.PrefabInfo" && item.fileId === nodeFileId) {
                            // 找到了节点的 prefab info，现在需要找到对应的节点
                            // 节点的 _prefab 指向这个 PrefabInfo
                            for (let j = 0; j < cocosPrefabData.length; j++) {
                                const node = cocosPrefabData[j];
                                if (node.__type__ === "cc.Node" && node._prefab && node._prefab.__id__ === i) {
                                    nodeName = node._name;
                                    logger.debug("PrefabConversion", `Found node name "${nodeName}" for node fileId: ${nodeFileId}`);
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }
            } else {
                logger.warn("PrefabConversion", `Cocos prefab file not found for UUID: ${prefabUuid} in ${prefabDir}`);
            }
            
            if (!nodeName) {
                logger.debug("PrefabConversion", `Node name not found for fileId: ${nodeFileId}`);
                return null;
            }
            
            // 2. 读取 LayaAir 预制体文件
            const prefabLibPath = fpath.join(EditorEnv.projectPath, "library", prefabUuid.substring(0, 2), `${prefabUuid}@0.lh`);
            
            if (!fs.existsSync(prefabLibPath)) {
                logger.debug("PrefabConversion", `LayaAir prefab file not found (findPrefabNodeIdByNodeFileId): ${prefabLibPath}`);
                return null;
            }
            
            const prefabData = await IEditorEnv.utils.readJsonAsync(prefabLibPath);
            if (!prefabData) {
                logger.debug("PrefabConversion", `Failed to read LayaAir prefab file (findPrefabNodeIdByNodeFileId): ${prefabLibPath}`);
                return null;
            }
            
            // 3. 在 LayaAir 预制体中通过名称查找节点
            const findNodeByName = (node: any): string | null => {
                if (!node) return null;
                
                if (node.name === nodeName) {
                    logger.debug("PrefabConversion", `Found LayaAir node by name: ${nodeName}, _$id: ${node._$id}`);
                    return node._$id;
                }
                
                if (node._$child && Array.isArray(node._$child)) {
                    for (const child of node._$child) {
                        const result = findNodeByName(child);
                        if (result) return result;
                    }
                }
                
                return null;
            };
            
            return findNodeByName(prefabData);
        } catch (error) {
            logger.error("PrefabConversion", `Error finding prefab node by fileId:`, error);
            return null;
        }
    }

    /**
     * 写入待处理的天空盒材质文件
     */
    private async writePendingSkyboxMaterials() {
        if (!this.owner._pendingSkyboxMaterials || this.owner._pendingSkyboxMaterials.length === 0) {
            return;
        }

        for (let materialInfo of this.owner._pendingSkyboxMaterials) {
            try {
                await IEditorEnv.utils.writeJsonAsync(materialInfo.path, materialInfo.data);
                await IEditorEnv.utils.writeJsonAsync(materialInfo.path + ".meta", { uuid: materialInfo.uuid });
            } catch (error) {
                console.error(`Failed to write skybox material file ${materialInfo.path}:`, error);
            }
        }

        // 清空待处理列表
        this.owner._pendingSkyboxMaterials = [];
    }

    /**
     * 写入待处理的粒子材质文件（.lmat），同时更新粒子纹理 .meta 的 sRGB=false
     */
    private async writePendingParticleMaterials() {
        if (!this.owner._pendingParticleMaterials || this.owner._pendingParticleMaterials.length === 0) {
            return;
        }

        // 收集需要更新 sRGB=false 的纹理 UUID
        const textureUuidsToFix = new Set<string>();

        for (let materialInfo of this.owner._pendingParticleMaterials) {
            try {
                await IEditorEnv.utils.writeJsonAsync(materialInfo.path, materialInfo.data);
                await IEditorEnv.utils.writeJsonAsync(materialInfo.path + ".meta", { uuid: materialInfo.uuid });
                if (materialInfo.textureUuid) {
                    textureUuidsToFix.add(materialInfo.textureUuid);
                }
            } catch (error) {
                console.error(`Failed to write particle material file ${materialInfo.path}:`, error);
            }
        }

        // 更新粒子纹理 .meta 的 sRGB=false（粒子纹理不需要硬件 sRGB 解码，保持 gamma 空间）
        if (textureUuidsToFix.size > 0) {
            await this.updateParticleTextureSRGB(textureUuidsToFix);
        }

        // 清空待处理列表
        this.owner._pendingParticleMaterials = [];
    }

    /**
     * 递归搜索并更新粒子纹理 .meta 的 sRGB 为 false
     */
    private async updateParticleTextureSRGB(textureUuids: Set<string>) {
        const projectRoot = IEditorEnv.projectPath;
        if (!projectRoot) return;

        const assetsDir = projectRoot + "/assets";
        const findMetaFiles = (dir: string): string[] => {
            const results: string[] = [];
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = dir + "/" + entry.name;
                    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
                        results.push(...findMetaFiles(fullPath));
                    } else if (entry.name.endsWith(".png.meta") || entry.name.endsWith(".jpg.meta") || entry.name.endsWith(".jpeg.meta")) {
                        results.push(fullPath);
                    }
                }
            } catch (e) { /* 忽略不可访问的目录 */ }
            return results;
        };

        const metaFiles = findMetaFiles(assetsDir);
        for (const metaPath of metaFiles) {
            try {
                const content = fs.readFileSync(metaPath, "utf-8");
                const meta = JSON.parse(content);
                if (meta.uuid && textureUuids.has(meta.uuid) && meta.importer?.sRGB === true) {
                    meta.importer.sRGB = false;
                    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
                    console.log(`[ParticleTexture] Set sRGB=false for ${metaPath}`);
                }
            } catch (e) { /* 忽略解析错误 */ }
        }
    }

    /**
     * 写入待处理的 2D 动画控制器文件（.mcc）
     */
    private async writePendingAnimation2DControllers() {
        if (!this.owner._pendingAnimation2DControllers || this.owner._pendingAnimation2DControllers.length === 0) {
            return;
        }

        for (let controllerInfo of this.owner._pendingAnimation2DControllers) {
            try {
                await IEditorEnv.utils.writeJsonAsync(controllerInfo.path, controllerInfo.data);
                await IEditorEnv.utils.writeJsonAsync(controllerInfo.path + ".meta", { uuid: controllerInfo.uuid });
                console.debug(`Animation2D controller written: ${controllerInfo.path}`);
            } catch (error) {
                console.error(`Failed to write Animation2D controller file ${controllerInfo.path}:`, error);
            }
        }

        // 清空待处理列表
        this.owner._pendingAnimation2DControllers = [];
    }
}

function colorToHexString(color: any, hasAlpha?: boolean): string {
    if (hasAlpha)
        return new Laya.Color(color.r / 255, color.g / 255, color.b / 255, color.a / 255).getStyleString();
    else
        return new Laya.Color(color.r / 255, color.g / 255, color.b / 255).toString();
}

export function colorToLayaColor(color: any): any {
    return {
        _$type: "Color",
        r: color.r / 255,
        g: color.g / 255,
        b: color.b / 255,
        a: color.a / 255
    };
}

function convertTransformFromCocos(value: { x: number, y: number, z: number }) {
    if (!value)
        return { x: 0, y: 0, z: 0 };
    return { x: value.x, y: value.y, z: value.z };
}
function convertScaleFromCocos(value: { x: number, y: number, z: number }) {
    if (!value)
        return { x: 1, y: 1, z: 1 };
    return { x: value.x, y: value.y, z: value.z };
}

function convertQuaternionFromCocos(value: { x: number, y: number, z: number, w: number }) {
    if (!value)
        return { x: 0, y: 0, z: 0, w: 1 };
    return { x: value.x, y: value.y, z: value.z, w: value.w };
}

