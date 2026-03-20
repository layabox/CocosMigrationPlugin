import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import AnimationClipUtil from "../utils/AnimationClipUtil";
import { AnimationClipWriter } from "../utils/AnimationClipWriter";
import { AnimationClip2DWriter } from "../utils/AnimationClip2DWriter";
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

            if (layaAnimData.is3D === false) {
                // 2D 动画：生成 .mc 文件
                targetPath = targetPath.replace(/\.anim$/i, '.mc');
                const clip2D = this.aniDataToAnimationClip2D(layaAnimData);
                const buffer = AnimationClip2DWriter.write(clip2D);
                fs.writeFileSync(targetPath, new Uint8Array(buffer));
            } else {
                // 3D 动画：生成 .lani 文件
                targetPath = targetPath.replace(/\.anim$/i, '.lani');
                const clip = AnimationClipUtil.aniDataToAnimationClip(layaAnimData);
                const buffer = AnimationClipWriter.write(clip);
                fs.writeFileSync(targetPath, new Uint8Array(buffer));
            }

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

        // propType 映射：告诉 AnimationClipUtil 哪些属性路径是向量类型
        // DataType: Float=0, Vector2=5, Vector3=6, Vector4=7, Color=8
        const propType: Record<string, number> = {
            "transform.localPosition": 6,  // DataType.Vector3
            "transform.localScale": 6,     // DataType.Vector3
            "transform.localRotation": 7,  // DataType.Vector4
            "transform.localRotationEuler": 6,  // DataType.Vector3
        };

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
            propType: propType
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

            // 检测是否包含 2D 特有的 track 类型
            const has2DTracks = resolvedTracks.some((t: any) =>
                t?.__type__ === "cc.animation.ColorTrack" ||
                t?.__type__ === "cc.animation.RealTrack" ||
                t?.__type__ === "cc.animation.SizeTrack"
            );
            // 检测是否有 ComponentPath（2D 组件动画的标志）
            const hasComponentPath = resolvedTracks.some((t: any) => {
                const paths = t?._binding?.path?._paths || t?._binding?.path;
                if (!paths) return false;
                const resolvedPaths = Array.isArray(paths) ? paths : (paths._paths || []);
                return resolvedPaths.some((p: any) => {
                    if (p && typeof p === "object" && p.__id__ !== undefined) {
                        const resolved = allObjects[p.__id__];
                        return resolved?.__type__ === "cc.animation.ComponentPath";
                    }
                    return p?.__type__ === "cc.animation.ComponentPath";
                });
            });

            if (has2DTracks || hasComponentPath) {
                aniData.is3D = false;
                console.debug(`[AnimationClipConversion] Detected 2D animation`);
            }

            // 动态添加 propType 映射
            for (const t of resolvedTracks) {
                const pathInfo = this.parseTrackBindingPath(t, allObjects);
                if (!pathInfo) continue;
                const groupKey = this.buildGroupKey(t.__type__ || "", pathInfo.componentPath, pathInfo.propertyName);

                // ColorTrack → Color type (DataType.Color = 8)
                if (t.__type__ === "cc.animation.ColorTrack") {
                    if (pathInfo.componentPath === "cc.Sprite") {
                        propType["_Sprite.color"] = 8; // DataType.Color
                    } else if (pathInfo.componentPath === "cc.Label") {
                        propType["_Text.color"] = 8; // DataType.Color
                    }
                }
                // SizeTrack → Vector2 type (DataType.Vector2 = 5)
                // contentSize maps to width/height directly, handled as floats
            }

            aniData.aniData = this.convertTracksToAniLayer(resolvedTracks, allObjects, fps, aniData.is3D === false);
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
     * 支持 VectorTrack, ColorTrack, RealTrack, SizeTrack
     */
    private convertTracksToAniLayer(tracks: any[], allObjects: any[], fps: number, is2D: boolean = false): TypeAniLayer {
        const rootLayer: TypeAniLayer = {
            name: "",
            child: []
        };

        // 按路径和属性分组 tracks
        // 结构：nodePath -> groupKey -> componentName -> keys
        const pathMap = new Map<string, Map<string, Map<string, TypeAniKeyData[]>>>();

        for (const track of tracks) {
            if (!track) continue;

            const trackType: string = track.__type__ || "";

            // 解析 binding path（通用逻辑，支持所有 track 类型）
            const pathInfo = this.parseTrackBindingPath(track, allObjects);
            if (!pathInfo) continue;

            const { nodePath, componentPath, propertyName } = pathInfo;
            console.debug(`[AnimationClipConversion] Processing ${trackType}: node="${nodePath}", component="${componentPath}", prop="${propertyName}"`);

            // 根据 track 类型提取 channels 和组件名
            let channelEntries: Array<{ name: string, channel: any }> = [];

            switch (trackType) {
                case "cc.animation.VectorTrack": {
                    const channels = this.resolveReferences(track._channels || [], allObjects);
                    const names = this.getVectorComponentNames(propertyName);
                    for (let i = 0; i < channels.length && i < names.length; i++) {
                        channelEntries.push({ name: names[i], channel: channels[i] });
                    }
                    break;
                }
                case "cc.animation.ColorTrack": {
                    const channels = this.resolveReferences(track._channels || [], allObjects);
                    const names = ["r", "g", "b", "a"];
                    for (let i = 0; i < channels.length && i < names.length; i++) {
                        channelEntries.push({ name: names[i], channel: channels[i] });
                    }
                    break;
                }
                case "cc.animation.SizeTrack": {
                    const channels = this.resolveReferences(track._channels || [], allObjects);
                    const names = ["width", "height"];
                    for (let i = 0; i < channels.length && i < names.length; i++) {
                        channelEntries.push({ name: names[i], channel: channels[i] });
                    }
                    break;
                }
                case "cc.animation.RealTrack": {
                    // RealTrack 使用 _channel（单数）而非 _channels
                    let channel = track._channel;
                    if (channel && channel.__id__ !== undefined) {
                        channel = this.resolveReferences([channel], allObjects)[0];
                    }
                    if (channel) {
                        channelEntries.push({ name: propertyName, channel });
                    }
                    break;
                }
                default:
                    console.warn(`[AnimationClipConversion] Unsupported track type: ${trackType}`);
                    continue;
            }

            // 确定 groupKey（用于分组和后续的属性路径映射）
            const groupKey = this.buildGroupKey(trackType, componentPath, propertyName);

            // 提取每个 channel 的关键帧
            for (const entry of channelEntries) {
                const keys = this.extractChannelKeyframes(entry.channel, allObjects, fps);
                if (keys.length === 0) continue;

                if (!pathMap.has(nodePath)) pathMap.set(nodePath, new Map());
                const propMap = pathMap.get(nodePath)!;
                if (!propMap.has(groupKey)) propMap.set(groupKey, new Map());
                const compMap = propMap.get(groupKey)!;
                if (!compMap.has(entry.name)) compMap.set(entry.name, []);
                compMap.get(entry.name)!.push(...keys);
            }
        }

        // 构建层级结构
        for (const [nodePath, propMap] of pathMap.entries()) {
            const pathParts = nodePath ? nodePath.split("/").filter(p => p) : [];
            let currentLayer = rootLayer;

            // 创建路径节点
            for (const part of pathParts) {
                let childLayer = currentLayer.child?.find(c => c.name === part);
                if (!childLayer) {
                    childLayer = { name: part, child: [] };
                    if (!currentLayer.child) currentLayer.child = [];
                    currentLayer.child.push(childLayer);
                }
                currentLayer = childLayer;
            }

            if (!currentLayer.prop) currentLayer.prop = [];

            for (const [groupKey, compMap] of propMap.entries()) {
                this.buildPropertyTree(currentLayer, groupKey, compMap, is2D);
            }
        }

        return rootLayer;
    }

    /**
     * 解析 track 的 binding path，提取 nodePath、componentPath、propertyName
     */
    private parseTrackBindingPath(track: any, allObjects: any[]): { nodePath: string, componentPath: string, propertyName: string } | null {
        let binding = track._binding;
        if (!binding) return null;

        let trackPath = binding.path;
        if (trackPath && trackPath.__id__ !== undefined) {
            trackPath = this.resolveReferences([trackPath], allObjects)[0];
        }
        if (!trackPath) return null;

        const paths = trackPath._paths || [];
        if (paths.length === 0) return null;

        let nodePath = "";
        let componentPath = "";
        let propertyName = "";

        // 解析所有 path 元素
        for (const p of paths) {
            if (typeof p === "string") {
                propertyName = p;
            } else if (p && typeof p === "object") {
                let resolved = p;
                if (p.__id__ !== undefined) {
                    resolved = this.resolveReferences([p], allObjects)[0];
                }
                if (!resolved) continue;

                if (resolved.__type__ === "cc.animation.HierarchyPath") {
                    nodePath = resolved.path || "";
                    // "/" 表示当前节点（根节点），规范化为空字符串
                    if (nodePath === "/") nodePath = "";
                } else if (resolved.__type__ === "cc.animation.ComponentPath") {
                    componentPath = resolved.component || "";
                }
            }
        }

        if (!propertyName) return null;
        return { nodePath, componentPath, propertyName };
    }

    /**
     * 获取 VectorTrack 的分量名
     */
    private getVectorComponentNames(propertyName: string): string[] {
        if (propertyName === "rotation") return ["x", "y", "z", "w"];
        return ["x", "y", "z"]; // position, scale, eulerAngles, etc.
    }

    /**
     * 构建 groupKey：用于在 pathMap 中分组以及后续映射到 Laya 属性路径
     * 格式：
     *   - 无组件路径（transform属性）："position", "scale", "rotation", "eulerAngles"
     *   - 有组件路径："cc.Widget:top", "cc.Sprite:color", "cc.UITransform:contentSize"
     */
    private buildGroupKey(trackType: string, componentPath: string, propertyName: string): string {
        if (componentPath) {
            return `${componentPath}:${propertyName}`;
        }
        return propertyName;
    }

    /**
     * 从 channel 中提取关键帧数据
     */
    private extractChannelKeyframes(channel: any, allObjects: any[], fps: number): TypeAniKeyData[] {
        if (!channel) return [];

        let curve = channel._curve;
        if (curve && curve.__id__ !== undefined) {
            curve = this.resolveReferences([curve], allObjects)[0];
        }
        if (!curve) return [];

        const times = curve._times || [];
        const values = curve._values || [];
        if (times.length !== values.length) return [];

        const keys: TypeAniKeyData[] = [];

        for (let j = 0; j < times.length; j++) {
            const time = times[j];
            const keyframeValue = values[j];
            if (!keyframeValue) continue;

            const frame = Math.round(time * fps);
            const value = keyframeValue.value ?? 0;

            const keyData: TypeAniKeyData = { f: frame, val: value };

            // 添加 tweenInfo
            const tweenInfo: TypeTweenInfo = {};
            let hasTweenInfo = false;

            if (keyframeValue.leftTangent !== undefined && keyframeValue.leftTangent !== null && keyframeValue.leftTangent !== 0) {
                tweenInfo.inTangent = keyframeValue.leftTangent;
                hasTweenInfo = true;
            }
            if (keyframeValue.rightTangent !== undefined && keyframeValue.rightTangent !== null && keyframeValue.rightTangent !== 0) {
                tweenInfo.outTangent = keyframeValue.rightTangent;
                hasTweenInfo = true;
            }
            if (keyframeValue.leftTangentWeight !== undefined && keyframeValue.leftTangentWeight !== null && keyframeValue.leftTangentWeight !== 1) {
                tweenInfo.inWeight = keyframeValue.leftTangentWeight;
                hasTweenInfo = true;
            }
            if (keyframeValue.rightTangentWeight !== undefined && keyframeValue.rightTangentWeight !== null && keyframeValue.rightTangentWeight !== 1) {
                tweenInfo.outWeight = keyframeValue.rightTangentWeight;
                hasTweenInfo = true;
            }

            if (hasTweenInfo) {
                keyData.tweenInfo = tweenInfo;
            }

            keys.push(keyData);
        }

        return keys;
    }

    /**
     * 根据 groupKey 将分量数据添加到属性树中
     *
     * 3D 模式 Cocos → Laya 属性路径映射：
     *   position → transform.localPosition.x/y/z
     *   scale → transform.localScale.x/y/z
     *   rotation → transform.localRotation.x/y/z/w
     *   eulerAngles → transform.localRotationEuler.x/y/z
     *
     * 2D 模式 Cocos → Laya 属性路径映射：
     *   position → x, y (平铺属性)
     *   scale → scaleX, scaleY (平铺属性)
     *   rotation/eulerAngles → rotation (仅 z 分量)
     *   cc.Sprite:color → color(合并rgb为"#rrggbb"字符串) + alpha(a通道 0-255→0-1)
     *   cc.Label:color → color(合并rgb为"#rrggbb"字符串) + alpha(a通道 0-255→0-1)
     *   cc.Widget:top → y（height=0时等价）, cc.Widget:left → x（width=0时等价）
     *   cc.Widget:bottom → y（designHeight - bottom）, cc.Widget:right → x（designWidth - right）
     *   cc.UIOpacity:opacity → alpha
     *   cc.UITransform:contentSize → width/height
     */
    private buildPropertyTree(currentLayer: TypeAniLayer, groupKey: string, compMap: Map<string, TypeAniKeyData[]>, is2D: boolean = false): void {
        // 1. Transform 属性（无组件路径）
        const transformKeys = ["position", "scale", "rotation", "eulerAngles"];

        if (transformKeys.includes(groupKey)) {
            if (is2D) {
                // ========== 2D 模式：平铺属性 ==========
                this.buildPropertyTree2DTransform(currentLayer, groupKey, compMap);
            } else {
                // ========== 3D 模式：transform.localXxx.x/y/z ==========
                const transformMap: Record<string, string> = {
                    "position": "localPosition",
                    "scale": "localScale",
                    "rotation": "localRotation",
                    "eulerAngles": "localRotationEuler",
                };
                const layaSubName = transformMap[groupKey];

                let transformProp = currentLayer.prop?.find(p => p.name === "transform");
                if (!transformProp) {
                    transformProp = { name: "transform", prop: [] };
                    currentLayer.prop!.push(transformProp);
                }
                if (!transformProp.prop) transformProp.prop = [];

                let subProp = transformProp.prop.find(p => p.name === layaSubName);
                if (!subProp) {
                    subProp = { name: layaSubName, prop: [] };
                    transformProp.prop.push(subProp);
                }
                if (!subProp.prop) subProp.prop = [];

                for (const [compName, keys] of compMap.entries()) {
                    keys.sort((a, b) => a.f - b.f);
                    subProp.prop.push({ name: compName, keys });
                }
            }
            return;
        }

        // 2. 组件属性（带 ComponentPath）
        if (groupKey.includes(":")) {
            const [cocosComponent, propName] = groupKey.split(":");

            // 映射 Cocos 组件名到 Laya 组件名
            // 2D 模式：GWidget 节点自身有 top/bottom/left/right 属性（不需要组件）
            //         Image/Text 在 Laya 中是节点类型（不是组件），属性直接访问
            // 3D 模式：使用内部属性名（_Sprite, _Text, _Widget）
            const componentMap: Record<string, string> = is2D ? {
                "cc.Sprite": "",      // 2D 中 Image 是节点本身，属性直接访问
                "cc.Label": "",       // 2D 中 Text 是节点本身，属性直接访问
                "cc.Widget": "",      // 2D 中 GWidget 节点自身有 top/bottom/left/right
                "cc.UIOpacity": "",
                "cc.UITransform": "",
            } : {
                "cc.Sprite": "_Sprite",
                "cc.Label": "_Text",
                "cc.Widget": "_Widget",
                "cc.UIOpacity": "",
                "cc.UITransform": "",
            };

            const layaComponent = componentMap[cocosComponent];

            // 特殊处理：cc.UITransform.contentSize → 直接映射到 width/height
            if (cocosComponent === "cc.UITransform" && propName === "contentSize") {
                for (const [compName, keys] of compMap.entries()) {
                    keys.sort((a, b) => a.f - b.f);
                    currentLayer.prop!.push({ name: compName, keys }); // "width" / "height"
                }
                return;
            }

            // 特殊处理：cc.UIOpacity.opacity → alpha
            if (cocosComponent === "cc.UIOpacity" && propName === "opacity") {
                for (const [, keys] of compMap.entries()) {
                    keys.sort((a, b) => a.f - b.f);
                    // opacity (0-255) → alpha (0-1) 转换
                    const alphaKeys = keys.map(k => ({
                        ...k,
                        val: typeof k.val === "number" ? k.val / 255 : k.val
                    }));
                    currentLayer.prop!.push({ name: "alpha", keys: alphaKeys });
                }
                return;
            }

            // 特殊处理：2D 模式下 ColorTrack (color 属性)
            // Laya 2D 的 color 是字符串 "#rrggbb"，不支持 .r/.g/.b/.a 分量动画
            // 需要将 r/g/b 合并为 color 字符串，a 通道映射为 alpha
            if (is2D && propName === "color" && (cocosComponent === "cc.Sprite" || cocosComponent === "cc.Label")) {
                this.buildColorAnimation2D(currentLayer, compMap);
                return;
            }

            // 特殊处理：2D 模式下 cc.Widget.top/bottom/left/right → 直接映射为节点位置属性
            // GWidget 的 top/left 是计算属性(getter/setter)，IDE 不识别为可动画化属性
            // top → y（当 height=0 时 top=y，直接等价）
            // bottom → y（y = designHeight - bottom）
            // left → x（当 width=0 时 left=x，直接等价）
            // right → x（x = designWidth - right）
            if (is2D && cocosComponent === "cc.Widget") {
                if (propName === "top") {
                    // top → y：对于 height=0 的节点完全等价
                    for (const [, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        currentLayer.prop!.push({ name: "y", keys });
                    }
                    return;
                }
                if (propName === "left") {
                    // left → x：对于 width=0 的节点完全等价
                    for (const [, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        currentLayer.prop!.push({ name: "x", keys });
                    }
                    return;
                }
                if (propName === "bottom") {
                    // bottom → y：y = designHeight - bottom
                    const designH = this.owner.projectConfig?.general?.designResolution?.height || 960;
                    for (const [, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        const yKeys = keys.map(k => ({
                            ...k,
                            val: typeof k.val === "number" ? designH - k.val : k.val
                        }));
                        currentLayer.prop!.push({ name: "y", keys: yKeys });
                    }
                    return;
                }
                if (propName === "right") {
                    // right → x：x = designWidth - right
                    const designW = this.owner.projectConfig?.general?.designResolution?.width || 640;
                    for (const [, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        const xKeys = keys.map(k => ({
                            ...k,
                            val: typeof k.val === "number" ? designW - k.val : k.val
                        }));
                        currentLayer.prop!.push({ name: "x", keys: xKeys });
                    }
                    return;
                }
            }

            if (layaComponent !== undefined && layaComponent !== "") {
                // 有 Laya 组件映射：创建 组件 → 属性 → 分量 结构
                let compProp = currentLayer.prop?.find(p => p.name === layaComponent);
                if (!compProp) {
                    compProp = { name: layaComponent, prop: [] };
                    currentLayer.prop!.push(compProp);
                }
                if (!compProp.prop) compProp.prop = [];

                // ColorTrack 有多个分量（r/g/b/a），需要嵌套
                if (compMap.size > 1) {
                    // 多分量属性（如 color.r/g/b/a）
                    let subProp = compProp.prop.find(p => p.name === propName);
                    if (!subProp) {
                        subProp = { name: propName, prop: [] };
                        compProp.prop.push(subProp);
                    }
                    if (!subProp.prop) subProp.prop = [];

                    for (const [compName, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        subProp.prop.push({ name: compName, keys });
                    }
                } else {
                    // 单值属性（如 Widget.top）— RealTrack
                    for (const [, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        compProp.prop.push({ name: propName, keys });
                    }
                }
            } else {
                // 无 Laya 组件映射：直接放到节点上
                if (compMap.size > 1) {
                    let subProp: TypeAniLayer = { name: propName, prop: [] };
                    currentLayer.prop!.push(subProp);
                    for (const [compName, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        subProp.prop!.push({ name: compName, keys });
                    }
                } else {
                    for (const [compName, keys] of compMap.entries()) {
                        keys.sort((a, b) => a.f - b.f);
                        currentLayer.prop!.push({ name: compName, keys });
                    }
                }
            }
            return;
        }

        // 3. 其他属性（无组件路径，非 transform）
        for (const [compName, keys] of compMap.entries()) {
            keys.sort((a, b) => a.f - b.f);
            currentLayer.prop!.push({ name: compName, keys });
        }
    }

    /**
     * 2D 模式下 transform 属性映射为平铺属性
     * position.x/y → x, y
     * scale.x/y → scaleX, scaleY
     * rotation.z / eulerAngles.z → rotation
     */
    private buildPropertyTree2DTransform(currentLayer: TypeAniLayer, groupKey: string, compMap: Map<string, TypeAniKeyData[]>): void {
        if (!currentLayer.prop) currentLayer.prop = [];

        switch (groupKey) {
            case "position": {
                // x, y 直接作为节点属性
                for (const [compName, keys] of compMap.entries()) {
                    if (compName === "x" || compName === "y") {
                        keys.sort((a, b) => a.f - b.f);
                        currentLayer.prop.push({ name: compName, keys });
                    }
                    // z 分量在 2D 中忽略
                }
                break;
            }
            case "scale": {
                // x → scaleX, y → scaleY
                for (const [compName, keys] of compMap.entries()) {
                    keys.sort((a, b) => a.f - b.f);
                    if (compName === "x") {
                        currentLayer.prop.push({ name: "scaleX", keys });
                    } else if (compName === "y") {
                        currentLayer.prop.push({ name: "scaleY", keys });
                    }
                    // z 分量在 2D 中忽略
                }
                break;
            }
            case "rotation":
            case "eulerAngles": {
                // 仅取 z 分量作为 rotation（角度）
                const zKeys = compMap.get("z");
                if (zKeys) {
                    zKeys.sort((a, b) => a.f - b.f);
                    currentLayer.prop.push({ name: "rotation", keys: zKeys });
                }
                break;
            }
        }
    }

    /**
     * 2D 模式下将 ColorTrack 的 r/g/b/a 分量合并为 Laya 兼容格式
     * - r/g/b 合并为 color 属性（"#rrggbb" 字符串格式）
     * - a 通道单独映射为 alpha 属性（0-255 → 0-1）
     *
     * Laya 2D 节点的 color 是字符串类型（如 "#ffffff"），不支持 .r/.g/.b 分量动画
     */
    private buildColorAnimation2D(currentLayer: TypeAniLayer, compMap: Map<string, TypeAniKeyData[]>): void {
        if (!currentLayer.prop) currentLayer.prop = [];

        const rKeys = compMap.get("r") || [];
        const gKeys = compMap.get("g") || [];
        const bKeys = compMap.get("b") || [];
        const aKeys = compMap.get("a") || [];

        // 处理 alpha 通道 → 映射为独立的 alpha 属性
        if (aKeys.length > 0) {
            const sortedAKeys = [...aKeys].sort((a, b) => a.f - b.f);
            const alphaKeys: TypeAniKeyData[] = sortedAKeys.map(k => ({
                ...k,
                val: typeof k.val === "number" ? k.val / 255 : k.val
            }));
            currentLayer.prop.push({ name: "alpha", keys: alphaKeys });
        }

        // r/g/b 通道在 Laya 2D 中无法单独动画化（color 是字符串 "#rrggbb"），直接跳过
        if (rKeys.length > 0 || gKeys.length > 0 || bKeys.length > 0) {
            console.debug("[AnimationClipConversion] Skipping r/g/b color channels for 2D (Laya color is string)");
        }
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
     * 将 TypeAniData 转换为 Laya AnimationClip2D（2D 动画）
     * 2D 使用 KeyframeNode2D + Keyframe2D，帧数据直接存储 TypeAniKey
     */
    private aniDataToAnimationClip2D(data: TypeAniData): Laya.AnimationClip2D {
        const clip = new Laya.AnimationClip2D();
        const fps = data.fps || 30;
        clip._frameRate = fps;
        clip.islooping = data.loop || false;
        clip._duration = (data.totalFrame || 0) / fps;

        // 转换事件
        if (data.event && data.event.length > 0) {
            for (const evt of data.event) {
                const event = new Laya.Animation2DEvent();
                event.time = Math.min(evt.time, clip._duration);
                event.eventName = evt.eventName || "";
                event.params = evt.params || [];
                clip.addEvent(event);
            }
        }

        // 收集所有 KeyframeNode2D
        const nodesDic: Record<string, Laya.KeyframeNode2D> = {};
        const nodesMap: Record<string, Laya.KeyframeNode2D[]> = {};

        if (data.aniData) {
            // ownerPath 必须以 "" 开头（根节点占位符，Animator2D 解析时跳过）
            this.collectKeyframeNodes2D(data.aniData, [""], [], nodesDic, nodesMap, fps);
        }

        // 填充 clip._nodes
        clip._nodesDic = nodesDic;
        clip._nodesMap = nodesMap;
        const nodeKeys = Object.keys(nodesDic);
        const nodeList = new Laya.KeyframeNodeList2D();
        nodeList.count = nodeKeys.length;
        for (let i = 0; i < nodeKeys.length; i++) {
            const node = nodesDic[nodeKeys[i]];
            node._indexInList = i;
            nodeList.setNodeByIndex(i, node);
        }
        clip._nodes = nodeList;

        return clip;
    }

    /**
     * 递归收集 2D 关键帧节点
     */
    private collectKeyframeNodes2D(
        layer: TypeAniLayer,
        ownerPaths: string[],
        propNames: string[],
        nodesDic: Record<string, Laya.KeyframeNode2D>,
        nodesMap: Record<string, Laya.KeyframeNode2D[]>,
        fps: number
    ): void {
        // 构建当前 owner 路径
        const currentOwnerPaths = layer.name.length > 0
            ? ownerPaths.concat(layer.name)
            : ownerPaths.concat();

        const targetPath = currentOwnerPaths.join("/");

        // 处理 prop（属性关键帧）
        if (layer.prop) {
            const keyFrameNodes: Laya.KeyframeNode2D[] = [];
            this.processProps2D(layer.prop, currentOwnerPaths, [], nodesDic, keyFrameNodes, fps);
            if (keyFrameNodes.length > 0) {
                nodesMap[targetPath] = keyFrameNodes;
            }
        }

        // 递归处理子节点
        if (layer.child) {
            for (const child of layer.child) {
                this.collectKeyframeNodes2D(child, currentOwnerPaths, [], nodesDic, nodesMap, fps);
            }
        }
    }

    /**
     * 递归处理属性并创建 2D 关键帧节点
     */
    private processProps2D(
        props: TypeAniLayer[],
        ownerPaths: string[],
        propNames: string[],
        nodesDic: Record<string, Laya.KeyframeNode2D>,
        keyFrameNodes: Laya.KeyframeNode2D[],
        fps: number
    ): void {
        for (const prop of props) {
            if (prop.keys) {
                // 叶节点：有关键帧数据
                const node = new Laya.KeyframeNode2D();

                // 设置 ownerPath
                node._setOwnerPathCount(ownerPaths.length);
                for (let i = 0; i < ownerPaths.length; i++) {
                    node._setOwnerPathByIndex(i, ownerPaths[i]);
                }

                // 设置 property 路径
                const fullPropNames = propNames.concat(prop.name);
                node._setPropertyCount(fullPropNames.length);
                for (let i = 0; i < fullPropNames.length; i++) {
                    node._setPropertyByIndex(i, fullPropNames[i]);
                }

                // 设置路径字符串
                const nodePath = node._joinOwnerPath("/");
                const propertyPath = node._joinProperty(".");
                node.fullPath = nodePath + (propertyPath ? "." + propertyPath : "");
                node.nodePath = nodePath;

                // 设置关键帧
                const sortedKeys = [...prop.keys].sort((a, b) => a.f - b.f);
                node._setKeyframeCount(sortedKeys.length);
                for (let i = 0; i < sortedKeys.length; i++) {
                    const keyData = sortedKeys[i];
                    const kf = new Laya.Keyframe2D();
                    kf.time = keyData.f / fps; // 帧转秒
                    kf.data = {
                        f: keyData.f,
                        val: keyData.val,
                        tweenType: keyData.tweenType,
                        tweenInfo: keyData.tweenInfo ? {
                            outTangent: keyData.tweenInfo.outTangent,
                            outWeight: keyData.tweenInfo.outWeight,
                            inTangent: keyData.tweenInfo.inTangent,
                            inWeight: keyData.tweenInfo.inWeight,
                        } : undefined,
                        extend: keyData.extend,
                    } as Laya.TypeAniKey;
                    node._keyFrames[i] = kf;
                }

                nodesDic[node.fullPath] = node;
                keyFrameNodes.push(node);
            } else if (prop.prop) {
                // 中间节点：继续递归
                this.processProps2D(prop.prop, ownerPaths, propNames.concat(prop.name), nodesDic, keyFrameNodes, fps);
            }
        }
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

