import { registerComponentParser } from "../ComponentParserRegistry";

/**
 * Cocos cc.ParticleSystem → LayaAir ShurikenParticleRenderer + ShurikenParticleSystem
 *
 * 节点类型保持 Sprite3D，添加 ShurikenParticleRenderer 组件，
 * 其中 _particleSystem 字段包含 ShurikenParticleSystem 序列化数据。
 */
registerComponentParser("cc.ParticleSystem", ({ conversion, node, data, isOverride }) => {
    if (!data) return;

    const elements = (conversion as any).elements as any[];
    const resolve = (v: any): any => {
        if (v && typeof v === "object" && "__id__" in v && elements)
            return elements[v.__id__];
        return v;
    };

    // 确保节点类型
    if (!Array.isArray(node._$comp)) node._$comp = [];
    if (node._$type !== "Sprite3D" && node._$type !== "Scene3D")
        node._$type = "Sprite3D";

    // ─── 解析 Cocos 数据 ───
    const startColor = resolve(data.startColor);
    const startSizeX = resolve(data.startSizeX) ?? resolve(data.startSize);
    const startSizeY = resolve(data.startSizeY);
    const startSizeZ = resolve(data.startSizeZ);
    const startSpeed = resolve(data.startSpeed);
    const startLifetime = resolve(data.startLifetime);
    const startDelay = resolve(data.startDelay);
    const startRotationX = resolve(data.startRotationX);
    const startRotationY = resolve(data.startRotationY);
    const startRotationZ = resolve(data.startRotationZ);
    const gravityMod = resolve(data.gravityModifier);
    const rateOverTime = resolve(data.rateOverTime);
    const rateOverDistance = resolve(data.rateOverDistance);
    const renderer = resolve(data.renderer);
    const colorMod = resolve(data._colorOverLifetimeModule);
    const shapeMod = resolve(data._shapeModule);
    const sizeMod = resolve(data._sizeOvertimeModule);
    const rotMod = resolve(data._rotationOvertimeModule);
    const velMod = resolve(data._velocityOvertimeModule);
    const texAnimMod = resolve(data._textureAnimationModule);

    // ─── 构建 ShurikenParticleSystem ───
    const ps: any = {};

    // 基础属性
    ps.duration = data.duration ?? 5;
    ps.looping = data.loop ?? true;
    ps.playOnAwake = data.playOnAwake ?? true;
    ps.simulationSpeed = data.simulationSpeed ?? 1;
    ps.maxParticles = data._capacity ?? 100;
    ps.autoRandomSeed = true;

    // 模拟空间：Cocos 和 LayaAir 值相同（0=World, 1=Local），直接传递
    ps.simulationSpace = data._simulationSpace ?? 1; // 默认 Local=1

    // 缩放模式：Cocos scaleSpace 1=Local → LayaAir scaleMode 1=Local
    ps.scaleMode = data.scaleSpace ?? 1;

    // 重力
    ps.gravityModifier = readCurveConstant(gravityMod);

    // ─── 开始延迟 ───
    convertStartDelay(ps, startDelay);

    // ─── 开始生命周期 ───
    convertStartLifetime(ps, startLifetime);

    // ─── 开始速度 ───
    convertStartSpeed(ps, startSpeed);

    // ─── 开始大小 ───
    convertStartSize(ps, data.startSize3D, startSizeX, startSizeY, startSizeZ);

    // ─── 开始旋转 ───
    convertStartRotation(ps, data.startRotation3D, startRotationX, startRotationY, startRotationZ);

    // ─── 开始颜色 ───
    convertStartColor(ps, startColor, resolve);

    // ─── Emission ───
    ps.emission = {
        enable: true,
        emissionRate: readCurveConstant(rateOverTime, 10),
        emissionRateOverDistance: readCurveConstant(rateOverDistance, 0),
    };
    // Bursts
    const bursts = data.bursts;
    if (Array.isArray(bursts) && bursts.length > 0) {
        const layaBursts: any[] = [];
        for (const b of bursts) {
            const burst = resolve(b);
            if (!burst) continue;
            const count = resolve(burst._count);
            layaBursts.push({
                _$type: "Burst",
                _time: burst._time ?? 0,
                _minCount: count?.constantMin ?? count?.constant ?? 5,
                _maxCount: count?.constantMax ?? count?.constant ?? 5,
            });
        }
        if (layaBursts.length > 0)
            ps.emission._bursts = layaBursts;
    }

    // ─── Shape ───
    if (shapeMod) {
        const shapeEnabled = shapeMod._enable ?? true;
        const shape = convertShape(shapeMod, resolve);
        if (shape) {
            shape.enable = shapeEnabled;
            ps.shape = shape;
        }

        // 发射方向已通过节点旋转 180°Y 补偿（Cocos -Z → LayaAir +Z）
    }

    // ─── ColorOverLifetime ───
    if (colorMod && colorMod._enable) {
        const colGrad = convertColorOverLifetime(colorMod, resolve);
        if (colGrad)
            ps.colorOverLifetime = colGrad;
    }

    // ─── SizeOverLifetime ───
    if (sizeMod && sizeMod._enable) {
        const sizeOL = convertSizeOverLifetime(sizeMod, resolve);
        if (sizeOL)
            ps.sizeOverLifetime = sizeOL;
    }

    // ─── RotationOverLifetime ───
    if (rotMod && rotMod._enable) {
        const rotOL = convertRotationOverLifetime(rotMod, resolve);
        if (rotOL)
            ps.rotationOverLifetime = rotOL;
    }

    // ─── VelocityOverLifetime ───
    if (velMod && velMod._enable) {
        const velOL = convertVelocityOverLifetime(velMod, resolve);
        if (velOL)
            ps.velocityOverLifetime = velOL;
    }

    // ─── TextureSheetAnimation ───
    if (texAnimMod && texAnimMod._enable) {
        const texAnim = convertTextureAnimation(texAnimMod, resolve);
        if (texAnim)
            ps.textureSheetAnimation = texAnim;
    }

    // ─── 构建 ShurikenParticleRenderer 组件 ───
    const comp: any = {
        _$type: "ShurikenParticleRenderer",
        _particleSystem: ps,
    };

    // 渲染模式
    if (renderer) {
        comp.renderMode = renderer._renderMode ?? 0;
        comp.stretchedBillboardSpeedScale = renderer._velocityScale ?? 0;
        // Cocos 和 LayaAir 的 stretched billboard shader 方向相反：
        // LayaAir shader 中 corner.y = corner.y - abs(corner.y) 使粒子只向一个方向延伸
        // 需要取反 lengthScale 才能让粒子在正确方向（如地面光晕向下）显示
        comp.stretchedBillboardLengthScale = -(renderer._lengthScale ?? 2);
    }

    // 材质：粒子纹理 → 生成 .lmat 材质文件
    const texUuid = renderer?._mainTexture?.__uuid__ ?? renderer?._mainTexture;
    if (texUuid && typeof texUuid === "string") {
        const cleanUuid = texUuid.replace(/@[^@]+$/, "");
        // 基于纹理 UUID 和目标路径生成确定性材质 UUID（标准格式 8-4-4-4-12）
        const targetPath = (conversion as any).currentTargetPath ?? "";
        const matUuid = generateParticleMatUUID(cleanUuid + "|" + targetPath);

        // 检查粒子纹理是否有 fixAlphaTransparencyArtifacts 设置
        const owner = (conversion as any).owner;
        const texAsset = owner?.allAssets?.get(cleanUuid);
        const pma = !!(texAsset?.userData?.fixAlphaTransparencyArtifacts);

        // 粒子材质：使用 materialRenderMode:3 (ADDTIVE) 设置正确的 Additive 混合
        // materialRenderMode 会自动设置 blend=ENABLE, blendSrc=SrcAlpha, blendDst=One
        const matData: any = {
            version: "LAYAMATERIAL:04",
            props: {
                type: "PARTICLESHURIKEN",
                renderQueue: 3000,
                materialRenderMode: 3,  // ADDTIVE: SrcAlpha + One
                alphaTest: false,
                s_Cull: 0,              // CULL_NONE: 粒子双面渲染
                s_DepthTest: 1,         // CompareFunction.Less
                s_DepthWrite: false,
                defines: ["DIFFUSEMAP"],
                textures: [{
                    name: "u_texture",
                    path: `res://${cleanUuid}`,
                    constructParams: [256, 256, 1, false, pma, false], // sRGB=false，粒子纹理不做硬件 gamma 解码; pma 从 Cocos 设置读取
                    propertyParams: { filterMode: 1, wrapModeU: 0, wrapModeV: 0, anisoLevel: 0, ...(pma ? { premultiplyAlpha: true } : {}) },
                }],
            },
        };

        // 通过 owner._pendingParticleMaterials 存储，PrefabConversion 会在写入 .lh 后创建 .lmat
        if (!owner._pendingParticleMaterials) owner._pendingParticleMaterials = [];
        const dir = targetPath.substring(0, targetPath.lastIndexOf("/") + 1) || targetPath.substring(0, targetPath.lastIndexOf("\\") + 1) || "";
        const matFileName = `particle_${cleanUuid.substring(0, 8)}.lmat`;
        const matPath = dir + matFileName;

        owner._pendingParticleMaterials.push({
            path: matPath,
            uuid: matUuid,
            data: matData,
            textureUuid: cleanUuid, // 粒子纹理 UUID，用于更新 .meta sRGB=false
        });

        comp.sharedMaterials = [{ _$uuid: matUuid, _$type: "Material" }];
    }

    node._$comp.push(comp);

    // ─── 修正发射方向 ───
    // Cocos -Z forward → LayaAir +Z forward，需要 R180Y 补偿
    // Shape rotation 也需要烘焙到节点旋转中（IDE 预览不执行 Script 生命周期）
    //
    // 两种情况：
    // A) 节点已有 localRotation（有 Cocos 自定义旋转）：node_rot = Rc * [Rshape *] R180Y
    // B) 节点无 localRotation（identity，继承父节点 R180Y）：
    //    - 无 shape rotation → 不创建 transform（继承父 R180Y 即可）
    //    - 有 shape rotation → 创建 localRotation = R180Y * Rshape * R180Y（共轭变换）
    //      这样 world = parent_R180Y * child_local = parent_R180Y * R180Y * Rshape * R180Y = Rshape * R180Y ✓
    const shapeRot2 = (shapeMod?._enable !== false) ? shapeMod?._rotation : null;
    const hasShapeRotation = shapeRot2 && (shapeRot2.x || shapeRot2.y || shapeRot2.z);

    if (!isOverride) {
        if (node.transform?.localRotation) {
            // 情况 A：已有旋转，后乘 [Rshape *] R180Y
            const rot = node.transform.localRotation;
            let qw = rot.w ?? 1, qx = rot.x ?? 0, qy = rot.y ?? 0, qz = rot.z ?? 0;

            if (hasShapeRotation) {
                const sr = eulerToQuat(shapeRot2.x ?? 0, shapeRot2.y ?? 0, shapeRot2.z ?? 0);
                const combined = multiplyQuat({ x: qx, y: qy, z: qz, w: qw }, sr);
                qw = combined.w; qx = combined.x; qy = combined.y; qz = combined.z;
            }

            // 后乘 R180Y
            rot.w = -qy; rot.x = -qz; rot.y = qw; rot.z = qx;
        } else if (hasShapeRotation) {
            // 情况 B：无旋转但有 shape rotation
            // LayaAir 旋转约定与 Cocos 一致，直接使用 Cocos 角度
            const sr = eulerToQuat(shapeRot2.x ?? 0, shapeRot2.y ?? 0, shapeRot2.z ?? 0);
            if (!node.transform) node.transform = {};
            node.transform.localRotation = { _$type: "Quaternion", x: sr.x, y: sr.y, z: sr.z, w: sr.w };
        }
        // 情况 B 无 shape rotation：不创建 transform，继承父 R180Y
    }
});


// ═══════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════

/** 基于种子字符串生成标准格式 UUID（8-4-4-4-12 hex），确定性哈希 */
function generateParticleMatUUID(seed: string): string {
    // FNV-1a 变体，生成 128 位哈希
    let h0 = 0x6c62272e, h1 = 0x61c88647, h2 = 0x85ebca6b, h3 = 0xc2b2ae35;
    for (let i = 0; i < seed.length; i++) {
        const c = seed.charCodeAt(i);
        h0 = Math.imul(h0 ^ c, 0x01000193) >>> 0;
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
        h3 = Math.imul(h3 ^ c, 0x811c9dc5) >>> 0;
    }
    const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    const s = hex(h0) + hex(h1) + hex(h2) + hex(h3);
    return `${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20, 32)}`;
}

/** 从 Cocos CurveRange 读取常量值 */
function readCurveConstant(curveRange: any, fallback: number = 0): number {
    if (!curveRange) return fallback;
    if (typeof curveRange === "number") return curveRange;
    return curveRange.constant ?? fallback;
}

/** 从 Cocos CurveRange 读取模式和最小/最大值 */
function readCurveMinMax(curveRange: any): { mode: number; constant: number; min: number; max: number } {
    if (!curveRange) return { mode: 0, constant: 0, min: 0, max: 0 };
    const mode = curveRange.mode ?? 0;
    return {
        mode,
        constant: curveRange.constant ?? 0,
        min: curveRange.constantMin ?? 0,
        max: curveRange.constantMax ?? 0,
    };
}

// ─── Start Delay ───
function convertStartDelay(ps: any, startDelay: any): void {
    const d = readCurveMinMax(startDelay);
    if (d.mode === 3) {
        // Random between two constants
        ps.startDelayType = 1;
        ps.startDelayMin = d.min;
        ps.startDelayMax = d.max;
    } else {
        ps.startDelayType = 0;
        ps.startDelay = d.constant;
    }
}

// ─── Start Lifetime ───
function convertStartLifetime(ps: any, startLifetime: any): void {
    const d = readCurveMinMax(startLifetime);
    if (d.mode === 3) {
        // Random between two constants
        ps.startLifetimeType = 2;
        ps.startLifetimeConstantMin = d.min;
        ps.startLifetimeConstantMax = d.max;
    } else {
        ps.startLifetimeType = 0;
        ps.startLifetimeConstant = d.constant || 5;
    }
}

// ─── Start Speed ───
function convertStartSpeed(ps: any, startSpeed: any): void {
    const d = readCurveMinMax(startSpeed);
    if (d.mode === 3) {
        ps.startSpeedType = 2;
        ps.startSpeedConstantMin = d.min;
        ps.startSpeedConstantMax = d.max;
    } else {
        ps.startSpeedType = 0;
        ps.startSpeedConstant = d.constant ?? 5;
    }
}

// ─── Start Size ───
function convertStartSize(ps: any, is3D: boolean, sizeX: any, sizeY: any, sizeZ: any): void {
    ps.threeDStartSize = !!is3D;
    const dx = readCurveMinMax(sizeX);
    if (is3D) {
        if (dx.mode === 3) {
            ps.startSizeType = 2;
            const dy = readCurveMinMax(sizeY);
            const dz = readCurveMinMax(sizeZ);
            ps.startSizeConstantMinSeparate = { _$type: "Vector3", x: dx.min, y: dy.min, z: dz.min };
            ps.startSizeConstantMaxSeparate = { _$type: "Vector3", x: dx.max, y: dy.max, z: dz.max };
        } else {
            ps.startSizeType = 0;
            const dy = readCurveMinMax(sizeY);
            const dz = readCurveMinMax(sizeZ);
            ps.startSizeConstantSeparate = { _$type: "Vector3", x: dx.constant, y: dy.constant, z: dz.constant };
        }
    } else {
        if (dx.mode === 3) {
            ps.startSizeType = 2;
            ps.startSizeConstantMin = dx.min;
            ps.startSizeConstantMax = dx.max;
        } else {
            ps.startSizeType = 0;
            ps.startSizeConstant = dx.constant || 1;
        }
    }
}

// ─── Start Rotation ───
function convertStartRotation(ps: any, is3D: boolean, rotX: any, rotY: any, rotZ: any): void {
    ps.threeDStartRotation = !!is3D;
    const dz = readCurveMinMax(rotZ);
    if (is3D) {
        const dx = readCurveMinMax(rotX);
        const dy = readCurveMinMax(rotY);
        if (dz.mode === 3 || dx.mode === 3 || dy.mode === 3) {
            ps.startRotationType = 2;
            ps.startRotationConstantMinSeparate = { _$type: "Vector3", x: dx.min, y: dy.min, z: dz.min };
            ps.startRotationConstantMaxSeparate = { _$type: "Vector3", x: dx.max, y: dy.max, z: dz.max };
        } else {
            ps.startRotationType = 0;
            ps.startRotationConstantSeparate = { _$type: "Vector3", x: dx.constant, y: dy.constant, z: dz.constant };
        }
    } else {
        if (dz.mode === 3) {
            ps.startRotationType = 2;
            ps.startRotationConstantMin = dz.min;
            ps.startRotationConstantMax = dz.max;
        } else {
            ps.startRotationType = 0;
            ps.startRotationConstant = dz.constant;
        }
    }
}

// ─── Start Color ───
function convertStartColor(ps: any, startColor: any, resolve: (v: any) => any): void {
    if (!startColor) {
        ps.startColorType = 0;
        ps.startColorConstant = { _$type: "Vector4", x: 1, y: 1, z: 1, w: 1 };
        return;
    }
    const mode = startColor._mode ?? startColor.mode ?? 0;
    if (mode === 0) {
        // Constant color
        const c = resolve(startColor.color) ?? resolve(startColor._color) ?? startColor.color;
        ps.startColorType = 0;
        ps.startColorConstant = colorToVec4(c);
    } else if (mode === 2) {
        // Two colors
        const cMin = resolve(startColor.minColor) ?? resolve(startColor._minColor);
        const cMax = resolve(startColor.maxColor) ?? resolve(startColor._maxColor);
        ps.startColorType = 2;
        ps.startColorConstantMin = colorToVec4(cMin);
        ps.startColorConstantMax = colorToVec4(cMax);
    } else {
        // Gradient / TwoGradients — 降级为常量白色
        ps.startColorType = 0;
        ps.startColorConstant = { _$type: "Vector4", x: 1, y: 1, z: 1, w: 1 };
    }
}

function colorToVec4(c: any): any {
    if (!c) return { _$type: "Vector4", x: 1, y: 1, z: 1, w: 1 };
    // Cocos 粒子不做 gamma 转换，直接使用 sRGB 颜色值
    // LayaAir 粒子顶点着色器会对 a_StartColor 执行 gammaToLinear（pow(x, 2.2)），导致颜色变暗
    // 预补偿：存储 pow(sRGB, 1/2.2)，这样经过着色器的 pow(x, 2.2) 后恢复原始 sRGB 值
    const r = (c.r ?? 255) / 255;
    const g = (c.g ?? 255) / 255;
    const b = (c.b ?? 255) / 255;
    return {
        _$type: "Vector4",
        x: Math.pow(r, 1 / 2.2),
        y: Math.pow(g, 1 / 2.2),
        z: Math.pow(b, 1 / 2.2),
        w: (c.a ?? 255) / 255,
    };
}

// ─── Shape ───
function convertShape(shapeMod: any, resolve: (v: any) => any): any | null {
    const type = shapeMod._shapeType;
    // Cocos ShapeType: 0=Box, 1=Circle, 2=Cone, 3=Sphere, 4=Hemisphere
    switch (type) {
        case 0: { // Box
            // Cocos Box 形状尺寸来自 _scale 字段，而非 boxThickness（boxThickness 是边缘发射厚度）
            const boxScale = shapeMod._scale ?? shapeMod.scale;
            return {
                _$type: "BoxShape",
                x: boxScale?.x ?? 1,
                y: boxScale?.y ?? 1,
                z: boxScale?.z ?? 1,
                randomDirection: shapeMod.randomDirectionAmount ?? 0,
            };
        }
        case 1: // Circle
            return {
                _$type: "CircleShape",
                radius: shapeMod.radius ?? 1,
                arc: (shapeMod._arc ?? 6.283) * (180 / Math.PI),
                emitFromEdge: (shapeMod.emitFrom ?? 0) >= 1,
                randomDirection: shapeMod.randomDirectionAmount ?? 0,
            };
        case 2: { // Cone
            // Cocos angle 是弧度，LayaAir angleDEG 是角度
            const angleRad = shapeMod._angle ?? 0.4363; // 默认25度
            return {
                _$type: "ConeShape",
                angleDEG: angleRad * (180 / Math.PI),
                radius: shapeMod.radius ?? 1,
                length: shapeMod.length ?? 5,
                emitType: shapeMod.emitFrom ?? 0,
                randomDirection: shapeMod.randomDirectionAmount ?? 0,
            };
        }
        case 3: // Sphere
            return {
                _$type: "SphereShape",
                radius: shapeMod.radius ?? 1,
                emitFromShell: (shapeMod.emitFrom ?? 0) >= 2,
                randomDirection: shapeMod.randomDirectionAmount ?? 0,
            };
        case 4: // Hemisphere
            return {
                _$type: "HemisphereShape",
                radius: shapeMod.radius ?? 1,
                emitFromShell: (shapeMod.emitFrom ?? 0) >= 2,
                randomDirection: shapeMod.randomDirectionAmount ?? 0,
            };
        default:
            // 默认球形
            return { _$type: "SphereShape", radius: 1 };
    }
}

// ─── ColorOverLifetime ───
function convertColorOverLifetime(mod: any, resolve: (v: any) => any): any | null {
    const colorRange = resolve(mod.color);
    if (!colorRange) return null;

    const mode = colorRange._mode ?? colorRange.mode ?? 0;
    const result: any = {
        _$type: "ColorOverLifetime",
        enable: true,
    };

    if (mode === 1) {
        // Gradient — mode=1 使用 gradient 字段
        const grad = resolve(colorRange.gradient) ?? resolve(colorRange._gradient) ?? resolve(colorRange._maxGradient);
        result._color = {
            _$type: "GradientColor",
            _type: 1,
            _gradient: convertGradient(grad, resolve),
        };
    } else if (mode === 3) {
        // TwoGradients
        const gradMin = resolve(colorRange.minGradient) ?? resolve(colorRange._minGradient);
        const gradMax = resolve(colorRange.maxGradient) ?? resolve(colorRange._maxGradient);
        result._color = {
            _$type: "GradientColor",
            _type: 3,
            _gradientMin: convertGradient(gradMin, resolve),
            _gradientMax: convertGradient(gradMax, resolve),
        };
    } else if (mode === 0) {
        // Constant color
        const c = resolve(colorRange.color) ?? resolve(colorRange._color);
        result._color = {
            _$type: "GradientColor",
            _type: 0,
            _constant: colorToVec4(c),
        };
    } else {
        return null; // 不支持的模式
    }

    return result;
}

/** Cocos Gradient → LayaAir Gradient（RGB + Alpha 关键帧） */
function convertGradient(grad: any, resolve: (v: any) => any): any {
    if (!grad) return makeDefaultGradient();

    const colorKeys = grad.colorKeys ?? grad._colorKeys ?? [];
    const alphaKeys = grad.alphaKeys ?? grad._alphaKeys ?? [];

    // RGB: max 4 keys, 每组 [time, r, g, b]
    const rgbValues = new Array(16).fill(0);
    let rgbCount = 0;
    for (let i = 0; i < Math.min(colorKeys.length, 4); i++) {
        const key = resolve(colorKeys[i]);
        if (!key) continue;
        const color = resolve(key.color) ?? key.color;
        const idx = rgbCount * 4;
        rgbValues[idx] = key.time ?? 0;
        rgbValues[idx + 1] = (color?.r ?? 255) / 255;
        rgbValues[idx + 2] = (color?.g ?? 255) / 255;
        rgbValues[idx + 3] = (color?.b ?? 255) / 255;
        rgbCount++;
    }
    // Cocos 空 colorKeys 默认白色
    if (rgbCount === 0) {
        rgbValues[0] = 0; rgbValues[1] = 1; rgbValues[2] = 1; rgbValues[3] = 1;
        rgbValues[4] = 1; rgbValues[5] = 1; rgbValues[6] = 1; rgbValues[7] = 1;
        rgbCount = 2;
    }

    // Alpha: max 4 keys, 每组 [time, alpha]
    const alphaValues = new Array(8).fill(0);
    let alphaCount = 0;
    for (let i = 0; i < Math.min(alphaKeys.length, 4); i++) {
        const key = resolve(alphaKeys[i]);
        if (!key) continue;
        const idx = alphaCount * 2;
        alphaValues[idx] = key.time ?? 0;
        alphaValues[idx + 1] = (key.alpha ?? 255) / 255;
        alphaCount++;
    }
    // Cocos 空 alphaKeys 默认全不透明
    if (alphaCount === 0) {
        alphaValues[0] = 0; alphaValues[1] = 1;
        alphaValues[2] = 1; alphaValues[3] = 1;
        alphaCount = 2;
    }

    return {
        _$type: "Gradient",
        mode: 0,
        _rgbElements: { _$type: "Float32Array", value: rgbValues },
        _colorRGBKeysCount: rgbCount,
        _alphaElements: { _$type: "Float32Array", value: alphaValues },
        _colorAlphaKeysCount: alphaCount,
    };
}

function makeDefaultGradient(): any {
    return {
        _$type: "Gradient",
        mode: 0,
        _rgbElements: { _$type: "Float32Array", value: [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
        _colorRGBKeysCount: 2,
        _alphaElements: { _$type: "Float32Array", value: [0, 1, 1, 1, 0, 0, 0, 0] },
        _colorAlphaKeysCount: 2,
    };
}

// ─── SizeOverLifetime ───
function convertSizeOverLifetime(mod: any, resolve: (v: any) => any): any | null {
    const sizeRange = resolve(mod.size);
    if (!sizeRange) return null;

    const separateAxes = mod.separateAxes ?? false;
    const mode = sizeRange.mode ?? 0;

    const result: any = {
        _$type: "SizeOverLifetime",
        enable: true,
        _size: {
            _$type: "GradientSize",
            _separateAxes: separateAxes,
        },
    };

    if (mode === 0) {
        // Constant — 不需要 SizeOverLifetime
        return null;
    } else if (mode === 1) {
        // Curve
        result._size._type = 0;
        if (separateAxes) {
            const x = resolve(sizeRange.x ?? sizeRange);
            const y = resolve(sizeRange.y);
            const z = resolve(sizeRange.z);
            result._size._gradientX = convertSplineCurveToLinear(x, resolve);
            result._size._gradientY = convertSplineCurveToLinear(y ?? x, resolve);
            result._size._gradientZ = convertSplineCurveToLinear(z ?? x, resolve);
        } else {
            result._size._gradient = convertSplineCurveToLinear(sizeRange, resolve);
        }
    } else if (mode === 3) {
        // TwoConstants
        result._size._type = 1;
        result._size._constantMin = sizeRange.constantMin ?? 0;
        result._size._constantMax = sizeRange.constantMax ?? 1;
    } else {
        return null;
    }

    return result;
}

/** 将 Cocos 贝塞尔曲线采样为 LayaAir GradientDataNumber（最多4个线性关键帧） */
function convertSplineCurveToLinear(curveRange: any, resolve: (v: any) => any): any {
    if (!curveRange) return makeDefaultGradientDataNumber();

    // 尝试获取曲线关键帧
    const spline = resolve(curveRange.spline) ?? resolve(curveRange._spline) ?? curveRange;

    // Cocos RealCurve 格式: _times[] + _values[]（每个 value 是 RealKeyframeValue 对象）
    const times = spline?._times;
    const values = spline?._values;
    if (Array.isArray(times) && Array.isArray(values) && times.length > 0) {
        const resolvedKeys: { time: number; value: number }[] = [];
        for (let i = 0; i < times.length; i++) {
            const v = resolve(values[i]);
            if (v && typeof v.value === "number") {
                resolvedKeys.push({ time: times[i], value: v.value });
            }
        }
        if (resolvedKeys.length > 0) {
            const sampled = resolvedKeys.length <= 4
                ? resolvedKeys
                : sampleKeyframes(resolvedKeys, 4);
            return makeGradientDataNumber(sampled);
        }
    }

    // 兼容旧格式: keys 数组
    const keys = spline?.keys ?? spline?._keys;
    if (keys && Array.isArray(keys) && keys.length > 0) {
        const keyframes = Array.isArray(keys[0]) ? keys[0] : keys;
        const resolvedKeys: { time: number; value: number }[] = [];
        for (const k of keyframes) {
            const rk = resolve(k);
            if (rk && typeof rk.time === "number" && typeof rk.value === "number") {
                resolvedKeys.push({ time: rk.time, value: rk.value });
            }
        }
        if (resolvedKeys.length > 0) {
            const sampled = resolvedKeys.length <= 4
                ? resolvedKeys
                : sampleKeyframes(resolvedKeys, 4);
            return makeGradientDataNumber(sampled);
        }
    }

    // Fallback: 常量曲线 0→1
    return makeDefaultGradientDataNumber();
}

function sampleKeyframes(keys: { time: number; value: number }[], count: number): { time: number; value: number }[] {
    if (keys.length <= count) return keys;
    // 均匀采样
    const result: { time: number; value: number }[] = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        // 找到 t 在 keys 中的位置并线性插值
        let idx = 0;
        for (let j = 0; j < keys.length - 1; j++) {
            if (keys[j + 1].time >= t) { idx = j; break; }
        }
        const k0 = keys[idx];
        const k1 = keys[Math.min(idx + 1, keys.length - 1)];
        const frac = k1.time > k0.time ? (t - k0.time) / (k1.time - k0.time) : 0;
        result.push({ time: t, value: k0.value + (k1.value - k0.value) * frac });
    }
    return result;
}

function makeGradientDataNumber(keys: { time: number; value: number }[]): any {
    const values = new Array(8).fill(0);
    let len = 0;
    for (let i = 0; i < Math.min(keys.length, 4); i++) {
        values[i * 2] = keys[i].time;
        values[i * 2 + 1] = keys[i].value;
        len += 2;
    }
    return {
        _$type: "GradientDataNumber",
        _elements: { _$type: "Float32Array", value: values },
        _currentLength: len,
    };
}

function makeDefaultGradientDataNumber(): any {
    return {
        _$type: "GradientDataNumber",
        _elements: { _$type: "Float32Array", value: [0, 0, 1, 1, 0, 0, 0, 0] },
        _currentLength: 4,
    };
}

// ─── RotationOverLifetime ───
function convertRotationOverLifetime(mod: any, resolve: (v: any) => any): any | null {
    const x = resolve(mod.x);
    const y = resolve(mod.y);
    const z = resolve(mod.z);
    const separateAxes = mod.separateAxes ?? false;

    const result: any = {
        _$type: "RotationOverLifetime",
        enable: true,
        _angularVelocity: {
            _$type: "GradientAngularVelocity",
            _separateAxes: separateAxes,
        },
    };

    const dz = readCurveMinMax(z);
    if (dz.mode === 3) {
        result._angularVelocity._type = 2;
        result._angularVelocity._constantMin = dz.min;
        result._angularVelocity._constantMax = dz.max;
    } else {
        result._angularVelocity._type = 0;
        result._angularVelocity._constant = dz.constant;
    }

    if (separateAxes) {
        const dx = readCurveMinMax(x);
        const dy = readCurveMinMax(y);
        if (dz.mode === 3) {
            result._angularVelocity._constantMinSeparate = { _$type: "Vector3", x: dx.min, y: dy.min, z: dz.min };
            result._angularVelocity._constantMaxSeparate = { _$type: "Vector3", x: dx.max, y: dy.max, z: dz.max };
        } else {
            result._angularVelocity._constantSeparate = { _$type: "Vector3", x: dx.constant, y: dy.constant, z: dz.constant };
        }
    }

    return result;
}

// ─── VelocityOverLifetime ───
function convertVelocityOverLifetime(mod: any, resolve: (v: any) => any): any | null {
    const x = resolve(mod.x);
    const y = resolve(mod.y);
    const z = resolve(mod.z);
    const space = mod.space ?? 1; // Cocos: 0=local, 1=world

    const dx = readCurveMinMax(x);
    const dy = readCurveMinMax(y);
    const dz = readCurveMinMax(z);

    const result: any = {
        _$type: "VelocityOverLifetime",
        enable: true,
        // Cocos space: 0=local,1=world → LayaAir: 0=local,1=world（相同）
        space: space,
        _velocity: {
            _$type: "GradientVelocity",
        },
    };

    if (dx.mode === 3 || dy.mode === 3 || dz.mode === 3) {
        result._velocity._type = 2;
        result._velocity._constantMin = { _$type: "Vector3", x: dx.min, y: dy.min, z: dz.min };
        result._velocity._constantMax = { _$type: "Vector3", x: dx.max, y: dy.max, z: dz.max };
    } else {
        result._velocity._type = 0;
        result._velocity._constant = { _$type: "Vector3", x: dx.constant, y: dy.constant, z: dz.constant };
    }

    return result;
}

// ─── 四元数辅助函数 ───

/** 欧拉角（度数，XYZ顺序）转四元数 */
function eulerToQuat(xDeg: number, yDeg: number, zDeg: number): { x: number; y: number; z: number; w: number } {
    const deg2rad = Math.PI / 180;
    const hx = xDeg * deg2rad * 0.5;
    const hy = yDeg * deg2rad * 0.5;
    const hz = zDeg * deg2rad * 0.5;
    const cx = Math.cos(hx), sx = Math.sin(hx);
    const cy = Math.cos(hy), sy = Math.sin(hy);
    const cz = Math.cos(hz), sz = Math.sin(hz);
    return {
        x: sx * cy * cz + cx * sy * sz,
        y: cx * sy * cz - sx * cy * sz,
        z: cx * cy * sz + sx * sy * cz,
        w: cx * cy * cz - sx * sy * sz,
    };
}

/** 四元数乘法 a * b */
function multiplyQuat(
    a: { x: number; y: number; z: number; w: number },
    b: { x: number; y: number; z: number; w: number }
): { x: number; y: number; z: number; w: number } {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

// ─── TextureSheetAnimation ───
function convertTextureAnimation(mod: any, resolve: (v: any) => any): any | null {
    const numTilesX = mod.numTilesX ?? 1;
    const numTilesY = mod.numTilesY ?? 1;
    const animation = mod._animation ?? 0; // 0=WholeSheet, 1=SingleRow

    const result: any = {
        _$type: "TextureSheetAnimation",
        enable: true,
        tiles: { _$type: "Vector2", x: numTilesX, y: numTilesY },
        type: animation,
        randomRow: mod.randomRow ?? false,
        rowIndex: mod.rowIndex ?? 0,
        cycles: mod.cycleCount ?? 1,
    };

    // Frame over time
    const frameOverTime = resolve(mod.frameOverTime);
    if (frameOverTime) {
        const fMode = frameOverTime.mode ?? 0;
        if (fMode === 0) {
            result._frame = {
                _$type: "FrameOverTime",
                _type: 0,
                _constant: frameOverTime.constant ?? 0,
            };
        } else if (fMode === 1) {
            // Curve — 转为线性近似
            const spline = resolve(frameOverTime.spline) ?? resolve(frameOverTime._spline);
            const totalFrames = numTilesX * numTilesY;
            result._frame = {
                _$type: "FrameOverTime",
                _type: 1,
                _overTime: makeGradientDataNumber([
                    { time: 0, value: 0 },
                    { time: 1, value: totalFrames - 0.0004 },
                ]),
            };
        }
    }

    return result;
}
