import { CurveType, Vector3 } from "../assets/AnimationClipConversion";



export interface TypeAniData {
    fps?: number,
    loop?: boolean,
    event?: any[],
    aniData?: TypeAniLayer,
    totalFrame?: number,
    propType?: Record<string, number>,
    is3D?: boolean,
}
export interface TypeAniLayer {
    /**当内部value发生变化的时候触发的回调函数 */
    onChange?: string,
    name: string,
    child?: TypeAniLayer[],
    keys?: TypeAniKeyData[],
    prop?: TypeAniLayer[],
}
export interface TypeAniKeyData {
    /**第几帧 */
    f: number,
    val: number | string | boolean | TypePathPoint[],
    /**目前用于2D动画，用于记录动画补间的类型，比如(Linear|Quad_EaseIn)... */
    tweenType?: string,
    /**扩展，如果有一些其它数据需要加入到关键帧中可以写在这里 */
    extend?: any,
    /**tween的信息，待完成 */
    tweenInfo?: TypeTweenInfo,
}
export interface TypeTweenInfo {
    outTangent?: number,
    outWeight?: number,
    inTangent?: number,
    inWeight?: number,
    inWeightLock?: boolean,
    outWeightLock?: boolean,
    smooth?: boolean,
}
export interface TypePathPoint {
    pos: Vector3,
    c1: Vector3,
    c2: Vector3,
    curve: CurveType,
    rotationType?: 0 | 1 | 2,
}
export enum DataType {
    Float = 0,
    Vector2 = 5,
    Vector3 = 6,
    Vector4 = 7,
    Color = 8,
    Boolean = 9,
    PathPoint = 10,
}


/*
 * @Descripttion: json转换为二进制格式
 * @version: 1.0.0
 * @Author: jsj
 * @Date: 2021-11-08 21:08:00
 * @LastEditors: jsj
 * @LastEditTime: 2021-11-30 10:57:08
 */
export default class AnimationClipUtil {

    static ClassByType = {
        [DataType.Color]: Laya.Vector4Keyframe,
        [DataType.Vector4]: Laya.Vector4Keyframe,
        [DataType.Vector2]: Laya.Vector2Keyframe,
        [DataType.Vector3]: Laya.Vector3Keyframe,
        [DataType.Float]: Laya.FloatKeyframe,
        [DataType.Boolean]: Laya.BooleanKeyframe,
        [DataType.PathPoint]: Laya.PathPointKeyframe,
        //[DataType.Float]: Vector3Keyframe,
    }


    protected static Version: string = "LAYAANIMATION:WEIGHT_04"
    private static sortMap: Map<string, string[]>;
    private static animClipType: Map<string, number>;
    private static FPS: number;

    public static aniDataToAnimationClip(data: TypeAniData): Laya.AnimationClip {
        var clip = new Laya.AnimationClip();
        AnimationClipUtil.FPS = clip._frameRate = data.fps ? data.fps : 30;
        clip.islooping = data.loop ? data.loop : false;
        let duration: number = clip._duration = this.frameToTime(data.totalFrame);
        let dataEvents = data.event;
        if (dataEvents != undefined && dataEvents.length > 0) {
            for (var i = 0; i < dataEvents.length; i++) {
                let eventData = dataEvents[i];
                var event: Laya.AnimationEvent = new Laya.AnimationEvent();
                event.time = Math.min(eventData.time, duration);
                event.eventName = eventData.eventName;
                event.params = eventData.params;
                clip.addEvent(event);
            }
        }

        var nodesMap: any = clip._nodesMap = {};
        var nodesDic: any = clip._nodesDic = {};
        this.getKeyframeNode(data.propType, data.aniData, nodesMap, nodesDic, [])
        var nodes: Laya.KeyframeNodeList = clip._nodes!;
        var index: number = 0;
        for (var key in nodesDic) {
            let value = nodesDic[key];
            value._indexInList = index;
            nodes.setNodeByIndex(index, value)
            index++;
        }
        return clip;
    }
    private static createPathPoints(arr: TypePathPoint[]) {
        const result: Laya.PathPoint[] = [];
        for (var i = 0, len = arr.length; i < len; i++) {
            const data = arr[i];
            const point = new Laya.PathPoint();
            point.pos.x = data.pos.x;
            point.pos.y = data.pos.y;
            point.pos.z = data.pos.z;
            point.c1.x = data.c1.x;
            point.c1.y = data.c1.y;
            point.c1.z = data.c1.z;
            point.c2.x = data.c2.x;
            point.c2.y = data.c2.y;
            point.c2.z = data.c2.z;
            point.curve = data.curve;
            result.push(point);
        }
        return result;
    }
    static formatKeyData(ko: TypeAniKeyData): Laya.TypeAniKey {
        if (ko.val instanceof Array) {
            const result = JSON.parse(JSON.stringify(ko));
            result.val = new Laya.CurvePath();
            (result.val as any)._$data = ko.val;
            result.val.create(...this.createPathPoints(ko.val));
            return result;
        } else {
            return ko as Laya.TypeAniKey;
        }
    }
    private static getKeyframeNode(propType: Record<string, number>, data: TypeAniLayer, nodesMap: any, nodesDic: any, partner: string[]) {
        if (null == propType) {
            propType = {};
        }
        let ownerPaths: string[]
        if (data.name.length > 0) {
            ownerPaths = partner.concat(data.name);
        } else {
            ownerPaths = partner.concat();
        }

        let targetPath: string = ownerPaths.join("/");
        let props = data.prop;
        if (props != undefined) {
            let keyFrames: Laya.KeyframeNode[] = [];

            this.checkProps(propType, props, ownerPaths, nodesDic, keyFrames, [], data);


            // for (var i = 0; i < props.length; i++) {
            //     let prop = props[i];
            //     for (var j = 0; j < prop.prop.length; j++) {

            //         let keyFrame: KeyframeNode = this.createKeyframeNode(prop.prop[j], ownerPaths, prop.name, nodesDic)
            //         keyFrames.push(keyFrame);
            //     }
            // }
            nodesMap[targetPath] = keyFrames;
        }

        let nodeChild = data.child;
        if (nodeChild != undefined) {
            for (var i = 0; i < nodeChild.length; i++) {
                this.getKeyframeNode(propType, nodeChild[i], nodesMap, nodesDic, ownerPaths)
            }
        }
    }


    private static checkProps(propType: Record<string, number>, props: TypeAniLayer[], ownerPaths: string[], nodesDic: any, keyFrames: Laya.KeyframeNode[], propNames: string[] = [], pprop?: TypeAniLayer, onChange?: string, isOnChange = false, onChangeArg?: string, propertyChangePath?: string) {
        if (!props) {
            return;
        }
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            if (isOnChange) {
                onChangeArg = prop.name;
            }


            if (prop.keys) {
                let keyFrame = this.createKeyframeNode(propType, pprop, ownerPaths.concat(), propNames.concat(), nodesDic, prop, onChange, onChangeArg, propertyChangePath);
                keyFrames.push(keyFrame);
                if (keyFrame.type != Number(DataType.Float)) {
                    return;
                }
            } else {
                var setpaths = propNames.concat();
                setpaths.push(prop.name);
                let tmpOnChange = false;
                if (prop.onChange) {
                    //onChange = setpaths.join(".") + "." + prop.onChange;
                    onChange = prop.onChange;
                    propertyChangePath = setpaths.join(".");
                    tmpOnChange = true;
                }
                this.checkProps(propType, prop.prop, ownerPaths, nodesDic, keyFrames, setpaths, prop, onChange, tmpOnChange, onChangeArg, propertyChangePath);
            }
        }
    }

    private static createKeyframeNode(propType: Record<string, number>, data: any, ownerPaths: string[], propNames: string[], nodesDic: any, currProp: TypeAniLayer, onChange: string, onChangeArg: string, propertyChangePath: string): Laya.KeyframeNode {
        var keyFrame: Laya.KeyframeNode = new Laya.KeyframeNode();
        if (null != onChange) {
            keyFrame.callbackFunData = onChange;
            keyFrame.callParams = [onChangeArg];
            (keyFrame as any).propertyChangePath = propertyChangePath;
            //console.debug("onChange:", onChange, onChangeArg, propNames.join("."));
        }

        let ownerPathCount: number = ownerPaths.length;
        keyFrame._setOwnerPathCount(ownerPathCount);
        for (var i = 0; i < ownerPathCount; i++) {
            keyFrame._setOwnerPathByIndex(i, ownerPaths[i])
        }
        var propertyOwner = propNames.shift();
        keyFrame.propertyOwner = propertyOwner;
        for (var i = propNames.length - 1; i >= 0; i--) {
            keyFrame._setPropertyByIndex(i, propNames[i]);
        }


        var nodePath: string = keyFrame._joinOwnerPath("/");
        var fullPath = nodePath;
        if (null != keyFrame.propertyOwner) {
            var propertyPath = keyFrame.propertyOwner + "." + keyFrame._joinProperty(".");
            fullPath += "." + propertyPath;
        }
        keyFrame.fullPath = fullPath;
        keyFrame.nodePath = nodePath;
        nodesDic[fullPath] = keyFrame;
        let cls: any = null;
        let isObject = true;

        //console.debug("propertyPath:", propertyPath, propType);

        var type = propType[propertyPath];

        if (null != type) {
            cls = (this.ClassByType as any)[type];

            /**针对transform需要做特殊type的处理 */
            if ("transform.localPosition" == propertyPath) {
                type = Laya.KeyFrameValueType.Position;
            } else if ("transform.localScale" == propertyPath) {
                type = Laya.KeyFrameValueType.Scale;
            } else if ("transform.localRotationEuler" == propertyPath) {
                type = Laya.KeyFrameValueType.RotationEuler;
            } else if ('transform.localRotation' == propertyPath) {
                type = Laya.KeyFrameValueType.Rotation;
            }
            keyFrame.type = type;
        }

        if (null == cls) {
            let type = DataType.Float;
            try {
                const firstVal = data.prop[0].keys[0].val;
                if ("boolean" === typeof firstVal) {
                    type = DataType.Boolean;
                } else if (Array.isArray(firstVal)) {
                    type = DataType.PathPoint;
                }
            } catch (e) { }


            keyFrame.type = type as number;
            cls = (this.ClassByType as any)[keyFrame.type];
            isObject = false;
        }

        // if ("color" == data.name || data.name == "localRotation") {
        //     cls = QuaternionKeyframe;
        //     keyFrame.type = 2;
        // } else if (data.name == "localRotationEuler") {
        //     cls = Vector3Keyframe;
        //     keyFrame.type = 2;
        // }
        // else if (data.name == "localPosition") {
        //     cls = Vector3Keyframe;
        //     keyFrame.type = 1;
        // } else if (data.name == "localScale") {
        //     cls = Vector3Keyframe;
        //     keyFrame.type = 3;
        // } else {
        //     cls = FloatKeyframe;
        //     isObject = false;
        //     keyFrame.type = 0;
        // }
        // if (cls == null) {
        //     console.error("数据错误；不可复原")
        // }
        var keyFramMaps: Map<number, Laya.Keyframe> = new Map<number, Laya.Keyframe>();
        var keys: number[] = [];
        let props: any = data.prop;
        if (!isObject) {
            let prop = currProp;

            var propertys = (keyFrame as any)._propertys;
            propertys.push(prop.name);

            delete nodesDic[fullPath];
            if (keyFrame.propertyOwner) {
                propertyPath = keyFrame.propertyOwner + "." + keyFrame._joinProperty(".");
            } else {
                propertyPath = keyFrame._joinProperty(".");
            }
            fullPath = nodePath + "." + propertyPath;
            keyFrame.fullPath = fullPath;
            keyFrame.nodePath = nodePath;
            nodesDic[fullPath] = keyFrame;


            prop.keys.forEach((value) => {
                let kerframe: any = keyFramMaps.get(value.f);
                if (kerframe == undefined) {
                    if (cls != Laya.FloatKeyframe) {
                        kerframe = new cls(true);
                    } else {
                        kerframe = new cls();
                    }
                    kerframe.time = this.frameToTime(value.f);
                    keyFramMaps.set(value.f, kerframe);
                    keys.push(value.f);
                }
                kerframe["value"] = this.formatKeyData(value).val;
                if (value.tweenInfo != undefined) {
                    if (value.tweenInfo.outTangent) {
                        kerframe["outTangent"] = value.tweenInfo.outTangent;
                    } else {
                        if (null === value.tweenInfo.outTangent) {
                            kerframe["outTangent"] = Infinity;
                        } else {
                            kerframe["outTangent"] = 0;
                        }
                    }
                    if (value.tweenInfo.outWeight) {
                        kerframe["outWeight"] = value.tweenInfo.outWeight;
                    }
                    if (value.tweenInfo.inTangent) {
                        kerframe["inTangent"] = value.tweenInfo.inTangent;
                    } else {
                        if (null === value.tweenInfo.inTangent) {
                            kerframe["inTangent"] = Infinity;
                        } else {
                            kerframe["inTangent"] = 0;
                        }
                    }
                    if (value.tweenInfo.inWeight) {
                        kerframe["inWeight"] = value.tweenInfo.inWeight;
                    }
                    if (Laya.Keyframe.defaultWeight != kerframe["inWeight"] && Laya.Keyframe.defaultWeight != kerframe["outWeight"]) {
                        kerframe["weightedMode"] = Laya.WeightedMode.Both;
                    } else if (Laya.Keyframe.defaultWeight != kerframe["inWeight"]) {
                        kerframe["weightedMode"] = Laya.WeightedMode.In;
                    } else if (Laya.Keyframe.defaultWeight != kerframe["outWeight"]) {
                        kerframe["weightedMode"] = Laya.WeightedMode.Out;
                    }
                } else {
                    kerframe["outTangent"] = 0;
                    kerframe["inTangent"] = 0;
                }
            })
        } else {
            let propsLength: number = props.length;
            for (var i = 0; i < propsLength; i++) {
                let prop = props[i];
                let propName = prop.name;

                if ("r" == propName) {
                    propName = "x";
                } else if ("g" == propName) {
                    propName = "y";
                } else if ("b" == propName) {
                    propName = "z";
                } else if ("a" == propName) {
                    propName = "w";
                }


                prop.keys.forEach((value: any) => {
                    let kerframe: any = keyFramMaps.get(value.f);
                    if (kerframe == undefined) {
                        if (cls != Laya.FloatKeyframe) {
                            kerframe = new cls(true);
                        } else {
                            kerframe = new cls();
                        }
                        kerframe.time = this.frameToTime(value.f);
                        keyFramMaps.set(value.f, kerframe);
                        keys.push(value.f);
                    }
                    kerframe["value"][propName] = this.formatKeyData(value).val;
                    if (value.tweenInfo != undefined) {
                        if (value.tweenInfo.outTangent) {
                            kerframe["outTangent"][propName] = value.tweenInfo.outTangent;
                        } else {
                            if (null === value.tweenInfo.outTangent) {
                                kerframe["outTangent"][propName] = Infinity;
                            } else {
                                kerframe["outTangent"][propName] = 0;
                            }
                        }
                        if (value.tweenInfo.outWeight) {
                            kerframe["outWeight"][propName] = value.tweenInfo.outWeight;
                        }
                        if (value.tweenInfo.inTangent) {
                            kerframe["inTangent"][propName] = value.tweenInfo.inTangent;
                        } else {
                            if (null === value.tweenInfo.inTangent) {
                                kerframe["inTangent"][propName] = Infinity;
                            } else {
                                kerframe["inTangent"][propName] = 0;
                            }
                        }
                        if (value.tweenInfo.inWeight) {
                            kerframe["inWeight"][propName] = value.tweenInfo.inWeight;
                        }




                        if (Laya.Keyframe.defaultWeight != kerframe["inWeight"][propName] && Laya.Keyframe.defaultWeight != kerframe["outWeight"][propName]) {
                            kerframe["weightedMode"][propName] = Laya.WeightedMode.Both;
                        } else if (Laya.Keyframe.defaultWeight != Laya.Keyframe.defaultWeight != kerframe["inWeight"][propName]) {
                            kerframe["weightedMode"][propName] = Laya.WeightedMode.In;
                        } else if (Laya.Keyframe.defaultWeight != kerframe["outWeight"][propName]) {
                            kerframe["weightedMode"][propName] = Laya.WeightedMode.Out;
                        }




                    } else {
                        kerframe["outTangent"][propName] = 0;
                        kerframe["inTangent"][propName] = 0;
                    }
                })
            }
        }
        keys.sort((a, b) => a - b);
        keys.forEach((value, index) => {
            keyFrame._setKeyframeByIndex(index, keyFramMaps.get(value))
        })
        return keyFrame;
    }
    public static animationClipToJson(clip: Laya.AnimationClip): any {
        let clipData: TypeAniData = { is3D: true };

        clipData.propType = {};
        AnimationClipUtil.FPS = clipData.fps = clip._frameRate;
        clipData.loop = clip.islooping;
        clipData.totalFrame = this.timeToFrame(clip._duration);
        let dataEvents: any = clipData.event = [];
        let animationEvents: Laya.AnimationEvent[] = clip._animationEvents;
        for (var i = 0; i < animationEvents.length; i++) {
            let event: Laya.AnimationEvent = animationEvents[i];
            let eventData: any = dataEvents[i] = {};
            eventData.time = event.time;
            eventData.eventName = event.eventName;
            eventData.params = event.params;
        }
        let nodeMap: Map<string, TypeAniLayer> = new Map<string, TypeAniLayer>();
        let keyData: TypeAniLayer = { name: "" };
        keyData.child = [];
        nodeMap.set("__root", keyData)
        let nodesMap = clip._nodesMap;
        for (var key in nodesMap) {
            this.createNodeInfo(key, nodesMap[key], nodeMap, clipData.propType)
        }
        clipData.aniData = nodeMap.get("__root");
        return clipData;
    }


    private static createNodeInfo(key: string, keyNodes: Laya.KeyframeNode[], nodeMap: Map<string, TypeAniLayer>, propType: Record<string, number>) {
        let keyData: TypeAniLayer = { name: "", child: [] };
        let props: any = keyData.prop = [];
        const keyNodesCount: number = keyNodes.length;
        let propOwnerMap: Map<string, any[]> = new Map<string, any[]>();
        for (var i = 0; i < keyNodesCount; i++) {
            let keyNode: Laya.KeyframeNode = keyNodes[i];
            this.createKeyframeNodeInfo(keyNode, propOwnerMap, propType);
        }
        propOwnerMap.forEach((value, key) => {
            if ("" == key) {
                for (let i = 0, len = value.length; i < len; i++) {
                    props.push(value[i]);
                }
            } else {
                props.push({ name: key, prop: value });
            }
        })
        if (key.length <= 0) {


            this.mergeData("__root", keyData, nodeMap);
        } else {
            let nodesPaths: string[] = key.split("/");
            keyData.name = nodesPaths.pop();

            if (nodeMap.has(key)) {
                //合并数据
                //console.debug("数据已经存在，合并数据就可以了");
                this.mergeData(key, keyData, nodeMap);

            } else {
                nodeMap.set(key, keyData);
                //放入父容器
                if (nodesPaths.length <= 0) {
                    nodeMap.get("__root").child.push(keyData);
                    return;
                }
                let patnerPath: string = nodesPaths.join("/");
                while (!nodeMap.has(patnerPath)) {
                    let partnerName: string = nodesPaths.pop();
                    let partnerData: TypeAniLayer = { name: partnerName, child: [keyData] }
                    nodeMap.set(patnerPath, partnerData);
                    keyData = partnerData;
                    patnerPath = nodesPaths.join("/");
                    if (patnerPath.length <= 0) {
                        patnerPath = "__root";
                    }
                }
                nodeMap.get(patnerPath).child.push(keyData);
            }
        }
    }

    private static mergeData(key: string, data: TypeAniLayer, nodeMap: Map<string, TypeAniLayer>) {
        let getData = nodeMap.get(key);
        if (getData) {

            if (null != data.prop && null == getData.prop) {
                getData.prop = data.prop;
            }


        } else {
            nodeMap.set(key, data);
        }

    }


    private static createKeyframeNodeInfo(keyNode: Laya.KeyframeNode, propOwnerMap: Map<string, any[]>, propType: Record<string, number>) {
        let lists: any[] = propOwnerMap.get(keyNode.propertyOwner);
        if (lists == undefined) {
            lists = [];
            propOwnerMap.set(keyNode.propertyOwner, lists)
        }
        var propsName: string;

        var parr: string[] = (keyNode as any)._propertys;
        var len = parr.length;
        var valPropertyName: string = null;

        var isCreateObj = true;
        let changePropertyPath: string[] = null;

        if (keyNode.callbackFunData) {
            let propertyChangePath: string = (keyNode as any).propertyChangePath;
            if (propertyChangePath) {
                changePropertyPath = propertyChangePath.split(".");
                if (keyNode.propertyOwner == changePropertyPath[0]) {
                    changePropertyPath.shift();
                }
                //console.debug("ownerName:", ownerName);
            }
        }



        if (keyNode.type == Laya.KeyFrameValueType.PathPoint as number || keyNode.type == Laya.KeyFrameValueType.Float as number || keyNode.type == Laya.KeyFrameValueType.Boolean as number) {
            //float需要做特殊处理
            var propertys = (keyNode as any)._propertys;
            valPropertyName = propertys[propertys.length - 1];
            propsName = valPropertyName;
            len -= 1;
            if (0 >= len) {
                isCreateObj = false;
            }
        }

        for (var i = 0; i < len; i++) {
            if (i == len - 1) {
                propsName = parr[i];
            } else {
                var isFind = false;
                for (var j = lists.length - 1; j >= 0; j--) {
                    if (lists[j].name == parr[i]) {
                        isFind = true;
                        if (null == lists[j].prop) {
                            lists[j].prop = [];
                        }
                        lists = lists[j].prop;
                        break;
                    }
                }
                if (!isFind) {
                    var pobj: any = { name: parr[i], prop: [] };
                    if (changePropertyPath && changePropertyPath.length) {
                        changePropertyPath.shift();
                        if (!changePropertyPath.length) {
                            pobj.onChange = keyNode.callbackFunData;
                        }
                    }
                    lists.push(pobj);
                    lists = pobj.prop;
                }
            }
        }

        var pathPath = keyNode.propertyOwner + "." + parr.join(".");

        var prop: any[];
        var data: any = null;
        if (isCreateObj) {
            data = {};
            if (keyNode.callbackFunData)
                data.onChange = keyNode.callbackFunData;
            data.name = propsName;
            prop = data.prop = [];
        } else {
            prop = lists;
        }
        let keyFrameCount: number = keyNode.keyFramesCount;




        if (keyNode.type == Laya.KeyFrameValueType.Rotation as number || keyNode.type == Laya.KeyFrameValueType.Vector4 as number || keyNode.type == Laya.KeyFrameValueType.Color as number) {

            if (null == propType[pathPath]) {
                if (keyNode.type == Laya.KeyFrameValueType.Color as number) {
                    propType[pathPath] = DataType.Color;
                } else {
                    propType[pathPath] = DataType.Vector4;
                }
            }


            let listsx: any[] = [];
            let listsy: any[] = [];
            let listsz: any[] = [];
            let listsw: any[] = [];
            for (var i = 0; i < keyFrameCount; i++) {
                let keyData = keyNode.getKeyframeByIndex(i) as Laya.Vector4Keyframe;
                let frameCount = this.timeToFrame(keyData.time);
                listsx[i] = {
                    f: frameCount,
                    val: keyData.value.x,
                    tweenInfo: {
                        outTangent: keyData.outTangent.x,
                        outWeight: keyData.outWeight ? keyData.outWeight.x : 0,
                        inTangent: keyData.inTangent.x,
                        inWeight: keyData.inWeight ? keyData.inWeight.x : 0,
                    }
                };
                listsy[i] = {
                    f: frameCount,
                    val: keyData.value.y,
                    tweenInfo: {
                        outTangent: keyData.outTangent.y,
                        outWeight: keyData.outWeight ? keyData.outWeight.y : 0,
                        inTangent: keyData.inTangent.y,
                        inWeight: keyData.inWeight ? keyData.inWeight.y : 0,
                    }
                }
                listsz[i] = {
                    f: frameCount,
                    val: keyData.value.z,
                    tweenInfo: {
                        outTangent: keyData.outTangent.z,
                        outWeight: keyData.outWeight ? keyData.outWeight.z : 0,
                        inTangent: keyData.inTangent.z,
                        inWeight: keyData.inWeight ? keyData.inWeight.z : 0,
                    }
                }
                listsw[i] = {
                    f: frameCount,
                    val: keyData.value.w,
                    tweenInfo: {
                        outTangent: keyData.outTangent.w,
                        outWeight: keyData.outWeight ? keyData.outWeight.w : 0,
                        inTangent: keyData.inTangent.w,
                        inWeight: keyData.inWeight ? keyData.inWeight.w : 0,
                    }
                }
            }

            if (keyNode.type == Laya.KeyFrameValueType.Color as number) {
                prop.push({
                    name: "r",
                    keys: listsx,
                })
                prop.push({
                    name: "g",
                    keys: listsy,
                })
                prop.push({
                    name: "b",
                    keys: listsz,
                })
                prop.push({
                    name: "a",
                    keys: listsw,
                })
            } else {
                prop.push({
                    name: "x",
                    keys: listsx,
                })
                prop.push({
                    name: "y",
                    keys: listsy,
                })
                prop.push({
                    name: "z",
                    keys: listsz,
                })
                prop.push({
                    name: "w",
                    keys: listsw,
                })
            }

        } else if (keyNode.type == Laya.KeyFrameValueType.Boolean as number) {
            let listsx: any[] = [];
            for (var i = 0; i < keyFrameCount; i++) {
                let keyData: Laya.BooleanKeyframe = keyNode.getKeyframeByIndex(i) as Laya.BooleanKeyframe;
                let frameCount = this.timeToFrame(keyData.time);
                listsx[i] = {
                    f: frameCount,
                    val: keyData.value,
                };
            }
            prop.push({
                name: valPropertyName,
                keys: listsx,
            })
        } else if (keyNode.type == Laya.KeyFrameValueType.Float as number) {
            let listsx: any[] = [];
            for (var i = 0; i < keyFrameCount; i++) {
                let keyData: Laya.FloatKeyframe = keyNode.getKeyframeByIndex(i) as Laya.FloatKeyframe;
                let frameCount = this.timeToFrame(keyData.time);
                listsx[i] = {
                    f: frameCount,
                    val: keyData.value,
                    tweenInfo: {
                        outTangent: keyData.outTangent,
                        outWeight: keyData.outWeight,
                        inTangent: keyData.inTangent,
                        inWeight: keyData.inWeight,
                    }
                };
            }
            prop.push({
                name: valPropertyName,
                keys: listsx,
            })
        } else if (keyNode.type == Laya.KeyFrameValueType.Vector2 as number) {
            if (null == propType[pathPath]) {
                propType[pathPath] = DataType.Vector2;
            }
            let listsx: any[] = [];
            let listsy: any[] = [];
            for (var i = 0; i < keyFrameCount; i++) {
                let keyData = keyNode.getKeyframeByIndex(i) as Laya.Vector3Keyframe;
                let frameCount = this.timeToFrame(keyData.time);
                listsx[i] = {
                    f: frameCount,
                    val: keyData.value.x,
                    tweenInfo: {
                        outTangent: keyData.outTangent.x,
                        outWeight: keyData.outWeight ? keyData.outWeight.x : 0,
                        inTangent: keyData.inTangent.x,
                        inWeight: keyData.inWeight ? keyData.inWeight.x : 0,
                    }
                };
                listsy[i] = {
                    f: frameCount,
                    val: keyData.value.y,
                    tweenInfo: {
                        outTangent: keyData.outTangent.y,
                        outWeight: keyData.outWeight ? keyData.outWeight.y : 0,
                        inTangent: keyData.inTangent.y,
                        inWeight: keyData.inWeight ? keyData.inWeight.y : 0,
                    }
                }
            }
            prop.push({
                name: "x",
                keys: listsx,
            })
            prop.push({
                name: "y",
                keys: listsy,
            })


        } else if (keyNode.type == Laya.KeyFrameValueType.PathPoint as number) {
            let listsx: any[] = [];
            for (var i = 0; i < keyFrameCount; i++) {
                let keyData = keyNode.getKeyframeByIndex(i) as Laya.PathPointKeyframe;
                let frameCount = this.timeToFrame(keyData.time);
                listsx[i] = {
                    f: frameCount,
                    val: (keyData.value as any)._$data,
                };
            }
            prop.push({
                name: valPropertyName,
                keys: listsx,
            })
        } else {

            if (null == propType[pathPath]) {
                propType[pathPath] = DataType.Vector3;
            }


            let listsx: any[] = [];
            let listsy: any[] = [];
            let listsz: any[] = [];
            for (var i = 0; i < keyFrameCount; i++) {
                let keyData = keyNode.getKeyframeByIndex(i) as Laya.Vector3Keyframe;
                let frameCount = this.timeToFrame(keyData.time);
                listsx[i] = {
                    f: frameCount,
                    val: keyData.value.x,
                    tweenInfo: {
                        outTangent: keyData.outTangent.x,
                        outWeight: keyData.outWeight ? keyData.outWeight.x : 0,
                        inTangent: keyData.inTangent.x,
                        inWeight: keyData.inWeight ? keyData.inWeight.x : 0,
                    }
                };
                listsy[i] = {
                    f: frameCount,
                    val: keyData.value.y,
                    tweenInfo: {
                        outTangent: keyData.outTangent.y,
                        outWeight: keyData.outWeight ? keyData.outWeight.y : 0,
                        inTangent: keyData.inTangent.y,
                        inWeight: keyData.inWeight ? keyData.inWeight.y : 0,
                    }
                }
                listsz[i] = {
                    f: frameCount,
                    val: keyData.value.z,
                    tweenInfo: {
                        outTangent: keyData.outTangent.z,
                        outWeight: keyData.outWeight ? keyData.outWeight.z : 0,
                        inTangent: keyData.inTangent.z,
                        inWeight: keyData.inWeight ? keyData.inWeight.z : 0,
                    }
                }
            }
            prop.push({
                name: "x",
                keys: listsx,
            })
            prop.push({
                name: "y",
                keys: listsy,
            })
            prop.push({
                name: "z",
                keys: listsz,
            })
        }
        if (null != data) {
            //lists.push(data);
            this._marginToList(lists, data);
        }
    }


    private static _marginToList(lists: TypeAniLayer[], data: TypeAniLayer) {
        if (null == lists) return;
        let isFind = false;
        for (let i = lists.length - 1; i >= 0; i--) {
            if (lists[i].name == data.name) {
                isFind = true;
                if (data.prop) {
                    for (let j = data.prop.length - 1; j >= 0; j--) {
                        this._marginToList(lists[i].prop, data.prop[j]);
                    }
                }
                break;
            }
        }
        if (!isFind) {
            lists.push(data);
        }
    }






    private static timeToFrame(second: number): number {
        return Math.round(second * AnimationClipUtil.FPS);
    }
    private static frameToTime(frame: number): number {
        return frame / AnimationClipUtil.FPS;
    }
    // public static timeLineDataToClip(data: any): Byte[] {
    //     if (this.sortMap == undefined) {
    //         this.sortMap = new Map<string, string[]>();
    //         this.sortMap.set("localPosition", ["x", "y", "z"]);
    //         this.sortMap.set("localScale", ["x", "y", "z"]);
    //         this.sortMap.set("localRotation", ["x", "y", "z", "w"]);
    //     }
    //     if (this.animClipType == undefined) {
    //         this.animClipType = new Map<string, number>();
    //         this.animClipType.set("localPosition", 1);
    //         this.animClipType.set("localScale", 3);
    //         this.animClipType.set("localRotation", 2);
    //     }
    //     var bytes: Byte[] = []
    //     var anis = data.anis
    //     for (var key in anis) {
    //         bytes.push(this.createClip(key, anis[key]))
    //     }

    //     return bytes;
    // }

    private static nameString: string[];
    private static startTimes: number[];
    private static clipFps: number;
    private static getNameStringIndex(name: string): number {
        var index: number = this.nameString.indexOf(name)
        if (index < 0) {
            this.nameString.push(name);
            index = this.nameString.length - 1;
        }
        return index;
    }

    private static getTimeIndex(time: number): number {
        var index: number = this.startTimes.indexOf(time)
        if (index < 0) {
            this.startTimes.push(time);
            index = this.startTimes.length - 1;
        }
        return index;
    }
    //标准化时间
    private static getNormatTime(fps: number) {
        return Math.round(fps * 1000 / this.clipFps) / 1000;
    }

    //将数据组织为标准化   [帧-值列表]  模式
    private static changeToValues(data: any, prop: string): Map<number, AniNodeFrameData> {
        var valueMap: Map<number, AniNodeFrameData> = new Map<number, AniNodeFrameData>();
        var value: string[] = this.sortMap.get(prop);
        var length = value.length;
        for (var i = 0; i < length; i++) {
            let datavalue = data[value[i]];
            var length2 = datavalue.length;
            for (var j = 0; j < length2; j++) {
                var kValue = datavalue[j];
                var framCount = kValue.f;
                if (!valueMap.has(framCount)) {
                    var normaltTime = this.getNormatTime(framCount)
                    var timeIndex = this.getTimeIndex(normaltTime);
                    valueMap.set(framCount, new AniNodeFrameData(framCount, normaltTime))
                }
                var frameData: AniNodeFrameData = valueMap.get(framCount)
                frameData.pushData(kValue)
            }
        }
        valueMap.forEach((value, key) => {
            if (value.valueNumbers.length != length) {
                console.error("数据长度未统一：" + prop)
            }
        })
        return valueMap;
    }
    private static createClip(clipName: string, data: any): Laya.Byte {
        this.nameString = [];
        this.startTimes = [];
        this.getNameStringIndex(clipName);
        this.clipFps = data.fps;
        var nodes = data.nodes;
        var animNodeDatas: AnimNodeData[] = []
        for (var nodeKey in nodes) {
            var paths = nodeKey.split(".");
            var pathIndex = []
            for (var index = paths.length - 1; index >= 0; index--) {
                pathIndex.push(this.getNameStringIndex(paths[index]));
            }
            let props = nodes[nodeKey];
            for (var pkey in props) {
                var typeIndex = this.getNameStringIndex(pkey);
                let propValue = props[pkey];
                for (var pvKey in propValue) {
                    var type = this.animClipType.get(pvKey);
                    var animNode = new AnimNodeData(type, pathIndex);
                    animNode.compomentTypeIndex = typeIndex;
                    animNode.addPropName(this.getNameStringIndex(pvKey));
                    animNode.updataFeameData(this.changeToValues(propValue[pvKey], pvKey));
                    animNodeDatas.push(animNode);
                }
            }
        }
        this.startTimes.sort(function (a, b) { return a - b; })
        var byte: Laya.Byte = new Laya.Byte();
        byte.writeUTFString(AnimationClipUtil.Version)
        //标记数据信息区
        let MarkContentAreaPosition_Start = byte.pos;//预留数据区偏移地址
        byte.writeUint32(0)//UInt32 offset
        byte.writeUint32(0)//UInt32 blockLength
        //内容段落信息区
        let BlockAreaPosition_Start = byte.pos;//预留段落数量
        var blockCount: number = 1;
        byte.writeUint16(blockCount);
        for (var j = 0; j < blockCount; j++) {
            byte.writeUint32(0);//UInt32 blockStart
            byte.writeUint32(0);//UInt32 blockLength
        }

        //字符区
        let StringAreaPosition_Start = byte.pos;//预留字符区
        byte.writeUint32(0);//UInt32 offset
        byte.writeUint16(0);//count

        //内容区
        let ContentAreaPosition_Start = byte.pos;//预留字符区
        byte.writeUint16(this.getNameStringIndex("ANIMATIONS"));//uint16 段落函数字符ID

        var timeCount: number = this.startTimes.length; //startTime
        byte.writeUint16(timeCount);
        for (var i = 0; i < timeCount; i++) {
            byte.writeFloat32(this.startTimes[i]);
        }
        byte.writeUint16(this.getNameStringIndex(clipName)) //动画名字符索引
        var aniTotalTime: number = timeCount > 0 ? this.startTimes[timeCount - 1] : 0;
        byte.writeFloat32(aniTotalTime);//动画总时长
        var isLoop = 0;
        if (data.isLooping) {
            isLoop = 1;
        }
        byte.writeByte(isLoop); //动画是否循环
        byte.writeUint16(this.clipFps); //frameRate
        let animNodeCount: number = animNodeDatas.length;
        byte.writeUint16(animNodeCount);//节点个数
        for (var i = 0; i < animNodeCount; i++) {
            var aniNodeData: AnimNodeData = animNodeDatas[i];
            byte.writeUint8(aniNodeData.type);//type
            byte.writeUint16(aniNodeData.pathLength);//pathLength
            for (var m = 0; m < aniNodeData.pathLength; m++) {
                byte.writeUint16(aniNodeData.pathIndex[m]);//pathIndex
            }
            byte.writeUint16(aniNodeData.compomentTypeIndex);//conpomentTypeIndex
            byte.writeUint16(aniNodeData.propertyNameLength);//propertyNameLength
            for (var m = 0; m < aniNodeData.propertyNameLength; m++)//frameDataLengthIndex
            {
                byte.writeUint16(aniNodeData.propertyNameIndex[m]);//propertyNameLength
            }
            byte.writeUint16(aniNodeData.keyFrameCount);//帧个数
            aniNodeData.aniNodeFrameDatas.forEach((animNodeFrameData: AniNodeFrameData) => {
                var startIndex = this.startTimes.indexOf(animNodeFrameData.startTime);
                byte.writeUint16(startIndex);//startTimeIndex
                var valueNumber: number[] = animNodeFrameData.valueNumbers;
                var inTangentNumber: number[] = animNodeFrameData.inTangentNumbers;
                var outTangentNumber: number[] = animNodeFrameData.outTangentNumbers;

                for (var n = 0; n < inTangentNumber.length; n++) {
                    byte.writeFloat32(inTangentNumber[n]);
                }
                for (var n = 0; n < outTangentNumber.length; n++) {
                    byte.writeFloat32(outTangentNumber[n]);
                }
                for (var n = 0; n < valueNumber.length; n++) {
                    byte.writeFloat32(valueNumber[n]);
                }
            });
        }
        //事件
        byte.writeUint16(0);  //暂未实现
        //字符数据区
        let StringDatasAreaPosition_Start = byte.pos;
        for (var j = 0; j < this.nameString.length; j++) {
            if (this.nameString[j] === "this") {
                byte.writeUTFString("");
            } else {
                byte.writeUTFString(this.nameString[j]);
            }

        }
        let StringDatasAreaPosition_End = byte.pos;
        //倒推字符区
        byte.pos = StringAreaPosition_Start + 4;
        byte.writeUint16(this.nameString.length);//count
        //倒推内容段落信息区
        byte.pos = BlockAreaPosition_Start + 2 + 4;
        byte.writeUint32(StringDatasAreaPosition_Start - ContentAreaPosition_Start);//UInt32 blockLength
        //倒推数据信息区
        byte.pos = MarkContentAreaPosition_Start;
        byte.writeUint32(StringDatasAreaPosition_Start);
        byte.writeUint32(StringDatasAreaPosition_End - StringDatasAreaPosition_Start);
        return byte;
    }
}

//动画节点信息
class AnimNodeData {
    public type: number;
    public pathLength: number;
    public pathIndex: number[];
    public compomentTypeIndex: number;
    public propertyNameLength: number;
    public propertyNameIndex: number[];
    public keyFrameCount: number;
    public aniNodeFrameDatas: Map<number, AniNodeFrameData>
    constructor(type: number, path: number[]) {
        this.type = type;
        this.pathIndex = path.concat();
        this.pathLength = this.pathIndex.length;
        this.compomentTypeIndex = 0;
        this.propertyNameIndex = [];
        this.propertyNameLength = 0;
    }
    public addPropName(value: number) {
        this.propertyNameIndex.push(value)
        this.propertyNameLength++;
    }
    public updataFeameData(aniNodeFrameDatas: Map<number, AniNodeFrameData>) {
        this.aniNodeFrameDatas = aniNodeFrameDatas;
        this.keyFrameCount = aniNodeFrameDatas.size
    }
}

class AniNodeFrameData {
    public startTime: number;
    public inTangentNumbers: number[];
    public outTangentNumbers: number[];
    public inWeightNumbers: number[];
    public outWeightNumbers: number[]
    public valueNumbers: number[];
    constructor(framCount: number, startTime: number) {
        // this.framCount = framCount;
        this.startTime = startTime;
        this.outTangentNumbers = [];
        this.inTangentNumbers = [];
        this.valueNumbers = []
    }
    public pushData(kValue: any) {
        this.valueNumbers.push(kValue.val);
        var tweenInfo = kValue.tweenInfo;
        if (tweenInfo) {
            if (tweenInfo.inTangent) {
                this.inTangentNumbers.push(tweenInfo.inTangent);
            } else {
                this.inTangentNumbers.push(0);
            }
            if (tweenInfo.outTangent) {
                this.outTangentNumbers.push(tweenInfo.outTangent);
            } else {
                this.outTangentNumbers.push(0);
            }

            if (tweenInfo.inWeight) {
                this.inWeightNumbers.push(tweenInfo.inWeight);
            } else {
                this.inWeightNumbers.push(Laya.Keyframe.defaultWeight);
            }

            if (tweenInfo.outWeight) {
                this.outWeightNumbers.push(tweenInfo.outWeight);
            } else {
                this.inWeightNumbers.push(Laya.Keyframe.defaultWeight);
            }
        } else {
            this.inTangentNumbers.push(0);
            this.outTangentNumbers.push(0);
            this.inWeightNumbers.push(Laya.Keyframe.defaultWeight);
            this.inWeightNumbers.push(Laya.Keyframe.defaultWeight);
        }

    }
}