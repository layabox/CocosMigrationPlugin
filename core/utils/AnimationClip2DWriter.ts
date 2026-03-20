

const VERSION_2D = "LAYAANIMATION2D:01";

/**
 * 2D 动画剪辑二进制写入器
 * 将 Laya.AnimationClip2D 序列化为 .mc 格式的二进制数据
 * 格式与 AnimationClip2DParse01 解析器对应
 */
export class AnimationClip2DWriter {

    public static write(clip: Laya.AnimationClip2D): ArrayBuffer {
        const stringDatas: string[] = [];
        const numList: number[] = [];

        const byte = new Laya.Byte();

        // 写入版本号
        byte.writeUTFString(VERSION_2D);

        // 标记数据信息区
        const markContentAreaPos = byte.pos;
        byte.writeUint32(0); // dataOffset (稍后回填)
        byte.writeUint32(0); // dataSize (稍后回填)

        // 内容段落信息区
        const blockAreaPos = byte.pos;
        const blockCount = 1;
        byte.writeUint16(blockCount);
        byte.writeUint32(0); // block[0].start
        byte.writeUint32(0); // block[0].length (稍后回填)

        // 字符区域
        const stringAreaPos = byte.pos;
        byte.writeUint32(0); // stringOffset (稍后回填)
        byte.writeUint16(0); // stringCount (稍后回填)

        // ========== 内容区 ==========
        const contentAreaPos = byte.pos;

        // ANIMATIONS2D 标记
        const animations2DIdx = AnimationClip2DWriter.getItemIndex(stringDatas, "ANIMATIONS2D");
        byte.writeUint16(animations2DIdx);

        // 收集所有数值到 numList
        AnimationClip2DWriter.collectNumList(clip, numList);

        // 写入 numList
        byte.writeUint16(numList.length);
        for (const num of numList) {
            byte.writeFloat32(num);
        }

        // duration → numList 索引
        byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, clip._duration));

        // isLooping
        byte.writeByte(clip.islooping ? 1 : 0);

        // frameRate
        byte.writeUint16(clip._frameRate);

        // nodeCount
        const nodeCount = clip._nodes ? clip._nodes.count : 0;
        byte.writeUint16(nodeCount);

        // 写入每个节点
        for (let i = 0; i < nodeCount; i++) {
            const node: Laya.KeyframeNode2D = clip._nodes.getNodeByIndex(i);

            // ownerPath
            const pathLength = node.ownerPathCount;
            byte.writeUint16(pathLength);
            for (let j = 0; j < pathLength; j++) {
                byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, node.getOwnerPathByIndex(j)));
            }

            // property
            const propertyLength = node.propertyCount;
            byte.writeUint16(propertyLength);
            for (let j = 0; j < propertyLength; j++) {
                byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, node.getPropertyByIndex(j)));
            }

            // keyframes
            const keyframeCount = node._keyFrames.length;
            byte.writeUint16(keyframeCount);

            for (let j = 0; j < keyframeCount; j++) {
                const kf: Laya.Keyframe2D = node._keyFrames[j];
                const data = kf.data as any;

                // time → numList 索引
                byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, kf.time));

                // tweenType
                if (data.tweenType) {
                    byte.writeByte(1);
                    byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, data.tweenType));
                } else {
                    byte.writeByte(0);
                }

                // tweenInfo
                if (data.tweenInfo) {
                    byte.writeByte(1);
                    // inTangent, outTangent
                    byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.inTangent ?? 0));
                    byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.outTangent ?? 0));

                    // inWeight
                    if (data.tweenInfo.inWeight !== undefined && data.tweenInfo.inWeight !== null) {
                        byte.writeByte(1);
                        byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.inWeight));
                    } else {
                        byte.writeByte(0);
                    }

                    // outWeight
                    if (data.tweenInfo.outWeight !== undefined && data.tweenInfo.outWeight !== null) {
                        byte.writeByte(1);
                        byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.outWeight));
                    } else {
                        byte.writeByte(0);
                    }
                } else {
                    byte.writeByte(0);
                }

                // value
                const val = data.val;
                if (typeof val === "number") {
                    byte.writeByte(0);
                    byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, val));
                } else if (typeof val === "string") {
                    byte.writeByte(1);
                    byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, val));
                } else if (typeof val === "boolean") {
                    byte.writeByte(2);
                    byte.writeByte(val ? 1 : 0);
                } else if (val && typeof val === "object") {
                    // CurvePath 或其他 JSON 对象
                    byte.writeByte(3);
                    const jsonData = (val as any)._$data ?? val;
                    byte.writeUTFString(JSON.stringify(jsonData));
                } else {
                    // 默认写 0
                    byte.writeByte(0);
                    byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, 0));
                }

                // extend
                if (data.extend !== undefined && data.extend !== null) {
                    byte.writeByte(1);
                    byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, JSON.stringify(data.extend)));
                } else {
                    byte.writeByte(0);
                }
            }
        }

        // 事件
        const events = clip._animationEvents || [];
        byte.writeUint16(events.length);
        for (const event of events) {
            // time → numList 索引
            byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, event.time));
            // eventName → string 索引
            byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, event.eventName));

            const params = event.params || [];
            byte.writeUint16(params.length);
            for (const param of params) {
                if (typeof param === "boolean") {
                    byte.writeByte(0);
                    byte.writeByte(param ? 1 : 0);
                } else if (typeof param === "number") {
                    if (Number.isInteger(param)) {
                        byte.writeByte(1);
                        byte.writeInt32(param);
                    } else {
                        byte.writeByte(2);
                        byte.writeUint16(AnimationClip2DWriter.getNumIndex(numList, param));
                    }
                } else if (typeof param === "string") {
                    byte.writeByte(3);
                    byte.writeUint16(AnimationClip2DWriter.getItemIndex(stringDatas, param));
                }
            }
        }

        // ========== 字符数据区 ==========
        const stringDatasAreaStart = byte.pos;
        for (const str of stringDatas) {
            byte.writeUTFString(str);
        }
        const stringDatasAreaEnd = byte.pos;

        // ========== 回填 ==========

        // 回填 stringCount
        byte.pos = stringAreaPos + 4;
        byte.writeUint16(stringDatas.length);

        // 回填 block[0].length
        byte.pos = blockAreaPos + 2 + 4;
        byte.writeUint32(stringDatasAreaStart - contentAreaPos);

        // 回填 dataOffset 和 dataSize
        byte.pos = markContentAreaPos;
        byte.writeUint32(stringDatasAreaStart);
        byte.writeUint32(stringDatasAreaEnd - stringDatasAreaStart);

        return byte.buffer;
    }

    /**
     * 收集所有数值到 numList（去重）
     */
    private static collectNumList(clip: Laya.AnimationClip2D, numList: number[]): void {
        // duration
        AnimationClip2DWriter.getNumIndex(numList, clip._duration);

        const nodeCount = clip._nodes ? clip._nodes.count : 0;
        for (let i = 0; i < nodeCount; i++) {
            const node: Laya.KeyframeNode2D = clip._nodes.getNodeByIndex(i);
            for (let j = 0; j < node._keyFrames.length; j++) {
                const kf: Laya.Keyframe2D = node._keyFrames[j];
                const data = kf.data as any;

                // time
                AnimationClip2DWriter.getNumIndex(numList, kf.time);

                // tweenInfo
                if (data.tweenInfo) {
                    AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.inTangent ?? 0);
                    AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.outTangent ?? 0);
                    if (data.tweenInfo.inWeight !== undefined && data.tweenInfo.inWeight !== null) {
                        AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.inWeight);
                    }
                    if (data.tweenInfo.outWeight !== undefined && data.tweenInfo.outWeight !== null) {
                        AnimationClip2DWriter.getNumIndex(numList, data.tweenInfo.outWeight);
                    }
                }

                // numeric value
                if (typeof data.val === "number") {
                    AnimationClip2DWriter.getNumIndex(numList, data.val);
                }
            }
        }

        // events
        const events = clip._animationEvents || [];
        for (const event of events) {
            AnimationClip2DWriter.getNumIndex(numList, event.time);
            if (event.params) {
                for (const param of event.params) {
                    if (typeof param === "number" && !Number.isInteger(param)) {
                        AnimationClip2DWriter.getNumIndex(numList, param);
                    }
                }
            }
        }
    }

    private static getItemIndex(arr: string[], item: string): number {
        if (item === null || item === undefined) item = "";
        let index = arr.indexOf(item);
        if (index === -1) {
            arr.push(item);
            return arr.length - 1;
        }
        return index;
    }

    private static getNumIndex(numList: number[], value: number): number {
        if (value === null || value === undefined) value = 0;
        let index = numList.indexOf(value);
        if (index === -1) {
            numList.push(value);
            return numList.length - 1;
        }
        return index;
    }
}
