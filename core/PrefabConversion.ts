import { ICocosAssetConversion, ICocosMigrationTool } from "./ICocosMigrationTool";

export class PrefabConversion implements ICocosAssetConversion {

    private overrideTargets = new Map<string, any>();
    private rewriteTasks = new Map<string, any>();

    private overrides: any[];
    private nodeHooks: Array<any>;
    private nodeMap: Map<number, any>;
    private removedElements: Set<number>;
    private elements: Array<any>;
    private inCanvas: number;

    constructor(private owner: ICocosMigrationTool) {
    }

    async run(sourcePath: string, targetPath: string, meta: any) {
        let elements = await IEditorEnv.utils.readJsonAsync(sourcePath);
        let node = this.parseElements(elements);

        targetPath = Laya.Utils.replaceFileExtension(targetPath, node._$type == "Scene" ? "ls" : "lh");

        if (this.overrides.length > 0)
            this.rewriteTasks.set(targetPath, { data: node, overrides: this.overrides, elements, nodeMap: this.nodeMap });

        await IEditorEnv.utils.writeJsonAsync(targetPath, node);
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
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

        let node = this.parseNode(null, 1);
        node = Object.assign({ "_$ver": 1 }, node);
        if (node._$type === "Scene") {
            delete node.anchorY;
            let children: any[] = node._$child;
            if (children) {
                let scene3dNode: any;
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
                if (scene3dNode)
                    children.unshift(scene3dNode);
            }
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
                if (!targetInfo) {
                    console.warn(`cannot find override target: ${info.targetId} in ${targetPath}`);
                    continue;
                }

                let instanceNode = info.instanceNode;
                let targetNode = targetInfo.node;
                let compData = targetInfo.compData;
                let targetId = targetInfo.parentNode ? targetNode._$id : null;
                let parentNode = targetInfo.parentNode || info.instanceNodeParent;

                if (info.propertyPath == "_$child") {
                    let entry = this.createOverrideEntry(instanceNode, targetId);
                    if (!entry._$child)
                        entry._$child = [];
                    entry._$child.push(info.value);
                }
                else if (info.propertyPath == "_$comp" || compData) {
                    let props: any = { _$type: targetNode._$type, _$child: [], _$comp: [] };
                    if (info.propertyPath == "_$comp")
                        this.parseComponent(props, info.value);
                    else
                        this.parseComponent(props, { __type__: compData.__type__, [info.propertyPath[0]]: info.value }, true);
                    if (props._$comp.length > 0) {
                        let comp = props._$comp[0];
                        let entry = this.createOverrideEntry(instanceNode, targetId, comp._$type);
                        delete comp._$type;
                        IEditorEnv.utils.mergeObjs(entry, comp, true);

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
                    let is2d = EditorEnv.typeRegistry.isDerivedOf(targetNode._$type, "Sprite");
                    this.parseNodeProps(parentNode, props, info.propertyPath[0], info.value, is2d, true);
                    let entry = this.createOverrideEntry(instanceNode, targetId);
                    IEditorEnv.utils.mergeObjs(entry, props, true);
                }
            }

            this.nodeHooks.forEach(hook => hook());
            await IEditorEnv.utils.writeJsonAsync(targetPath, data);
        }
    }

    private createOverrideEntry(prefabRootNode: any, targetId: string, compType?: string): any {
        let entry: any;
        if (targetId) {
            if (!prefabRootNode._$child)
                prefabRootNode._$child = [];
            entry = prefabRootNode._$child.find((c: any) => c._$id === targetId);
            if (!entry) {
                entry = { _$override: targetId };
                prefabRootNode._$child.push(entry);
            }
        }
        else
            entry = prefabRootNode;
        if (compType) {
            if (!entry._$comp)
                entry._$comp = [];
            let comp = entry._$comp.find((c: any) => c._$override === compType);
            if (!comp) {
                comp = { _$override: compType };
                entry._$comp.push(comp);
            }
            return comp;
        }
        else
            return entry;
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
                if (propertyOverrides?.length > 0) {
                    for (let idInfo of propertyOverrides) {
                        let info = elements[idInfo.__id__];
                        if (!info.targetInfo)
                            continue;

                        let targetId = elements[info.targetInfo.__id__].localID[0];
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
                        this.overrides.push({
                            targetId,
                            propertyPath: "_$comp",
                            value: elements[info.components[0].__id__],
                            instanceNode: node,
                            instanceNodeParent: parentNode
                        });
                    }
                }
                if (prefabInst.mountedChildren?.length > 0) {
                    for (let idInfo of prefabInst.mountedChildren) {
                        let info = elements[idInfo.__id__];
                        if (!info.targetInfo)
                            continue;

                        let targetId = elements[info.targetInfo.__id__].localID[0];
                        let mountedChild = this.parseNode(node, info.nodes[0].__id__);
                        this.overrides.push({
                            targetId,
                            propertyPath: "_$child",
                            value: mountedChild,
                            instanceNode: node,
                            instanceNodeParent: parentNode
                        });
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
                this.parseComponent(node, compData);
            }
            if (spriteData)
                this.parseComponent(node, spriteData);
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
                if (value === false || isOverride) {
                    if (is2d)
                        node.visible = value;
                    else
                        node.active = value;
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
                        node.transform.localPosition = { _$type: "Vector3", x: value.x, y: value.y, z: value.z };
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
                        node.transform.localRotation = { _$type: "Quaternion", x: value.x, y: value.y, z: value.z, w: value.w };
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
                        node.transform.localScale = { _$type: "Vector3", x: value.x, y: value.y, z: value.z };
                    }
                }
                break;
        }
    }

    private parseComponent(node: any, data: any, isOverride?: boolean): void {
        switch (data.__type__) {
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
                else if ((node._$type === "GPanel" || node._$type === "GList") && data._spriteFrame) {
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
                    node.text = data._string.replaceAll("<color=", "<font color=").replaceAll("</color>", "</font>")
                        .replaceAll("<size=", "<font size=").replaceAll("</size>", "</font>");
                }
                else
                    node.text = data._string;
                break;
            }

            case "cc.Mask": {
                let spriteData = this.findComponent(data, "cc.Sprite");
                let shape = data._type;
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
                if (shape == 1) {
                    maskNode.background = {
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
                            maskNode.background = {
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
                    maskNode.background = {
                        "_$type": "DrawRectCmd",
                        "fillColor": "#ffffff"
                    };
                }
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
                //node._$type = "GProgressBar";
                node._$prefab = "b4521a63-ee87-4b39-8324-d1c29b403467";
                if (data._barSprite)
                    this.removeElement(data._barSprite);
                break;
            }

            case "cc.Slider":
                //node._$type = "GSlider";
                node._$prefab = "e29cffe9-244a-4df8-a442-8354936e5b72";
                if (data._handle)
                    this.removeElement(data._handle);
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
                node.layout = {};
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

            case "cc.Camera": {
                node._$type = "Camera";
                node.clearColor = colorToLayaColor(data._color);
                break;
            }

            case "cc.DirectionalLight": {
                let comp: any = { _$type: "DirectionLightCom" };
                comp.color = colorToLayaColor(data._color);
                node._$comp.push(comp);
                break;
            }

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
        let components = nodeOrAnyComp._components || this.elements[this.getComponentOwnerId(nodeOrAnyComp)]._components;
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
        let loader = node._$child[0];
        let sprite = this.findComponent(data, "cc.Sprite");
        if (sprite && sprite._spriteFrame) {
            let spf = this.getSpriteFrame(sprite._spriteFrame.__uuid__);
            if (spf)
                loader.src = "res://" + spf.uuid;
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

        if (!data._interactable)
            node._mouseState = 1;
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
}

function colorToHexString(color: any, hasAlpha?: boolean): string {
    if (hasAlpha)
        return new Laya.Color(color.r / 255, color.g / 255, color.b / 255, color.a / 255).getStyleString();
    else
        return new Laya.Color(color.r / 255, color.g / 255, color.b / 255).toString();
}

function colorToLayaColor(color: any): any {
    return {
        _$type: "Color",
        r: color.r / 255,
        g: color.g / 255,
        b: color.b / 255,
        a: color.a / 255
    };
}

