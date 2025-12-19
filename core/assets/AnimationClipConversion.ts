import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import AnimationClipUtil from "../utils/AnimationClipUtil";
import { AnimationClipWriter } from "../utils/AnimationClipWriter";
import fs from "fs";
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
export interface TypePathPoint {
    pos: Vector3,
    c1: Vector3,
    c2: Vector3,
    curve: CurveType,
    rotationType?: 0 | 1 | 2,
}
export interface Vector3 {
    x: number,
    y: number,
    z: number,
}
export enum CurveType {
    /**
     * @en Curve type: Cardinal spline.
     * @zh 曲线类型：基数样条。
     */
    CRSpline,
    /**
     * @en Curve type: Bezier curve.
     * @zh 曲线类型：贝塞尔曲线。
     */
    Bezier,
    /**
     * @en Curve type: Cubic Bezier curve.
     * @zh 曲线类型：三次贝塞尔曲线。
     */
    CubicBezier,
    /**
     * @en Curve type: Straight line.
     * @zh 曲线类型：直线。
     */
    Straight
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

/**
 * Cocos Creator 动画剪辑文件转换器
 * 将 Cocos 的 .anim 文件转换为 Laya 的 .lani 文件
 */
export class AnimationClipConversion implements ICocosAssetConversion {
    constructor(private owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        try {
            // 读取 Cocos 动画文件
            const cocosAnimData = await IEditorEnv.utils.readJsonAsync(sourcePath);

            // Cocos 动画文件可能是一个数组，第一个元素是主对象
            let rootData: any;
            let allObjects: any[] = [];
            
            if (Array.isArray(cocosAnimData)) {
                // 找到 cc.AnimationClip 对象（通常是第一个）
                rootData = cocosAnimData.find((obj: any) => obj && obj.__type__ === "cc.AnimationClip");
                if (!rootData && cocosAnimData.length > 0) {
                    rootData = cocosAnimData[0];
                }
                allObjects = cocosAnimData;
            } else {
                rootData = cocosAnimData;
                allObjects = [cocosAnimData];
            }

            if (!rootData) {
                console.warn("[AnimationClipConversion] No valid AnimationClip found in data");
                return;
            }

            // 转换为 TypeAniData 格式
            console.debug(`[AnimationClipConversion] Root data type: ${rootData?.__type__}`);
            console.debug(`[AnimationClipConversion] Total objects: ${allObjects.length}`);
            console.debug(`[AnimationClipConversion] Tracks count: ${rootData?._tracks?.length || 0}`);
            
            const layaAnimData = this.convertToTypeAniData(rootData, allObjects);

            // 打印转换后的数据
            console.debug(`[AnimationClipConversion] Converted animation: ${sourcePath}`);
            console.debug(JSON.stringify(layaAnimData, null, 2));

            // 修改目标路径扩展名为 .lani
            targetPath = targetPath.replace(/\.anim$/i, '.lani');
            const clip = AnimationClipUtil.aniDataToAnimationClip(layaAnimData);
            const buffer = AnimationClipWriter.write(clip);
            fs.writeFileSync(targetPath, new Uint8Array(buffer));

            // 写入 meta 文件
            await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });

            console.debug(`Animation clip converted: ${sourcePath} -> ${targetPath}`);
        } catch (error) {
            console.error(`Failed to convert animation clip ${sourcePath}:`, error);
            throw error;
        }
    }

    /**
     * 将 Cocos 动画数据转换为 TypeAniData 格式
     * 
     * Cocos 动画文件结构（基于实际文件）：
     * - 文件是一个数组，第一个元素是 cc.AnimationClip
     * - 其他元素是被引用的对象（通过 __id__ 引用）
     * 
     * AnimationClip 结构：
     * - __type__: "cc.AnimationClip"
     * - sample: 帧率（fps）
     * - speed: 播放速度
     * - wrapMode: 循环模式（0=Default, 1=Normal, 2=Loop, 3=PingPong, 4=Reverse）
     * - _duration: 动画时长（秒）
     * - _tracks: 数组，包含 {__id__: number} 引用
     * - _events: 事件数组
     * 
     * VectorTrack 结构：
     * - _binding: TrackBinding，包含 path (TrackPath)
     * - _channels: 数组，每个是 {__id__: number} 引用到 Channel
     * - _nComponents: 组件数量（如 3 表示 x, y, z）
     * 
     * TrackPath 结构：
     * - _paths: 数组，包含 {__id__: number} 引用到 HierarchyPath 和属性名（如 "position"）
     * 
     * HierarchyPath 结构：
     * - path: 节点路径字符串（如 "root/building_firecamp_skin_1a"）
     * 
     * Channel 结构：
     * - _curve: {__id__: number} 引用到 RealCurve
     * 
     * RealCurve 结构：
     * - _times: 时间数组（秒）
     * - _values: 数组，每个是 RealKeyframeValue
     * 
     * RealKeyframeValue 结构：
     * - value: 数值
     * - rightTangent: 右切线
     * - leftTangent: 左切线
     * - rightTangentWeight: 右切线权重
     * - leftTangentWeight: 左切线权重
     */
    private convertToTypeAniData(cocosData: any, allObjects: any[]): TypeAniData {
        if (!cocosData || typeof cocosData !== "object") {
            console.warn("[AnimationClipConversion] Invalid Cocos animation data, creating empty animation");
            return this.createEmptyTypeAniData();
        }

        // 获取帧率
        const fps = cocosData.sample ?? cocosData.frameRate ?? cocosData.fps ?? 30;
        // 获取时长（秒）
        const duration = cocosData._duration ?? cocosData.duration ?? 0;
        // 计算总帧数
        const totalFrame = Math.ceil(duration * fps);
        // 获取循环模式
        const wrapMode = cocosData.wrapMode ?? cocosData._wrapMode ?? 0;
        const loop = wrapMode === 2 || wrapMode === 3; // Loop 或 PingPong 表示循环

        // 构建 TypeAniData
        const aniData: TypeAniData = {
            fps: fps,
            loop: loop,
            totalFrame: totalFrame,
            is3D: true, // 默认是3D动画
            event: [],
            aniData: {
                name: "",
                child: []
            },
            propType: {}
        };

        // 转换事件
        const events = cocosData._events || cocosData.events || [];
        if (Array.isArray(events)) {
            aniData.event = events.map((event: any) => ({
                time: event.time ?? 0,
                eventName: event.eventName || event.function || "",
                params: event.params || []
            }));
        }

        // 转换 _tracks 为层级结构
        const tracks = cocosData._tracks || [];
        console.debug(`[AnimationClipConversion] Found ${tracks.length} tracks`);
        if (Array.isArray(tracks) && tracks.length > 0) {
            // 需要解析引用（__id__ 和 __type__）
            const resolvedTracks = this.resolveReferences(tracks, allObjects);
            console.debug(`[AnimationClipConversion] Resolved ${resolvedTracks.length} tracks`);
            if (resolvedTracks.length > 0) {
                console.debug(`[AnimationClipConversion] First track type: ${resolvedTracks[0]?.__type__}`);
            }
            aniData.aniData = this.convertTracksToAniLayer(resolvedTracks, allObjects, fps);
        } else {
            console.warn(`[AnimationClipConversion] No tracks found or tracks is not an array`);
        }

        return aniData;
    }

    /**
     * 解析 Cocos 的引用结构（__id__ 引用）
     * Cocos 使用数组索引作为 __id__，但 __id__ 从 1 开始（0 是主对象）
     */
    private resolveReferences(refs: any[], allObjects: any[]): any[] {
        // 创建索引映射
        // Cocos 的 __id__ 对应数组索引，但 __id__ 从 1 开始
        // 例如：数组索引 0 对应 __id__ 1，数组索引 1 对应 __id__ 2
        const idMap = new Map<number, any>();
        
        allObjects.forEach((obj, index) => {
            if (obj && typeof obj === "object") {
                // 数组索引 + 1 对应 __id__
                const id = index + 1;
                idMap.set(id, obj);
                // 也支持直接使用数组索引
                idMap.set(index, obj);
                // 如果对象本身有 __id__，也映射
                if (obj.__id__ !== undefined) {
                    idMap.set(obj.__id__, obj);
                }
            }
        });
        
        // 解析引用
        return refs.map(ref => {
            if (ref && typeof ref === "object") {
                // 如果引用对象只有 __id__，通过 idMap 查找
                if (ref.__id__ !== undefined && Object.keys(ref).length === 1) {
                    const resolved = idMap.get(ref.__id__);
                    if (resolved) {
                        return resolved;
                    }
                }
                // 如果引用对象本身已经完整（有 __type__），直接返回
                if (ref.__type__) {
                    return ref;
                }
            }
            // 如果是字符串或其他类型，直接返回
            return ref;
        }).filter(t => t !== undefined && t !== null);
    }

    /**
     * 将 Cocos 的 tracks 数组转换为 TypeAniLayer 层级结构
     */
    private convertTracksToAniLayer(tracks: any[], allObjects: any[], fps: number): TypeAniLayer {
        const rootLayer: TypeAniLayer = {
            name: "",
            child: []
        };

        // 按路径和属性分组 tracks
        // 结构：path -> property -> component (x/y/z) -> keys
        const pathMap = new Map<string, Map<string, Map<string, TypeAniKeyData[]>>>();

        for (const track of tracks) {
            if (!track) {
                console.warn(`[AnimationClipConversion] Track is null or undefined`);
                continue;
            }
            if (track.__type__ !== "cc.animation.VectorTrack") {
                console.warn(`[AnimationClipConversion] Track type is ${track.__type__}, expected cc.animation.VectorTrack`);
                continue;
            }
            console.debug(`[AnimationClipConversion] Processing VectorTrack`);

            // 获取 binding 和 path
            let binding = track._binding;
            if (!binding) continue;

            // 解析 binding.path 引用
            let trackPath = binding.path;
            if (trackPath && trackPath.__id__ !== undefined) {
                trackPath = this.resolveReferences([trackPath], allObjects)[0];
            }
            if (!trackPath) continue;

            // 解析路径：_paths 数组可能包含：
            // 1. HierarchyPath 引用 + 属性名：[{__id__: 3}, "position"]
            // 2. 只有属性名（绑定到根节点）：["scale"]
            let paths = trackPath._paths || [];
            if (paths.length === 0) {
                console.warn(`[AnimationClipConversion] Empty paths array`);
                continue;
            }

            let nodePath = ""; // 空字符串表示根节点
            let propertyName = "";

            // 检查第一个元素是否是 HierarchyPath 引用
            const firstPath = paths[0];
            if (firstPath && typeof firstPath === "object" && firstPath.__id__ !== undefined) {
                // 情况1：有 HierarchyPath 引用
                let hierarchyPathRef = this.resolveReferences([firstPath], allObjects)[0];
                if (hierarchyPathRef && hierarchyPathRef.path) {
                    nodePath = hierarchyPathRef.path;
                    // 保留 "root/" 前缀，不删除
                }
                // 属性名是最后一个元素（应该是字符串）
                const lastPath = paths[paths.length - 1];
                if (typeof lastPath === "string") {
                    propertyName = lastPath;
                } else {
                    console.warn(`[AnimationClipConversion] Last path element is not a string:`, lastPath);
                    continue;
                }
            } else if (typeof firstPath === "string") {
                // 情况2：直接是属性名（绑定到根节点）
                propertyName = firstPath;
                nodePath = ""; // 根节点
            } else {
                console.warn(`[AnimationClipConversion] Unknown path format:`, paths);
                continue;
            }

            if (!propertyName) {
                console.warn(`[AnimationClipConversion] No property name found in paths:`, paths);
                continue;
            }

            console.debug(`[AnimationClipConversion] Node path: "${nodePath}", Property: "${propertyName}"`);

            // 获取 channels（每个 channel 对应一个组件，如 x, y, z）
            let channels = track._channels || [];
            // 解析 channel 引用
            channels = this.resolveReferences(channels, allObjects);
            
            // 根据属性类型确定组件名和数量
            // position 只有 x, y, z（没有 w）
            // scale 和 rotation 也只有 x, y, z
            let componentNames: string[] = [];
            let maxComponents = 3; // 默认最多3个组件
            
            if (propertyName === "position") {
                componentNames = ["x", "y", "z"];
                maxComponents = 3;
            } else if (propertyName === "scale") {
                componentNames = ["x", "y", "z"];
                maxComponents = 3;
            } else if (propertyName === "rotation" || propertyName === "eulerAngles") {
                componentNames = ["x", "y", "z"];
                maxComponents = 3;
            } else {
                // 其他属性使用默认的 x, y, z, w
                componentNames = ["x", "y", "z", "w"];
                maxComponents = 4;
            }

            for (let i = 0; i < channels.length && i < maxComponents; i++) {
                let channel = channels[i];
                if (!channel) continue;

                // 解析 curve 引用
                let curve = channel._curve;
                if (curve && curve.__id__ !== undefined) {
                    curve = this.resolveReferences([curve], allObjects)[0];
                }
                if (!curve) continue;
                const times = curve._times || [];
                const values = curve._values || [];

                if (times.length !== values.length) continue;

                const componentName = componentNames[i];

                // 初始化路径映射
                if (!pathMap.has(nodePath)) {
                    pathMap.set(nodePath, new Map());
                }
                const propMap = pathMap.get(nodePath)!;

                if (!propMap.has(propertyName)) {
                    propMap.set(propertyName, new Map());
                }
                const compMap = propMap.get(propertyName)!;

                if (!compMap.has(componentName)) {
                    compMap.set(componentName, []);
                }
                const keys = compMap.get(componentName)!;

                // 转换关键帧
                for (let j = 0; j < times.length; j++) {
                    const time = times[j];
                    const keyframeValue = values[j];
                    
                    if (!keyframeValue) continue;

                    const frame = Math.round(time * fps);
                    const value = keyframeValue.value ?? 0;

                    const keyData: TypeAniKeyData = {
                        f: frame,
                        val: value
                    };

                    // 添加 tweenInfo（只有当存在有效值时才添加）
                    const tweenInfo: TypeTweenInfo = {};
                    let hasTweenInfo = false;

                    // Tangent 值：只有当值不为 undefined、null 且不为 0 时才添加
                    if (keyframeValue.leftTangent !== undefined && keyframeValue.leftTangent !== null && keyframeValue.leftTangent !== 0) {
                        tweenInfo.inTangent = keyframeValue.leftTangent;
                        hasTweenInfo = true;
                    }
                    if (keyframeValue.rightTangent !== undefined && keyframeValue.rightTangent !== null && keyframeValue.rightTangent !== 0) {
                        tweenInfo.outTangent = keyframeValue.rightTangent;
                        hasTweenInfo = true;
                    }
                    // Weight 值：只有当值不为 undefined、null 且不为 1 时才添加
                    if (keyframeValue.leftTangentWeight !== undefined && keyframeValue.leftTangentWeight !== null && keyframeValue.leftTangentWeight !== 1) {
                        tweenInfo.inWeight = keyframeValue.leftTangentWeight;
                        hasTweenInfo = true;
                    }
                    if (keyframeValue.rightTangentWeight !== undefined && keyframeValue.rightTangentWeight !== null && keyframeValue.rightTangentWeight !== 1) {
                        tweenInfo.outWeight = keyframeValue.rightTangentWeight;
                        hasTweenInfo = true;
                    }

                    // 只有当 tweenInfo 有内容时才添加到 keyData
                    if (hasTweenInfo) {
                        keyData.tweenInfo = tweenInfo;
                    }

                    keys.push(keyData);
                }
            }
        }

        // 构建层级结构
        for (const [nodePath, propMap] of pathMap.entries()) {
            // nodePath 可能是空字符串（根节点）或 "root/xxx/yyy" 格式
            // 保留 "root" 节点，不删除
            const pathParts = nodePath ? nodePath.split("/").filter(p => p) : [];
            let currentLayer = rootLayer;

            // 创建路径节点
            for (const part of pathParts) {
                let childLayer = currentLayer.child?.find(c => c.name === part);
                if (!childLayer) {
                    childLayer = {
                        name: part,
                        child: []
                    };
                    if (!currentLayer.child) {
                        currentLayer.child = [];
                    }
                    currentLayer.child.push(childLayer);
                }
                currentLayer = childLayer;
            }

            // 添加属性节点
            if (!currentLayer.prop) {
                currentLayer.prop = [];
            }

            for (const [propertyName, compMap] of propMap.entries()) {
                // 映射 Cocos 属性名到 Laya 属性名
                let layaSubPropertyName: string | null = null;
                if (propertyName === "position") {
                    layaSubPropertyName = "localPosition";
                } else if (propertyName === "scale") {
                    layaSubPropertyName = "localScale";
                } else if (propertyName === "rotation" || propertyName === "eulerAngles") {
                    layaSubPropertyName = "localRotation";
                }

                // 如果属性是 transform 相关的，需要三层嵌套结构：transform -> localPosition/localScale/localRotation -> x/y/z
                if (layaSubPropertyName) {
                    // 1. 查找或创建 transform 节点
                    let transformProp = currentLayer.prop?.find(p => p.name === "transform");
                    if (!transformProp) {
                        transformProp = {
                            name: "transform",
                            prop: []
                        };
                        currentLayer.prop!.push(transformProp);
                    }
                    if (!transformProp.prop) {
                        transformProp.prop = [];
                    }

                    // 2. 查找或创建 localPosition/localScale/localRotation 节点
                    let subProp = transformProp.prop.find(p => p.name === layaSubPropertyName);
                    if (!subProp) {
                        subProp = {
                            name: layaSubPropertyName,
                            prop: []
                        };
                        transformProp.prop.push(subProp);
                    }
                    if (!subProp.prop) {
                        subProp.prop = [];
                    }

                    // 3. 添加组件节点（x, y, z）
                    for (const [componentName, keys] of compMap.entries()) {
                        // 按帧数排序
                        keys.sort((a, b) => a.f - b.f);

                        const propLayer: TypeAniLayer = {
                            name: componentName,
                            keys: keys
                        };

                        subProp.prop.push(propLayer);
                    }
                } else {
                    // 其他属性直接添加
                    for (const [componentName, keys] of compMap.entries()) {
                        // 按帧数排序
                        keys.sort((a, b) => a.f - b.f);

                        const propLayer: TypeAniLayer = {
                            name: componentName,
                            keys: keys
                        };

                        currentLayer.prop!.push(propLayer);
                    }
                }
            }
        }

        return rootLayer;
    }

    /**
     * 将 Cocos 关键帧转换为 TypeAniKeyData
     */
    private convertKeyframeToTypeAniKey(cocosKey: any, fps: number): TypeAniKeyData | null {
        if (!cocosKey || typeof cocosKey !== "object") {
            return null;
        }

        // 获取时间（秒）并转换为帧数
        const time = cocosKey.time ?? cocosKey._time ?? 0;
        const frame = Math.round(time * fps);

        // 获取值
        const value = this.convertValue(cocosKey.value ?? cocosKey._value ?? cocosKey.val ?? 0);

        const keyData: TypeAniKeyData = {
            f: frame,
            val: value
        };

        // 添加补间信息
        if (cocosKey.tweenType || cocosKey._tweenType) {
            keyData.tweenType = cocosKey.tweenType || cocosKey._tweenType;
        }

        // 添加 tweenInfo（只有当存在有效值时才添加）
        const tweenInfo: TypeTweenInfo = {};
        let hasTweenInfo = false;

        // Tangent 值：只有当值不为 undefined、null 且不为 0 时才添加
        const inTangent = cocosKey.inTangent ?? cocosKey._inTangent;
        if (inTangent !== undefined && inTangent !== null && inTangent !== 0) {
            tweenInfo.inTangent = inTangent;
            hasTweenInfo = true;
        }
        const outTangent = cocosKey.outTangent ?? cocosKey._outTangent;
        if (outTangent !== undefined && outTangent !== null && outTangent !== 0) {
            tweenInfo.outTangent = outTangent;
            hasTweenInfo = true;
        }
        // Weight 值：只有当值不为 undefined、null 且不为 1 时才添加
        const inWeight = cocosKey.inWeight ?? cocosKey._inWeight;
        if (inWeight !== undefined && inWeight !== null && inWeight !== 1) {
            tweenInfo.inWeight = inWeight;
            hasTweenInfo = true;
        }
        const outWeight = cocosKey.outWeight ?? cocosKey._outWeight;
        if (outWeight !== undefined && outWeight !== null && outWeight !== 1) {
            tweenInfo.outWeight = outWeight;
            hasTweenInfo = true;
        }

        // 只有当 tweenInfo 有内容时才添加到 keyData
        if (hasTweenInfo) {
            keyData.tweenInfo = tweenInfo;
        }

        // 添加扩展数据
        if (cocosKey.extend || cocosKey._extend) {
            keyData.extend = cocosKey.extend || cocosKey._extend;
        }

        return keyData;
    }

    /**
     * 创建空的 TypeAniData（用于错误处理）
     */
    private createEmptyTypeAniData(): TypeAniData {
        return {
            fps: 30,
            loop: false,
            totalFrame: 0,
            is3D: true,
            event: [],
            aniData: {
                name: "",
                child: []
            },
            propType: {}
        };
    }



    /**
     * 转换值（处理数组和对象）
     */
    private convertValue(value: any): any {
        if (Array.isArray(value)) {
            // 如果是数组，直接返回
            return value;
        } else if (typeof value === "object" && value !== null) {
            // 如果是对象，可能需要转换结构
            // 例如：Cocos 的 {x, y, z} -> Laya 的 [x, y, z]
            if (value.x !== undefined || value.y !== undefined || value.z !== undefined) {
                return [
                    value.x || 0,
                    value.y || 0,
                    value.z || 0,
                    value.w || 0
                ].filter((v, i) => i < 3 || v !== 0); // 如果是 vec3，去掉 w
            }
            return value;
        }
        return value;
    }

}

