

//const VERSION: string = "LAYAANIMATION:04";
//const VERSION = "LAYAANIMATION:WEIGHT_04";
const VERSION = "LAYAANIMATION:WEIGHT_05";

export class AnimationClipWriter {

    public static write(clip: Laya.AnimationClip): ArrayBuffer {
        // 收集 数据
        let stringDatas: Array<string> = new Array();


        let startTimeList: Array<number> = new Array();
        AnimationClipWriter.getClipStartTimes(clip, startTimeList);

        let byte: Laya.Byte = new Laya.Byte();

        byte.writeUTFString(VERSION);

        // 标记数据信息区
        let MarkContentAreaPosition_Start: number = byte.pos;

        // data
        let dataOffset: number = 0;
        byte.writeUint32(dataOffset); // offset
        let dataSize: number = 0;
        byte.writeUint32(dataSize); // size

        // 内容段落信息区
        let BlockAreaPosition_Start: number = byte.pos;

        // block
        let blockCount: number = 1;
        byte.writeUint16(blockCount);
        for (let index = 0; index < blockCount; index++) {
            let blockStart: number = 0;
            byte.writeUint32(blockStart);
            let blockLength: number = 0;
            byte.writeUint32(blockLength);
        }

        // 字符区域
        let StringAreaPosition_Start: number = byte.pos;

        // strings
        let stringOffset: number = 0;
        byte.writeUint32(stringOffset);
        let stringCount: number = 0;
        byte.writeUint16(stringCount);

        // 内容区
        let ContentAreaPosition_Start: number = byte.pos;

        let ANIMATIONSStringIndex = AnimationClipWriter.getItemIndex(stringDatas, "ANIMATIONS");
        byte.writeUint16(ANIMATIONSStringIndex);

        // Aniamtions block data
        let startTimeTypeCount: number = startTimeList.length;
        byte.writeUint16(startTimeTypeCount);
        for (let index = 0; index < startTimeTypeCount; index++) {
            let startTimeType: number = startTimeList[index];
            byte.writeFloat32(startTimeType);
        }

        let clipNameIndex: number = AnimationClipWriter.getItemIndex(stringDatas, clip.name);
        byte.writeUint16(clipNameIndex);

        let duration: number = clip.duration();
        byte.writeFloat32(duration);

        let isLooping: number = clip.islooping ? 1 : 0;
        byte.writeByte(isLooping);

        let frameRate: number = clip._frameRate;
        byte.writeInt16(frameRate);

        // node
        let nodeCount: number = clip._nodes.count;
        byte.writeInt16(nodeCount);

        for (let index = 0; index < nodeCount; index++) {
            let node: Laya.KeyframeNode = clip._nodes.getNodeByIndex(index);

            let propertyChangePath = (node as any).propertyChangePath;
            if (null != propertyChangePath) {
                byte.writeByte(1);
                byte.writeUint16(AnimationClipWriter.getItemIndex(stringDatas, propertyChangePath));
            } else {
                byte.writeByte(0);
            }

            let callbackFunData = node.callbackFunData;
            if (null != callbackFunData) {
                byte.writeByte(1);
                byte.writeUint16(AnimationClipWriter.getItemIndex(stringDatas, callbackFunData));
            } else {
                byte.writeByte(0);
                //byte.writeUint16(AnimationClipWriter.getItemIndex(stringDatas, node.callbackFunData));
            }
            if (node.callParams) {
                let len = node.callParams.length;
                byte.writeUint8(len);
                for (let i = 0; i < len; i++) {
                    byte.writeUint16(AnimationClipWriter.getItemIndex(stringDatas, node.callParams[i]));
                }
            } else {
                byte.writeUint8(0);
            }

            let nodeType: number = node.type;
            byte.writeUint8(nodeType);

            let pathLength: number = node.ownerPathCount;
            byte.writeUint16(pathLength);

            for (let i = 0; i < pathLength; i++) {
                let pathString: string = node.getOwnerPathByIndex(i);
                let pathStringIndex: number = AnimationClipWriter.getItemIndex(stringDatas, pathString);
                byte.writeUint16(pathStringIndex);
            }

            if (null == node.propertyOwner) {
                node.propertyOwner = '';
            }
            let propertyOwnerStringIndex: number = AnimationClipWriter.getItemIndex(stringDatas, node.propertyOwner);
            byte.writeUint16(propertyOwnerStringIndex);

            let propertyLength: number = node.propertyCount;
            byte.writeUint16(propertyLength);

            for (let i = 0; i < propertyLength; i++) {
                let propertyString: string = node.getPropertyByIndex(i);
                let propertyStringIndex: number = AnimationClipWriter.getItemIndex(stringDatas, propertyString);
                byte.writeUint16(propertyStringIndex);
            }

            let keyframeCount = node.keyFramesCount;
            byte.writeUint16(keyframeCount);

            for (let j = 0; j < keyframeCount; j++) {
                switch (nodeType) {
                    case Laya.KeyFrameValueType.PathPoint: {
                        let pathPointKeyframe: Laya.PathPointKeyframe = <Laya.PathPointKeyframe>node.getKeyframeByIndex(j);
                        let startTimeTypeIndex: number = startTimeList.indexOf(pathPointKeyframe.time);
                        byte.writeUint16(startTimeTypeIndex);
                        const value = JSON.stringify((pathPointKeyframe.value as any)._$data);
                        byte.writeUTFString(value);
                        break;
                    }
                    case Laya.KeyFrameValueType.Boolean: {
                        let floatKeyframe: Laya.FloatKeyframe = <Laya.FloatKeyframe>node.getKeyframeByIndex(j);
                        let startTimeTypeIndex: number = startTimeList.indexOf(floatKeyframe.time);
                        byte.writeUint16(startTimeTypeIndex);
                        if (floatKeyframe.value) {
                            byte.writeByte(1);
                        } else {
                            byte.writeByte(0);
                        }
                        break;
                    }
                    case Laya.KeyFrameValueType.Float: {
                        let floatKeyframe: Laya.FloatKeyframe = <Laya.FloatKeyframe>node.getKeyframeByIndex(j);
                        let startTimeTypeIndex: number = startTimeList.indexOf(floatKeyframe.time);
                        byte.writeUint16(startTimeTypeIndex);
                        let inTangent: number = floatKeyframe.inTangent;
                        byte.writeFloat32(inTangent);
                        let outTangent: number = floatKeyframe.outTangent;
                        byte.writeFloat32(outTangent);

                        let val = floatKeyframe.value;
                        byte.writeFloat32(val);


                        byte.writeUint8(floatKeyframe.weightedMode);


                        if (Laya.WeightedMode.In == floatKeyframe.weightedMode || Laya.WeightedMode.Both == floatKeyframe.weightedMode) {
                            byte.writeFloat32(floatKeyframe.inWeight);
                        }
                        if (Laya.WeightedMode.Out == floatKeyframe.weightedMode || Laya.WeightedMode.Both == floatKeyframe.weightedMode) {
                            byte.writeFloat32(floatKeyframe.outWeight);
                        }

                        break;
                    } case Laya.KeyFrameValueType.Vector2: {

                        let floatArrayKeyframe: Laya.Vector2Keyframe = <Laya.Vector2Keyframe>node.getKeyframeByIndex(j);

                        let startTimeTypeIndex: number = startTimeList.indexOf(floatArrayKeyframe.time);

                        byte.writeUint16(startTimeTypeIndex);
                        let inTangentx: number = floatArrayKeyframe.inTangent.x;
                        byte.writeFloat32(inTangentx);
                        let inTangenty: number = floatArrayKeyframe.inTangent.y;
                        byte.writeFloat32(inTangenty);
                        let outTangentx: number = floatArrayKeyframe.outTangent.x;
                        byte.writeFloat32(outTangentx);
                        let outTangenty: number = floatArrayKeyframe.outTangent.y;
                        byte.writeFloat32(outTangenty);
                        let valuex: number = floatArrayKeyframe.value.x;
                        byte.writeFloat32(valuex);
                        let valuey: number = floatArrayKeyframe.value.y;
                        byte.writeFloat32(valuey);

                        let isWeight = 1;
                        if (!floatArrayKeyframe.weightedMode || (Laya.WeightedMode.None == floatArrayKeyframe.weightedMode.x && Laya.WeightedMode.None == floatArrayKeyframe.weightedMode.y)) {
                            isWeight = 0;
                        }
                        byte.writeByte(isWeight);

                        if (isWeight) {
                            if (floatArrayKeyframe.weightedMode) {
                                byte.writeUint8(floatArrayKeyframe.weightedMode.x);
                                byte.writeUint8(floatArrayKeyframe.weightedMode.y);
                            } else {
                                byte.writeUint8(0);
                                byte.writeUint8(0);
                            }
                            if (floatArrayKeyframe.inWeight) {
                                byte.writeFloat32(floatArrayKeyframe.inWeight.x);
                                byte.writeFloat32(floatArrayKeyframe.inWeight.y);
                            } else {
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                            }
                            if (floatArrayKeyframe.outWeight) {
                                byte.writeFloat32(floatArrayKeyframe.outWeight.x);
                                byte.writeFloat32(floatArrayKeyframe.outWeight.y);
                            } else {
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                            }
                        }



                        break;
                    }
                    case Laya.KeyFrameValueType.Scale:
                    case Laya.KeyFrameValueType.Position:
                    case Laya.KeyFrameValueType.RotationEuler:
                    case Laya.KeyFrameValueType.Vector3: {
                        let floatArrayKeyframe: Laya.Vector3Keyframe = <Laya.Vector3Keyframe>node.getKeyframeByIndex(j);

                        let startTimeTypeIndex: number = startTimeList.indexOf(floatArrayKeyframe.time);

                        byte.writeUint16(startTimeTypeIndex);
                        let inTangentx: number = floatArrayKeyframe.inTangent.x;
                        byte.writeFloat32(inTangentx);
                        let inTangenty: number = floatArrayKeyframe.inTangent.y;
                        byte.writeFloat32(inTangenty);
                        let inTangentz: number = floatArrayKeyframe.inTangent.z;
                        byte.writeFloat32(inTangentz);
                        let outTangentx: number = floatArrayKeyframe.outTangent.x;
                        byte.writeFloat32(outTangentx);
                        let outTangenty: number = floatArrayKeyframe.outTangent.y;
                        byte.writeFloat32(outTangenty);
                        let outTangentz: number = floatArrayKeyframe.outTangent.z;
                        byte.writeFloat32(outTangentz);
                        let valuex: number = floatArrayKeyframe.value.x;
                        byte.writeFloat32(valuex);
                        let valuey: number = floatArrayKeyframe.value.y;
                        byte.writeFloat32(valuey);
                        let valuez: number = floatArrayKeyframe.value.z;
                        byte.writeFloat32(valuez);

                        let isWeight = 1;
                        if (!floatArrayKeyframe.weightedMode || (Laya.WeightedMode.None == floatArrayKeyframe.weightedMode.x && Laya.WeightedMode.None == floatArrayKeyframe.weightedMode.y && Laya.WeightedMode.None == floatArrayKeyframe.weightedMode.z)) {
                            isWeight = 0;
                        }
                        byte.writeByte(isWeight);

                        if (isWeight) {

                            if (floatArrayKeyframe.weightedMode) {
                                byte.writeUint8(floatArrayKeyframe.weightedMode.x);
                                byte.writeUint8(floatArrayKeyframe.weightedMode.y);
                                byte.writeUint8(floatArrayKeyframe.weightedMode.z);
                            } else {
                                byte.writeUint8(0);
                                byte.writeUint8(0);
                                byte.writeUint8(0);
                            }
                            if (floatArrayKeyframe.inWeight) {
                                byte.writeFloat32(floatArrayKeyframe.inWeight.x);
                                byte.writeFloat32(floatArrayKeyframe.inWeight.y);
                                byte.writeFloat32(floatArrayKeyframe.inWeight.z);
                            } else {
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                            }
                            if (floatArrayKeyframe.outWeight) {
                                byte.writeFloat32(floatArrayKeyframe.outWeight.x);
                                byte.writeFloat32(floatArrayKeyframe.outWeight.y);
                                byte.writeFloat32(floatArrayKeyframe.outWeight.z);
                            } else {
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                            }

                        }


                        break;
                    }
                    case Laya.KeyFrameValueType.Vector4:
                    case Laya.KeyFrameValueType.Rotation:
                    case Laya.KeyFrameValueType.Color: {
                        let quaternionKeyframe: Laya.Vector4Keyframe = <Laya.Vector4Keyframe>node.getKeyframeByIndex(j);

                        let startTimeTypeIndex: number = startTimeList.indexOf(quaternionKeyframe.time);;
                        byte.writeUint16(startTimeTypeIndex);
                        let inTangentx: number = quaternionKeyframe.inTangent.x;
                        byte.writeFloat32(inTangentx);
                        let inTangenty: number = quaternionKeyframe.inTangent.y;
                        byte.writeFloat32(inTangenty);
                        let inTangentz: number = quaternionKeyframe.inTangent.z;
                        byte.writeFloat32(inTangentz);
                        let inTangentw: number = quaternionKeyframe.inTangent.w;
                        byte.writeFloat32(inTangentw);
                        let outTangentx: number = quaternionKeyframe.outTangent.x;
                        byte.writeFloat32(outTangentx);
                        let outTangenty: number = quaternionKeyframe.outTangent.y;
                        byte.writeFloat32(outTangenty);
                        let outTangentz: number = quaternionKeyframe.outTangent.z;
                        byte.writeFloat32(outTangentz);
                        let outTangentw: number = quaternionKeyframe.outTangent.w;
                        byte.writeFloat32(outTangentw);
                        let valuex: number = quaternionKeyframe.value.x;
                        byte.writeFloat32(valuex);
                        let valuey: number = quaternionKeyframe.value.y;
                        byte.writeFloat32(valuey);
                        let valuez: number = quaternionKeyframe.value.z;
                        byte.writeFloat32(valuez);
                        let valuew: number = quaternionKeyframe.value.w;
                        byte.writeFloat32(valuew);


                        let isWeight = 1;
                        if (!quaternionKeyframe.weightedMode || (Laya.WeightedMode.None == quaternionKeyframe.weightedMode.x && Laya.WeightedMode.None == quaternionKeyframe.weightedMode.y && Laya.WeightedMode.None == quaternionKeyframe.weightedMode.z && Laya.WeightedMode.None == quaternionKeyframe.weightedMode.w)) {
                            isWeight = 0;
                        }
                        byte.writeByte(isWeight);

                        if (isWeight) {

                            if (quaternionKeyframe.weightedMode) {
                                byte.writeUint8(quaternionKeyframe.weightedMode.x);
                                byte.writeUint8(quaternionKeyframe.weightedMode.y);
                                byte.writeUint8(quaternionKeyframe.weightedMode.z);
                                byte.writeUint8(quaternionKeyframe.weightedMode.w);
                            } else {
                                byte.writeUint8(0);
                                byte.writeUint8(0);
                                byte.writeUint8(0);
                                byte.writeUint8(0);
                            }
                            if (quaternionKeyframe.inWeight) {
                                byte.writeFloat32(quaternionKeyframe.inWeight.x);
                                byte.writeFloat32(quaternionKeyframe.inWeight.y);
                                byte.writeFloat32(quaternionKeyframe.inWeight.z);
                                byte.writeFloat32(quaternionKeyframe.inWeight.w);
                            } else {
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                            }
                            if (quaternionKeyframe.outWeight) {
                                byte.writeFloat32(quaternionKeyframe.outWeight.x);
                                byte.writeFloat32(quaternionKeyframe.outWeight.y);
                                byte.writeFloat32(quaternionKeyframe.outWeight.z);
                                byte.writeFloat32(quaternionKeyframe.outWeight.w);
                            } else {
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                                byte.writeFloat32(0);
                            }
                        }



                        break;
                    }
                    default:
                        throw "AnimationClipParser04:unknown type.";
                }
            }



        }

        // event
        let eventCount: number = clip._animationEvents.length;
        byte.writeUint16(eventCount);

        for (let index = 0; index < eventCount; index++) {

            let event: Laya.AnimationEvent = clip._animationEvents[index];

            let eventTime: number = event.time;
            byte.writeFloat32(eventTime);

            let eventNameStringIndex: number = AnimationClipWriter.getItemIndex(stringDatas, event.eventName);
            byte.writeUint16(eventNameStringIndex);

            let paramCount: number = 0;
            if (event.params) {
                paramCount = event.params.length;
            }
            byte.writeUint16(paramCount);

            for (let i = 0; i < paramCount; i++) {

                let param: any = event.params[i];
                // 无法判断 int 和 float， 统一 float
                let enentByte: number = 2;
                if (typeof (param) == "string") {
                    enentByte = 3;
                }
                byte.writeByte(enentByte);
                switch (enentByte) {
                    case 0: {
                        byte.writeByte(param);
                        break;
                    }
                    case 1: {
                        byte.writeInt32(param);
                        break;
                    }
                    case 2: {
                        byte.writeFloat32(param);
                        break;
                    }
                    case 3: {
                        let paramStringIndex: number = AnimationClipWriter.getItemIndex(stringDatas, param);
                        byte.writeInt16(paramStringIndex);
                        break;
                    }
                    default:
                        throw new Error("unknown type.");
                }
            }
        }

        // 字符数据区
        let StringDatasAreaPosition_Start: number = byte.pos;
        for (let index = 0; index < stringDatas.length; index++) {
            byte.writeUTFString(stringDatas[index]);
        }
        let StringDatasAreaPosition_End: number = byte.pos;

        // 倒推字符区
        byte.pos = StringAreaPosition_Start + 4;
        byte.writeUint16(stringDatas.length);

        // 倒推内容段落信息区
        byte.pos = BlockAreaPosition_Start + 2 + 4;
        byte.writeUint32(StringDatasAreaPosition_Start - ContentAreaPosition_Start);

        // 倒推数据信息区
        byte.pos = MarkContentAreaPosition_Start;
        byte.writeUint32(StringDatasAreaPosition_Start);
        byte.writeUint32(StringDatasAreaPosition_End - StringDatasAreaPosition_Start);

        return byte.buffer;
    }

    private static getItemIndex(arr: any[], item: any): number {
        if (null == item || undefined == item) return 0;
        let index: number = arr.indexOf(item);
        if (index == -1) {
            arr.push(item);
            return arr.indexOf(item);
        }
        else {
            return index;
        }
    }

    private static getClipStartTimes(clip: Laya.AnimationClip, startTimeList: Array<number>): void {
        let nodeCount: number = clip._nodes.count;

        for (let index = 0; index < nodeCount; index++) {
            let node: Laya.KeyframeNode = clip._nodes.getNodeByIndex(index);

            let keyframeCount: number = node.keyFramesCount;

            for (let i = 0; i < keyframeCount; i++) {
                let keyFrame: Laya.Keyframe = node.getKeyframeByIndex(i);
                let startTime: number = keyFrame.time;
                AnimationClipWriter.getItemIndex(startTimeList, startTime);
            }
        }
    }
}