import fs from "fs";
import path from "path";
import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import { formatUuid, getInternalUUID } from "../Utils";

/**
 * 开关：是否将所有自定义 shader 强制转换为 Laya 内置的 Unlit shader
 * - true: 所有自定义 shader 都转换为 Unlit（演示时使用，确保不报错）
 * - false: 使用正常的转换逻辑（开发测试时使用）
 */
const FORCE_UNLIT_FOR_CUSTOM_SHADERS = false;

export class MaterialConversion implements ICocosAssetConversion {
    private _currentTargetPath: string = "";

    constructor(private owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        try {
            // 保存 targetPath，用于查找 shader 文件
            this._currentTargetPath = targetPath;

            // 读取 Cocos 材质文件
            const cocosMatData = await IEditorEnv.utils.readJsonAsync(sourcePath);

            // 转换为 LayaAir 材质格式
            const layaMaterial = this.convertMaterial(cocosMatData, meta);

            // 修改目标路径扩展名为 .lmat
            targetPath = targetPath.replace(/\.mtl$/, '.lmat');

            // 写入 LayaAir 材质文件
            await IEditorEnv.utils.writeJsonAsync(targetPath, layaMaterial);

            // 写入 meta 文件
            await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });

            //console.debug(`Material converted: ${sourcePath} -> ${targetPath}`);
        } catch (error) {
            console.error(`Failed to convert material ${sourcePath}:`, error);
            // 如果转换失败，至少复制原文件
            await fs.promises.copyFile(sourcePath, targetPath);
            await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
        }
    }

    private convertMaterial(cocosMatData: any, meta: any): any {
        // 基础 LayaAir 材质结构（不包含默认属性，只保留必要的结构）
        const layaMaterial: any = {
            version: "LAYAMATERIAL:04",
            props: {
                textures: [],
                type: "BLINNPHONG",
                renderQueue: 2000,
                alphaTest: false,
                materialRenderMode: 0,
                s_Cull: 2,
                s_Blend: 0,
                s_DepthTest: 1,
                s_DepthWrite: true,
                defines: []
            }
        };

        // 解析 Cocos 材质数据
        const techniqueIndex = cocosMatData._techIdx ?? 0;
        const effectUuid = cocosMatData._effectAsset?.__uuid__ || "";
        const defines = this.normalizeDefines(cocosMatData._defines);
        const props = this.normalizeProps(cocosMatData._props);

        // 获取 technique 名称（用于生成正确的 shader 文件名）
        const techniqueName = this.getTechniqueName(effectUuid, techniqueIndex);

        // 映射 Shader 名称
        const shaderInfo = this.resolveShaderInfo(effectUuid, cocosMatData, defines, techniqueName);
        layaMaterial.props.type = shaderInfo.type;
        if (shaderInfo.source)
            layaMaterial.props._cocosEffect = shaderInfo.source;

        // 转换渲染状态（先从 material 的 _states 读取，如果没有则从 shader effect 文件读取）
        const states = cocosMatData._states?.[techniqueIndex];
        if (states) {
            this.convertRenderStates(layaMaterial, states);
        }

        // 检查是否缺少 blendState 信息，如果缺少则从 effect 文件读取
        const materialProps = layaMaterial.props;
        const hasBlendState = materialProps.s_Blend === 1 || materialProps.s_Blend === 2;
        const hasBlendFactors = materialProps.s_BlendSrc !== undefined && materialProps.s_BlendDst !== undefined;

        // 如果没有 blendState 或者缺少 blend 因子，尝试从 effect 文件读取
        if (!hasBlendState || !hasBlendFactors) {
            console.debug(`[MaterialConversion] Material states missing blend state info (s_Blend: ${materialProps.s_Blend}, s_BlendSrc: ${materialProps.s_BlendSrc}, s_BlendDst: ${materialProps.s_BlendDst}), trying to read from effect file...`);
            this.convertRenderStatesFromEffect(layaMaterial, effectUuid, techniqueName);
        } else {
            // 检查是否缺少 alpha blend 信息
            const missingAlphaBlend = hasBlendState && (materialProps.s_BlendSrcAlpha === undefined || materialProps.s_BlendDstAlpha === undefined);
            if (missingAlphaBlend) {
                console.debug(`[MaterialConversion] Material states missing alpha blend info, trying to read from effect file...`);
                this.convertRenderStatesFromEffect(layaMaterial, effectUuid, techniqueName);
            }
        }

        // 如果 material 中没有 states，也尝试从 effect 文件读取
        if (!states) {
            this.convertRenderStatesFromEffect(layaMaterial, effectUuid, techniqueName);
        }

        // 根据 technique 名称自动设置混合状态（如果还没有设置）
        // 这是一个后备机制，用于处理 Cocos 内置 effect 的情况
        this.applyTechniqueBasedBlendState(layaMaterial, techniqueName);

        // 获取 shader 文件路径，读取实际的 uniform 名称
        const shaderUniformInfo = this.getShaderUniforms(shaderInfo.type);

        // 转换材质属性（传入 shader 的 uniform 信息）
        this.convertMaterialProps(layaMaterial, props, defines, shaderUniformInfo);

        // 为 Toon shader 添加必要的默认参数（如果材质中没有设置）
        // 这些参数对于 Toon 着色效果至关重要
        if (shaderInfo.type === "toon_default" || shaderInfo.type === "builtin-toon_default" || shaderInfo.source === "toon" || shaderInfo.source === "builtin-toon") {
            // 先对从 Cocos 转换过来的实际颜色值做 sqrt 编码（shader 中 toCocosLinear(x²) 恢复）
            // 必须在 ensureToonDefaults 之前，因为默认值已经是预编码的
            this.encodeToonColors(layaMaterial.props);
            this.ensureToonDefaults(layaMaterial.props);
        }

        // PBR 材质：补偿 Cocos/LayaAir 渲染管线亮度差异
        // 同样的白色 albedo + 贴图，LayaAir PBR 渲染偏亮（tone mapping、伽马处理差异）
        // 补偿系数 0.78 根据两端视觉对比确定（Cocos albedo 白色 ≈ LayaAir C7CACE）
        if (layaMaterial.props.type === "PBR") {
            const PBR_ALBEDO_SCALE = 0.78;
            const color = layaMaterial.props.u_AlbedoColor ?? [1, 1, 1, 1];
            layaMaterial.props.u_AlbedoColor = [
                color[0] * PBR_ALBEDO_SCALE,
                color[1] * PBR_ALBEDO_SCALE,
                color[2] * PBR_ALBEDO_SCALE,
                color[3]
            ];
        }

        // PBR 透明材质后处理
        if (layaMaterial.props.type === "PBR" && layaMaterial.props.materialRenderMode === 2) {
            const alphaTestValue = layaMaterial.props.u_AlphaTestValue ?? 0;
            if (alphaTestValue <= 0) {
                layaMaterial.props.alphaTest = false;
                const defs = layaMaterial.props.defines;
                const idx = defs.indexOf("ALPHATEST");
                if (idx !== -1) {
                    defs.splice(idx, 1);
                }
                delete layaMaterial.props.u_AlphaTestValue;
            }
            // 显式设置 u_AlbedoColor，避免 IDE 刷新时使用错误的默认值
            if (!layaMaterial.props.u_AlbedoColor) {
                layaMaterial.props.u_AlbedoColor = [1, 1, 1, 1];
            }
        }

        // 最终清理：移除不应出现在 .lmat 中的属性
        // 1. _cocosEffect 是插件内部标记，MaterialParser 会将其作为 Matrix4x4 解析导致 NaN
        delete layaMaterial.props._cocosEffect;
        // 2. 非 PBR uniform 的属性（来自 Cocos 但在 LayaAir PBR 中无对应）
        if (layaMaterial.props.type === "PBR") {
            delete layaMaterial.props.shininess;
            delete layaMaterial.props.specularIntensity;
        }
        // 3. materialRenderMode 已设置时，移除冗余的显式 blend/depth 属性
        //    materialRenderMode setter 在引擎加载时会统一设置这些状态，
        //    显式属性在 move() 刷新时会产生顺序冲突导致渲染异常
        const mode = layaMaterial.props.materialRenderMode;
        if (mode !== undefined && mode !== 0 && mode !== 5) {
            // materialRenderMode setter 会设置：blend, blendSrc, blendDst, depthWrite, depthTest, alphaTest, renderQueue
            // 显式属性在 move() 刷新时会因执行顺序不同而产生冲突
            delete layaMaterial.props.s_Blend;
            delete layaMaterial.props.s_BlendSrc;
            delete layaMaterial.props.s_BlendDst;
            delete layaMaterial.props.s_BlendSrcAlpha;
            delete layaMaterial.props.s_BlendDstAlpha;
            delete layaMaterial.props.s_BlendSrcRGB;
            delete layaMaterial.props.s_BlendDstRGB;
            delete layaMaterial.props.s_BlendEquation;
            delete layaMaterial.props.s_BlendEquationRGB;
            delete layaMaterial.props.s_BlendEquationAlpha;
            delete layaMaterial.props.s_DepthWrite;
            // s_Cull 和 s_DepthTest 保留，materialRenderMode 不设置它们
        }

        return layaMaterial;
    }

    /**
     * 根据 technique 名称自动设置混合状态
     * 用于处理 Cocos 内置 effect 的情况，这些 effect 的混合状态定义在 effect 文件中而不是材质中
     */
    private applyTechniqueBasedBlendState(layaMaterial: any, techniqueName: string | null): void {
        if (!techniqueName) return;

        const props = layaMaterial.props;
        const techniqueNameLower = techniqueName.toLowerCase();

        // 如果已经设置了 materialRenderMode（非不透明），不覆盖
        if (props.materialRenderMode !== undefined && props.materialRenderMode !== 0) {
            return;
        }

        // 根据 technique 名称设置 materialRenderMode
        // 不再设置显式 blend 属性（s_Blend, s_BlendSrc, s_BlendDst 等），
        // 由 materialRenderMode setter 在引擎加载时统一处理，
        // 避免 IDE 刷新时 move() 中 materialRenderMode setter 与显式值的顺序冲突
        if (techniqueNameLower === "transparent" || techniqueNameLower.includes("transparent")) {
            props.renderQueue = 3000;
            props.materialRenderMode = 2; // TRANSPARENT
            console.debug(`[MaterialConversion] Applied transparent mode based on technique name: ${techniqueName}`);
        } else if (techniqueNameLower === "add" || techniqueNameLower === "additive" || techniqueNameLower.includes("add")) {
            props.renderQueue = 3000;
            props.materialRenderMode = 3; // ADDITIVE
            console.debug(`[MaterialConversion] Applied additive mode based on technique name: ${techniqueName}`);
        } else if (techniqueNameLower === "alpha-blend" || techniqueNameLower.includes("alpha")) {
            props.renderQueue = 3000;
            props.materialRenderMode = 4; // ALPHABLENDED
            console.debug(`[MaterialConversion] Applied alpha-blend mode based on technique name: ${techniqueName}`);
        }
        // opaque 不需要特殊处理，保持默认值
    }

    /**
     * 确保 Toon shader 有必要的默认参数
     * Cocos toon.effect 中定义的默认值必须显式写入材质文件
     */
    private ensureToonDefaults(props: any): void {
        // Toon shading parameters - 必须与 Cocos toon.effect 中的默认值一致
        if (props.baseStep === undefined) props.baseStep = 0.8;
        if (props.baseFeather === undefined) props.baseFeather = 0.001;
        if (props.shadeStep === undefined) props.shadeStep = 0.5;
        if (props.shadeFeather === undefined) props.shadeFeather = 0.001;
        if (props.shadowCover === undefined) props.shadowCover = 0.5;

        // Color scale
        if (props.colorScale === undefined) props.colorScale = [1.0, 1.0, 1.0];

        // Base color — Cocos 默认 x² 线性值 0.6，存储 sqrt(0.6) 供 toCocosLinear 恢复
        if (props.baseColor === undefined) props.baseColor = [0.775, 0.775, 0.775, 1.0];

        // Shade colors — Cocos 默认 x² 线性值 0.4/0.2，存储 sqrt
        if (props.shadeColor1 === undefined) props.shadeColor1 = [0.632, 0.632, 0.632, 1.0];
        if (props.shadeColor2 === undefined) props.shadeColor2 = [0.447, 0.447, 0.447, 1.0];

        // Specular (w 分量控制高光大小，0.3 是合理的默认值)
        if (props.specular === undefined) props.specular = [1.0, 1.0, 1.0, 0.3];

        // Emissive
        if (props.emissive === undefined) props.emissive = [0.0, 0.0, 0.0, 1.0];
        if (props.emissiveScale === undefined) props.emissiveScale = [1.0, 1.0, 1.0];

        // Normal strength
        if (props.normalStrength === undefined) props.normalStrength = 1.0;

        // Outline parameters (Cocos toon.effect defaults: lineWidth=10, depthBias=0)
        if (props.lineWidth === undefined) props.lineWidth = 10.0;
        if (props.depthBias === undefined) props.depthBias = 0.0;
        if (props.outlineColor === undefined) props.outlineColor = [0.0, 0.0, 0.0, 1.0];

        // Tiling offset
        if (props.tilingOffset === undefined) props.tilingOffset = [1.0, 1.0, 0.0, 0.0];

        // Alpha threshold
        if (props.alphaThreshold === undefined) props.alphaThreshold = 0.5;
    }

    /**
     * 对 Toon shader 中需要 toCocosLinear(x²) 恢复的颜色值进行 sqrt 编码。
     * ensureToonDefaults 的默认值已预编码（如 sqrt(0.4)=0.632），
     * 但从 Cocos 转换过来的实际值是原始线性值，需要同样的 sqrt 编码。
     */
    private encodeToonColors(props: any): void {
        const sqrtEncode = (color: number[]): number[] => {
            const round3 = (v: number) => Math.round(v * 1000) / 1000;
            return [
                round3(Math.sqrt(Math.max(0, color[0]))),
                round3(Math.sqrt(Math.max(0, color[1]))),
                round3(Math.sqrt(Math.max(0, color[2]))),
                color[3] !== undefined ? color[3] : 1.0
            ];
        };

        const colorKeys = ["baseColor", "shadeColor1", "shadeColor2", "specular", "emissive"];
        for (const key of colorKeys) {
            if (Array.isArray(props[key]) && props[key].length >= 3) {
                props[key] = sqrtEncode(props[key]);
            }
        }
    }

    private getShaderUniforms(shaderType: string): { all: Set<string>, textures: Set<string>, colors: Set<string>, vectors: Set<string> } {
        const all = new Set<string>();
        const textures = new Set<string>();
        const colors = new Set<string>();
        const vectors = new Set<string>();

        if (!shaderType) {
            console.debug(`[MaterialConversion] No shader type provided`);
            return { all, textures, colors, vectors };
        }

        // 查找 shader 文件
        const shaderAsset = this.findShaderAsset(shaderType);
        if (!shaderAsset?.sourcePath) {
            console.debug(`[MaterialConversion] Shader file not found for type: ${shaderType}`);
            return { all, textures, colors, vectors };
        }

        console.debug(`[MaterialConversion] Reading shader uniforms from: ${shaderAsset.sourcePath}`);

        try {
            const shaderContent = fs.readFileSync(shaderAsset.sourcePath, "utf8");

            // 提取 uniformMap 块（需要处理多行和嵌套的大括号）
            // 使用更健壮的方法：找到 uniformMap: { 的开始，然后找到匹配的 }
            let uniformMapStart = shaderContent.indexOf("uniformMap:");
            if (uniformMapStart === -1) {
                console.debug(`[MaterialConversion] No uniformMap found in shader file`);
                return { all, textures, colors, vectors };
            }

            // 找到第一个 {
            let braceStart = shaderContent.indexOf("{", uniformMapStart);
            if (braceStart === -1) {
                console.debug(`[MaterialConversion] No opening brace found for uniformMap`);
                return { all, textures, colors, vectors };
            }

            // 找到匹配的 }
            let depth = 1;
            let i = braceStart + 1;
            while (i < shaderContent.length && depth > 0) {
                if (shaderContent[i] === "{") depth++;
                if (shaderContent[i] === "}") depth--;
                if (depth === 0) break;
                i++;
            }

            if (depth !== 0) {
                console.debug(`[MaterialConversion] No matching closing brace found for uniformMap`);
                return { all, textures, colors, vectors };
            }

            const uniformMapContent = shaderContent.substring(braceStart + 1, i);

            console.debug(`[MaterialConversion] Extracted uniformMap content (first 300 chars):`, uniformMapContent.substring(0, 300));

            // 解析每个 uniform（格式：u_xxx: { type: Texture2D, ... } 或 u_xxx: { type: Color, ... }）
            // 需要匹配完整的 uniform 定义，包括类型
            // 注意：可能有多行，需要处理换行和空格
            const uniformRegex = /(\w+):\s*\{\s*type:\s*(\w+)/g;
            let match;
            while ((match = uniformRegex.exec(uniformMapContent)) !== null) {
                const uniformName = match[1].trim();
                const uniformType = match[2].trim();

                if (uniformName) {
                    all.add(uniformName);

                    // 根据类型分类
                    if (uniformType === "Texture2D" || uniformType === "TextureCube") {
                        textures.add(uniformName);
                    } else if (uniformType === "Color") {
                        colors.add(uniformName);
                    } else if (uniformType === "Vector2" || uniformType === "Vector3" || uniformType === "Vector4") {
                        vectors.add(uniformName);
                    }

                    console.debug(`[MaterialConversion] Found uniform: ${uniformName} (${uniformType})`);
                }
            }

            // 调试：打印解析结果
            console.debug(`[MaterialConversion] Parsed uniformMap content:`, uniformMapContent.substring(0, 200));

            console.debug(`[MaterialConversion] Total uniforms found: ${all.size} (textures: ${textures.size}, colors: ${colors.size}, vectors: ${vectors.size})`);
        } catch (error) {
            console.warn(`[MaterialConversion] Failed to read shader uniforms from ${shaderAsset.sourcePath}:`, error);
        }

        return { all, textures, colors, vectors };
    }

    private findShaderAsset(shaderType: string): { sourcePath: string } | null {
        // 首先在 allAssets 中查找（可能还没有转换完成）
        for (const [uuid, asset] of this.owner.allAssets.entries()) {
            if (!asset.sourcePath) continue;

            // 检查文件名是否匹配 shaderType
            const fileName = path.basename(asset.sourcePath, path.extname(asset.sourcePath));
            if (fileName === shaderType || fileName.replace(/[_-]/g, "") === shaderType.replace(/[_-]/g, "")) {
                // 如果文件扩展名是 .shader，说明已经转换了，直接返回
                if (asset.sourcePath.endsWith(".shader")) {
                    return asset;
                }
            }
        }

        // 如果 allAssets 中找不到，尝试从目标路径查找（shader 文件应该已经转换并保存了）
        if (this._currentTargetPath) {
            const targetDir = path.dirname(this._currentTargetPath);
            const shaderPath = path.join(targetDir, `${shaderType}.shader`);

            if (fs.existsSync(shaderPath)) {
                console.debug(`[MaterialConversion] Found shader file at target path: ${shaderPath}`);
                return { sourcePath: shaderPath };
            }

            // 也尝试在 shader 子目录中查找
            const shaderDir = path.join(targetDir, "shader");
            if (fs.existsSync(shaderDir)) {
                const shaderPathInDir = path.join(shaderDir, `${shaderType}.shader`);
                if (fs.existsSync(shaderPathInDir)) {
                    console.debug(`[MaterialConversion] Found shader file in shader directory: ${shaderPathInDir}`);
                    return { sourcePath: shaderPathInDir };
                }
            }
        }

        // 在插件的 shaders 目录中查找预置的 shader 文件
        try {
            const pluginShadersPath = path.resolve(__dirname, "..", "..", "shaders");
            const pluginShaderPath = path.join(pluginShadersPath, `${shaderType}.shader`);
            if (fs.existsSync(pluginShaderPath)) {
                console.debug(`[MaterialConversion] Found shader file in plugin shaders directory: ${pluginShaderPath}`);
                return { sourcePath: pluginShaderPath };
            }
        } catch (e) {
            // ignore
        }

        console.debug(`[MaterialConversion] Shader file not found for type: ${shaderType}`);
        return null;
    }

    private normalizeDefines(defines: any): any {
        if (Array.isArray(defines)) {
            return defines.reduce((acc: any, item: any) => Object.assign(acc, item), {});
        }
        return defines || {};
    }

    private normalizeProps(props: any): any {
        if (Array.isArray(props)) {
            return props.reduce((acc: any, item: any) => Object.assign(acc, item), {});
        }
        return props || {};
    }

    private getTechniqueName(effectUuid: string, techniqueIndex: number): string | null {
        if (!effectUuid) return null;

        // 查找 effect 资源
        const effectAsset = this.owner.allAssets.get(effectUuid);
        if (!effectAsset?.sourcePath) return null;

        try {
            // 读取 effect 文件内容
            const effectContent = fs.readFileSync(effectAsset.sourcePath, "utf8");

            // 提取 CCEffect 块
            const startMarker = "CCEffect";
            const startIndex = effectContent.indexOf(startMarker);
            if (startIndex === -1) return null;

            let braceStart = effectContent.indexOf("%{", startIndex);
            if (braceStart === -1) return null;

            // 查找对应的 }% 结束位置
            let depth = 1;
            let i = braceStart + 2;
            while (i < effectContent.length && depth > 0) {
                if (effectContent.substring(i, i + 2) === "}%") {
                    depth--;
                    if (depth === 0) {
                        const effectBody = effectContent.substring(braceStart + 2, i).trim();

                        // 解析 YAML 获取 techniques
                        const yaml = require("../../lib/js-yaml.js");
                        const yamlData = yaml.load(effectBody);

                        if (yamlData?.techniques && Array.isArray(yamlData.techniques)) {
                            const technique = yamlData.techniques[techniqueIndex];
                            if (technique?.name) {
                                return technique.name;
                            }
                        }
                        return null;
                    }
                } else if (effectContent.substring(i, i + 2) === "%{") {
                    depth++;
                }
                i++;
            }
        } catch (error) {
            console.warn(`Failed to read technique name from effect: ${effectAsset.sourcePath}`, error);
        }

        return null;
    }

    private resolveShaderInfo(cocoEffectUuid: string, cocosMatData: any, defines: any, techniqueName?: string | null): { type: string, source?: string } {
        // 获取 effect 资源信息
        const effectAsset = this.owner.allAssets.get(cocoEffectUuid);

        // 根据 Cocos effect 名称映射到 LayaAir shader
        // 常见的内置材质映射（注意大小写要一致）
        const builtinShaderMap: Record<string, string> = {
            "builtin-standard": "PBR",
            "builtin-unlit": "Unlit",
            // "builtin-toon": "Toon",
            "builtin-particle": "PARTICLESHURIKEN",
            // "builtin-spine": "Spine",
            // "builtin-sprite": "Sprite2D",
            // "builtin-terrain": "Terrain",
            // "builtin-pbr": "PBR",
            // "builtin-trail": "Trail",
            // "builtin-skybox": "SkyBox",
            // "builtin-sky-panoramic": "SkyPanoramic",
            // "builtin-sky-procedural": "SkyProcedural",
            // "builtin-gltf-pbr": "glTFPBR"
        };
        
        // 自定义 Shader 映射：Cocos effect 名称 -> LayaAir shader 名称
        // 这些 shader 已经在 LayaAir 中实现，不受 FORCE_UNLIT_FOR_CUSTOM_SHADERS 开关影响
        const customShaderMap: Record<string, string> = {
            // StandardWithOutline: PBR + 描边效果
            "standardwithoutline": "StandardWithOutline",
            // builtin-toon / toon: 使用预置的 toon_default shader（在 shaders/ 目录中）
            "builtin-toon": "toon_default",
            "toon": "toon_default",
        };
        const effectCandidates: Array<{ raw: string, normalized: string }> = [];

        const collectCandidate = (candidate?: string) => {
            if (!candidate)
                return;
            const raw = this.sanitizeEffectName(candidate);
            if (!raw)
                return;
            const normalized = this.normalizeEffectKey(raw);
            effectCandidates.push({ raw, normalized });
        };

        if (effectAsset?.sourcePath)
            collectCandidate(effectAsset.sourcePath);
        if (effectAsset?.userData) {
            const data = effectAsset.userData;
            if (typeof data === "string")
                collectCandidate(data);
            else {
                ["name", "effectName", "shaderName", "effect", "path"].forEach(key => {
                    if (data[key])
                        collectCandidate(String(data[key]));
                });
            }
        }
        if (cocosMatData._effectAsset?.__name__)
            collectCandidate(String(cocosMatData._effectAsset.__name__));
        if (cocosMatData._name)
            collectCandidate(String(cocosMatData._name));

        if (effectCandidates.length === 0 && cocoEffectUuid) {
            const effectName = this.readEffectName(cocoEffectUuid);
            if (effectName)
                collectCandidate(effectName);
        }

        console.log(`[MaterialConversion] resolveShaderInfo: effectCandidates =`, effectCandidates.map(c => `${c.raw} -> ${c.normalized}`));

        for (const candidate of effectCandidates) {
            const builtin = builtinShaderMap[candidate.normalized];
            console.log(`[MaterialConversion] resolveShaderInfo: checking candidate "${candidate.normalized}" -> builtin = "${builtin}"`);
            if (builtin) {
                // 如果是内置 shader，直接返回，不受开关影响
                console.log(`[MaterialConversion] resolveShaderInfo: matched builtin shader "${candidate.normalized}" -> "${builtin}"`);
                return { type: builtin, source: candidate.raw };
            }
            
            // 检查自定义 Shader 映射（这些 shader 已经在 LayaAir 中实现）
            // 注意：customShaderMap 中的映射不受 FORCE_UNLIT_FOR_CUSTOM_SHADERS 开关影响
            const customShader = customShaderMap[candidate.normalized];
            if (customShader) {
                console.debug(`[MaterialConversion] Using custom shader: ${candidate.raw} -> ${customShader}`);
                return { type: customShader, source: candidate.raw };
            }
        }

        // 如果开关打开，未映射的自定义 shader 强制转换为 Unlit
        if (FORCE_UNLIT_FOR_CUSTOM_SHADERS) {
            const effectName = effectCandidates.length > 0 ? effectCandidates[0].raw : "unknown";
            console.debug(`[MaterialConversion] Force converting custom shader "${effectName}" to Unlit (FORCE_UNLIT_FOR_CUSTOM_SHADERS = true)`);
            return { type: "Unlit" };
        }

        // 正常转换逻辑（开关关闭时）
        if (effectCandidates.length > 0) {
            const first = effectCandidates[0];
            let shaderName = this.toLayaTypeName(first.raw);

            // 始终使用 technique 名称作为后缀（即使只有一个 technique）
            // 格式：原文件名_technique名称
            if (techniqueName) {
                shaderName = `${shaderName}_${techniqueName}`;
            } else {
                // 如果没有 technique 名称，使用默认的 "default"
                shaderName = `${shaderName}_default`;
            }

            return { type: shaderName, source: first.raw };
        }

        // 根据 defines 判断特性
        if (defines.USE_INSTANCING) {
            return { type: "BLINNPHONG-INSTANCE" };
        }
        if (defines.USE_BATCHING) {
            return { type: "BLINNPHONG" };
        }
        if (defines.USE_SKINNING) {
            return { type: "BLINNPHONG-SKIN" };
        }

        // 默认
        return { type: "CustomMaterial" };
    }

    private convertRenderStates(layaMaterial: any, states: any): void {
        const renderState: any = {};
        const props = layaMaterial.props;

        // 剔除模式
        if (states.rasterizerState?.cullMode !== undefined) {
            const cullMode = states.rasterizerState.cullMode;
            // Cocos: "none"=0, "front"=1, "back"=2 或数字 0=none, 1=front, 2=back
            // Laya: 0=off, 1=front, 2=back
            if (typeof cullMode === "string") {
                const cullMap: Record<string, number> = {
                    "none": 0,
                    "front": 1,
                    "back": 2
                };
                props.s_Cull = cullMap[cullMode] ?? 2;
            } else {
                props.s_Cull = cullMode;
            }
            console.debug(`[MaterialConversion] Set s_Cull = ${props.s_Cull} (from cullMode: ${cullMode})`);
        }

        // 混合模式
        if (states.blendState?.targets?.[0]) {
            const blendTarget = states.blendState.targets[0];
            console.debug(`[MaterialConversion] convertRenderStates: blendTarget:`, blendTarget);
            if (blendTarget.blend) {
                // 检查是否有分别的 RGB 和 Alpha 设置
                const hasSeparateBlend = blendTarget.blendSrcAlpha !== undefined || blendTarget.blendDstAlpha !== undefined;
                props.s_Blend = hasSeparateBlend ? 2 : 1; // 2=BLEND_ENABLE_SEPERATE, 1=BLEND_ENABLE_ALL
                console.debug(`[MaterialConversion] Setting s_Blend = ${props.s_Blend} (hasSeparateBlend: ${hasSeparateBlend})`);

                const srcBlend = this.mapBlendFactorToLayaEnum(blendTarget.blendSrc);
                const dstBlend = this.mapBlendFactorToLayaEnum(blendTarget.blendDst);
                renderState.srcBlend = srcBlend;
                renderState.dstBlend = dstBlend;
                props.s_BlendSrc = srcBlend;
                props.s_BlendDst = dstBlend;
                console.debug(`[MaterialConversion] Set s_BlendSrc = ${srcBlend}, s_BlendDst = ${dstBlend}`);

                if (blendTarget.blendSrcAlpha !== undefined && blendTarget.blendDstAlpha !== undefined) {
                    const srcAlpha = this.mapBlendFactorToLayaEnum(blendTarget.blendSrcAlpha);
                    const dstAlpha = this.mapBlendFactorToLayaEnum(blendTarget.blendDstAlpha);
                    renderState.srcBlendAlpha = srcAlpha;
                    renderState.dstBlendAlpha = dstAlpha;
                    props.s_BlendSrcAlpha = srcAlpha;
                    props.s_BlendDstAlpha = dstAlpha;
                    console.debug(`[MaterialConversion] Set s_BlendSrcAlpha = ${srcAlpha}, s_BlendDstAlpha = ${dstAlpha}`);
                } else if (blendTarget.blendSrcAlpha !== undefined || blendTarget.blendDstAlpha !== undefined) {
                    console.warn(`[MaterialConversion] blendSrcAlpha or blendDstAlpha is set but not both, ignoring separate alpha blend`);
                }

                // 设置默认的 BlendEquation（如果没有指定，使用 Add = 0）
                if (props.s_BlendEquation === undefined) {
                    props.s_BlendEquation = 0; // Add
                }
            }
        }

        // 深度测试
        if (states.depthStencilState) {
            const depthState = states.depthStencilState;
            if (depthState.depthTest !== undefined) {
                props.s_DepthTest = depthState.depthTest ? 1 : 0;
            }
            if (depthState.depthWrite !== undefined) {
                props.s_DepthWrite = depthState.depthWrite;
            }
        }

        if (Object.keys(renderState).length > 0) {
            layaMaterial.props.renderState = renderState;
        }

        // 根据渲染状态自动设置 materialRenderMode 和 renderQueue
        this.updateMaterialRenderMode(layaMaterial);
    }

    private readEffectName(uuid: string): string | null {
        const projectRoot = this.owner.cocosProjectRoot;
        if (!projectRoot || !uuid)
            return null;

        const folder = uuid.slice(0, 2);
        const filePath = path.join(projectRoot, "library", folder, `${uuid}.json`);
        if (!fs.existsSync(filePath))
            return null;

        try {
            const content = fs.readFileSync(filePath, "utf8");
            const data = JSON.parse(content);
            if (typeof data?._name === "string" && data._name.length > 0)
                return data._name;
            if (typeof data?.name === "string" && data.name.length > 0)
                return data.name;
        }
        catch (err) {
            console.warn(`Failed to read effect asset: ${filePath}`, err);
        }
        return null;
    }

    private convertRenderStatesFromEffect(layaMaterial: any, effectUuid: string, techniqueName: string): void {
        // 查找 effect 文件
        const projectRoot = this.owner.cocosProjectRoot;
        if (!projectRoot) {
            console.warn(`[MaterialConversion] No Cocos project root found`);
            return;
        }

        let effectName: string | null = null;

        // 首先尝试从 UUID 读取 effect 文件名
        if (effectUuid) {
            effectName = this.readEffectName(effectUuid);
        }

        // 如果通过 UUID 找不到，尝试从 material 的 _cocosEffect 属性获取
        if (!effectName && layaMaterial.props._cocosEffect) {
            effectName = layaMaterial.props._cocosEffect;
            console.debug(`[MaterialConversion] Using effect name from _cocosEffect: ${effectName}`);
        }

        if (!effectName) {
            console.warn(`[MaterialConversion] Could not determine effect name (UUID: ${effectUuid}, _cocosEffect: ${layaMaterial.props._cocosEffect})`);
            return;
        }

        // 查找 effect 文件（通常在 resources 目录下）
        const effectPath = path.join(projectRoot, "assets", "resources", "shader", `${effectName}.effect`);
        if (!fs.existsSync(effectPath)) {
            // 尝试其他可能的位置
            const altPath = path.join(projectRoot, "assets", "resources", "effect", `${effectName}.effect`);
            if (fs.existsSync(altPath)) {
                console.debug(`[MaterialConversion] Found effect file at: ${altPath}`);
                this.parseBlendStateFromEffectFile(altPath, layaMaterial, techniqueName);
                return;
            }
            // 尝试在 cankao 目录下查找（用于测试）
            const cankaoPath = path.join(projectRoot, "assets", "cankao", "cocosShader", `${effectName}.effect`);
            if (fs.existsSync(cankaoPath)) {
                console.debug(`[MaterialConversion] Found effect file at: ${cankaoPath}`);
                this.parseBlendStateFromEffectFile(cankaoPath, layaMaterial, techniqueName);
                return;
            }
            console.warn(`[MaterialConversion] Effect file not found: ${effectPath}, ${altPath}, ${cankaoPath}`);
            return;
        }

        console.debug(`[MaterialConversion] Found effect file at: ${effectPath}`);
        this.parseBlendStateFromEffectFile(effectPath, layaMaterial, techniqueName);
    }

    private parseBlendStateFromEffectFile(effectPath: string, layaMaterial: any, techniqueName: string): void {
        try {
            const effectContent = fs.readFileSync(effectPath, "utf8");

            // 提取 CCEffect 块
            const effectBody = this.extractEffectBody(effectContent);
            if (!effectBody) {
                console.warn(`[MaterialConversion] No CCEffect block found in ${effectPath}`);
                return;
            }

            // 使用 js-yaml 解析
            const yaml = require("../../lib/js-yaml.js");
            const yamlData = yaml.load(effectBody);
            if (!yamlData || typeof yamlData !== "object") {
                console.warn(`[MaterialConversion] Invalid YAML structure in ${effectPath}`);
                return;
            }

            // 解析 techniques
            let techniquesArray: any[] = [];
            if (Array.isArray(yamlData.techniques)) {
                techniquesArray = yamlData.techniques;
            } else if (yamlData.techniques && typeof yamlData.techniques === "object") {
                techniquesArray = [yamlData.techniques];
            }

            // 查找匹配的 technique
            let targetTechnique: any = null;
            if (techniqueName) {
                targetTechnique = techniquesArray.find((tech: any) => tech.name === techniqueName);
            }
            if (!targetTechnique && techniquesArray.length > 0) {
                targetTechnique = techniquesArray[0]; // 使用第一个
            }

            if (!targetTechnique) {
                console.warn(`[MaterialConversion] No technique found in ${effectPath}`);
                return;
            }

            // 解析 passes
            let passesArray: any[] = [];
            if (Array.isArray(targetTechnique.passes)) {
                passesArray = targetTechnique.passes;
            } else if (targetTechnique.passes && typeof targetTechnique.passes === "object") {
                passesArray = [targetTechnique.passes];
            }

            // 使用第一个 pass 的 blendState
            if (passesArray.length > 0) {
                const pass = passesArray[0];
                console.debug(`[MaterialConversion] Parsing pass from effect file: ${effectPath}`);
                console.debug(`[MaterialConversion] Pass blendState:`, JSON.stringify(pass.blendState, null, 2));
                console.debug(`[MaterialConversion] Pass depthStencilState:`, JSON.stringify(pass.depthStencilState, null, 2));
                console.debug(`[MaterialConversion] Pass rasterizerState:`, JSON.stringify(pass.rasterizerState, null, 2));

                if (pass.blendState) {
                    console.debug(`[MaterialConversion] Converting blendState...`);
                    this.convertBlendStateFromYAML(layaMaterial, pass.blendState);
                    console.debug(`[MaterialConversion] After convertBlendStateFromYAML:`, {
                        s_Blend: layaMaterial.props.s_Blend,
                        s_BlendSrc: layaMaterial.props.s_BlendSrc,
                        s_BlendDst: layaMaterial.props.s_BlendDst,
                        s_BlendSrcAlpha: layaMaterial.props.s_BlendSrcAlpha,
                        s_BlendDstAlpha: layaMaterial.props.s_BlendDstAlpha
                    });
                } else {
                    console.warn(`[MaterialConversion] No blendState found in pass`);
                }
                if (pass.depthStencilState) {
                    this.convertDepthStencilStateFromYAML(layaMaterial, pass.depthStencilState);
                }
                if (pass.rasterizerState) {
                    this.convertRasterizerStateFromYAML(layaMaterial, pass.rasterizerState);
                }
            } else {
                console.warn(`[MaterialConversion] No passes found in technique: ${techniqueName}`);
            }
        } catch (error: any) {
            console.warn(`[MaterialConversion] Failed to parse blendState from effect file ${effectPath}:`, error.message);
        }
    }

    private extractEffectBody(content: string): string | null {
        const startMarker = "CCEffect";
        const startIndex = content.indexOf(startMarker);
        if (startIndex === -1) return null;

        let braceStart = content.indexOf("%{", startIndex);
        if (braceStart === -1) return null;

        let depth = 1;
        let i = braceStart + 2;
        while (i < content.length && depth > 0) {
            if (content.substring(i, i + 2) === "}%") {
                depth--;
                if (depth === 0) {
                    return content.substring(braceStart + 2, i).trim();
                }
            } else if (content.substring(i, i + 2) === "%{") {
                depth++;
            }
            i++;
        }

        return null;
    }

    private convertBlendStateFromYAML(layaMaterial: any, blendStateData: any): void {
        const props = layaMaterial.props;
        const renderState: any = {};

        console.debug(`[MaterialConversion] convertBlendStateFromYAML called with:`, JSON.stringify(blendStateData, null, 2));

        // 处理 targets 数组（Cocos 格式）
        if (Array.isArray(blendStateData.targets)) {
            const target = blendStateData.targets[0];
            console.debug(`[MaterialConversion] Blend target from array:`, target);
            if (target && typeof target === "object" && target.blend) {
                props.s_Blend = 1; // BLEND_ENABLE_ALL
                console.debug(`[MaterialConversion] Setting s_Blend = 1 (blend is true)`);

                // 映射混合因子（字符串到 Laya 枚举索引）
                // Laya BlendFactor 枚举: 0=Zero, 1=One, 2=SourceColor, 3=OneMinusSourceColor,
                // 4=DestinationColor, 5=OneMinusDestinationColor, 6=SourceAlpha, 7=OneMinusSourceAlpha,
                // 8=DestinationAlpha, 9=OneMinusDestinationAlpha, 10=SourceAlphaSaturate, 11=BlendColor, 12=OneMinusBlendColor
                const blendFactorMap: Record<string, number> = {
                    "src_alpha": 6,           // BlendFactor.SourceAlpha
                    "one_minus_src_alpha": 7, // BlendFactor.OneMinusSourceAlpha
                    "src_color": 2,           // BlendFactor.SourceColor
                    "one_minus_src_color": 3, // BlendFactor.OneMinusSourceColor
                    "dst_alpha": 8,           // BlendFactor.DestinationAlpha
                    "one_minus_dst_alpha": 9, // BlendFactor.OneMinusDestinationAlpha
                    "dst_color": 4,           // BlendFactor.DestinationColor
                    "one_minus_dst_color": 5, // BlendFactor.OneMinusDestinationColor
                    "one": 1,                 // BlendFactor.One
                    "zero": 0,                // BlendFactor.Zero
                    "src_alpha_saturate": 10, // BlendFactor.SourceAlphaSaturate
                };

                if (target.blendSrc) {
                    const srcFactor = typeof target.blendSrc === "string"
                        ? blendFactorMap[target.blendSrc] ?? 1
                        : this.mapBlendFactorToLayaEnum(target.blendSrc);
                    renderState.srcBlend = srcFactor;
                    props.s_BlendSrc = srcFactor;
                }
                if (target.blendDst) {
                    const dstFactor = typeof target.blendDst === "string"
                        ? blendFactorMap[target.blendDst] ?? 7
                        : this.mapBlendFactorToLayaEnum(target.blendDst);
                    renderState.dstBlend = dstFactor;
                    props.s_BlendDst = dstFactor;
                }
                if (target.blendSrcAlpha) {
                    const srcAlphaFactor = typeof target.blendSrcAlpha === "string"
                        ? blendFactorMap[target.blendSrcAlpha] ?? 6
                        : this.mapBlendFactorToLayaEnum(target.blendSrcAlpha);
                    renderState.srcBlendAlpha = srcAlphaFactor;
                    props.s_BlendSrcAlpha = srcAlphaFactor;
                }
                if (target.blendDstAlpha) {
                    const dstAlphaFactor = typeof target.blendDstAlpha === "string"
                        ? blendFactorMap[target.blendDstAlpha] ?? 7
                        : this.mapBlendFactorToLayaEnum(target.blendDstAlpha);
                    renderState.dstBlendAlpha = dstAlphaFactor;
                    props.s_BlendDstAlpha = dstAlphaFactor;
                }

                // 设置默认的 BlendEquation（如果没有指定，使用 Add = 0）
                // Laya BlendEquation: 0=Add, 1=Subtract, 2=ReverseSubtract, 3=Min, 4=Max
                if (props.s_BlendEquation === undefined) {
                    props.s_BlendEquation = 0; // Add
                }

                console.debug(`[MaterialConversion] Converted blend state:`, {
                    s_Blend: props.s_Blend,
                    s_BlendSrc: props.s_BlendSrc,
                    s_BlendDst: props.s_BlendDst,
                    s_BlendSrcAlpha: props.s_BlendSrcAlpha,
                    s_BlendDstAlpha: props.s_BlendDstAlpha,
                    s_BlendEquation: props.s_BlendEquation
                });
            } else {
                console.warn(`[MaterialConversion] Target blend is false or target is invalid:`, target);
            }
        } else {
            console.warn(`[MaterialConversion] blendStateData.targets is not an array:`, blendStateData);
        }

        if (Object.keys(renderState).length > 0) {
            layaMaterial.props.renderState = renderState;
        }

        // 根据渲染状态自动设置 materialRenderMode 和 renderQueue
        this.updateMaterialRenderMode(layaMaterial);
    }

    private convertDepthStencilStateFromYAML(layaMaterial: any, depthState: any): void {
        const props = layaMaterial.props;
        if (depthState.depthTest !== undefined) {
            // Laya s_DepthTest: 0=Never, 1=Less, 2=Equal, 3=LessEqual, 4=Greater, 5=NotEqual, 6=GreaterEqual, 7=Always, 8=Off
            // Cocos depthTest: true 通常表示 Less (1)
            props.s_DepthTest = depthState.depthTest ? 1 : 0; // 1 = Less, 0 = Never
        }
        if (depthState.depthWrite !== undefined) {
            props.s_DepthWrite = depthState.depthWrite;
        }
    }

    private convertRasterizerStateFromYAML(layaMaterial: any, rasterizerState: any): void {
        const props = layaMaterial.props;
        if (rasterizerState.cullMode !== undefined) {
            // Cocos: "none"=0, "front"=1, "back"=2
            // Laya: 0=off, 1=front, 2=back
            if (typeof rasterizerState.cullMode === "string") {
                const cullMap: Record<string, number> = {
                    "none": 0,
                    "front": 1,
                    "back": 2
                };
                props.s_Cull = cullMap[rasterizerState.cullMode] ?? 2;
            } else {
                props.s_Cull = rasterizerState.cullMode;
            }
        }
    }

    /**
     * 根据渲染状态自动设置 materialRenderMode 和 renderQueue
     * materialRenderMode: 0=OPAQUE, 1=CUTOUT, 2=TRANSPARENT, 3=ADDTIVE, 4=ALPHABLENDED, 5=CUSTOM
     * 
     * 重要：如果设置了自定义渲染状态（s_BlendSrc, s_BlendDst 等），必须设置为 CUSTOM (5) 才会生效
     */
    private updateMaterialRenderMode(layaMaterial: any): void {
        const props = layaMaterial.props;
        const s_Blend = props.s_Blend ?? 0;
        const alphaTest = props.alphaTest ?? false;
        const s_BlendSrc = props.s_BlendSrc;
        const s_BlendDst = props.s_BlendDst;
        const shaderType = props.type || "";
        const isBuiltinShader = ["BLINNPHONG", "Unlit", "PBR", "PARTICLESHURIKEN", "Trail", "SkyBox", "SkyPanoramic", "SkyProcedural", "glTFPBR"].includes(shaderType);

        // 重要：如果设置了 s_BlendSrc 或 s_BlendDst 等混合因子，必须确保 s_Blend 被正确设置
        // s_Blend: 0=BLEND_DISABLE, 1=BLEND_ENABLE_ALL, 2=BLEND_ENABLE_SEPERATE
        const hasBlendSrcOrDst = s_BlendSrc !== undefined || s_BlendDst !== undefined;
        const hasSeparateBlend = props.s_BlendSrcRGB !== undefined || props.s_BlendDstRGB !== undefined ||
            props.s_BlendSrcAlpha !== undefined || props.s_BlendDstAlpha !== undefined;

        if (hasBlendSrcOrDst && s_Blend === 0) {
            // 如果设置了混合因子但 s_Blend 还是 0，需要根据是否有分别的 RGB/Alpha 设置来决定
            if (hasSeparateBlend) {
                props.s_Blend = 2; // BLEND_ENABLE_SEPERATE
            } else {
                props.s_Blend = 1; // BLEND_ENABLE_ALL
            }
            console.debug(`[MaterialConversion] Auto-setting s_Blend to ${props.s_Blend} because blend factors are set`);
        }

        const finalBlend = props.s_Blend ?? s_Blend;

        // 优先判断：如果是标准的透明混合模式（src_alpha + one_minus_src_alpha），使用 TRANSPARENT (2)
        // 即使对于自定义 shader，标准的透明混合也可以使用 TRANSPARENT 模式
        if (finalBlend === 1 && s_BlendSrc === 6 && s_BlendDst === 7) {
            // 标准透明混合：SourceAlpha + OneMinusSourceAlpha
            // 检查是否有分别的 Alpha 混合设置
            const s_BlendSrcAlpha = props.s_BlendSrcAlpha;
            const s_BlendDstAlpha = props.s_BlendDstAlpha;

            // 如果没有分别的 Alpha 设置，或者 Alpha 设置与 RGB 相同，可以使用 TRANSPARENT 模式
            if (s_BlendSrcAlpha === undefined && s_BlendDstAlpha === undefined) {
                // 没有分别的 Alpha 设置，使用 TRANSPARENT 模式
                props.materialRenderMode = 2; // TRANSPARENT
                props.renderQueue = 3000;
                if (props.s_DepthWrite === undefined) {
                    props.s_DepthWrite = false;
                }
                console.debug(`[MaterialConversion] Using TRANSPARENT mode for standard alpha blend (src_alpha + one_minus_src_alpha)`);
                return;
            } else if (s_BlendSrcAlpha === 6 && s_BlendDstAlpha === 7) {
                // Alpha 设置与 RGB 相同，也可以使用 TRANSPARENT 模式
                props.materialRenderMode = 2; // TRANSPARENT
                props.renderQueue = 3000;
                if (props.s_DepthWrite === undefined) {
                    props.s_DepthWrite = false;
                }
                console.debug(`[MaterialConversion] Using TRANSPARENT mode for standard alpha blend with matching alpha factors`);
                return;
            }
        }

        // 判断是否有自定义渲染状态（非标准的混合模式或其他自定义设置）
        const hasCustomRenderState = hasBlendSrcOrDst || hasSeparateBlend ||
            props.s_BlendEquation !== undefined ||
            props.s_BlendEquationRGB !== undefined ||
            props.s_BlendEquationAlpha !== undefined;

        // 如果设置了自定义渲染状态，使用 CUSTOM 模式
        if (hasCustomRenderState) {
            props.materialRenderMode = 5; // CUSTOM

            // 根据混合状态设置 renderQueue
            if (finalBlend === 1 || finalBlend === 2) {
                props.renderQueue = 3000;
                // 如果 depthWrite 未设置，透明模式通常不写深度
                if (props.s_DepthWrite === undefined) {
                    props.s_DepthWrite = false;
                }
            } else if (alphaTest) {
                props.renderQueue = 2450;
            } else {
                props.renderQueue = 2000;
            }
            return;
        }

        // 如果是自定义 shader 但没有自定义渲染状态，根据混合状态和 alphaTest 设置模式
        if (!isBuiltinShader) {
            // 如果启用了混合（s_Blend = 1 或 2），需要设置为透明模式
            if (finalBlend === 1 || finalBlend === 2) {
                // 判断混合模式类型（使用 Laya 枚举索引值）
                // TRANSPARENT (Fade): s_BlendSrc = 6 (SourceAlpha), s_BlendDst = 7 (OneMinusSourceAlpha)
                if (s_BlendSrc === 6 && s_BlendDst === 7) {
                    props.materialRenderMode = 2; // TRANSPARENT
                    props.renderQueue = 3000;
                    if (props.s_DepthWrite === undefined) {
                        props.s_DepthWrite = false; // 透明模式通常不写深度
                    }
                }
                // ADDTIVE: s_BlendSrc = 1 (ONE) 或 6 (SourceAlpha), s_BlendDst = 1 (ONE)
                else if ((s_BlendSrc === 1 || s_BlendSrc === 6) && s_BlendDst === 1) {
                    props.materialRenderMode = 3; // ADDTIVE
                    props.renderQueue = 3000;
                    if (props.s_DepthWrite === undefined) {
                        props.s_DepthWrite = false;
                    }
                }
                // ALPHABLENDED: 其他混合组合
                else {
                    props.materialRenderMode = 4; // ALPHABLENDED
                    props.renderQueue = 3000;
                    if (props.s_DepthWrite === undefined) {
                        props.s_DepthWrite = false;
                    }
                }
            }
            // 如果禁用了混合
            else if (finalBlend === 0) {
                // CUTOUT: 启用了 alphaTest
                if (alphaTest) {
                    props.materialRenderMode = 1; // CUTOUT
                    props.renderQueue = 2450;
                }
                // OPAQUE: 默认不透明模式
                else {
                    props.materialRenderMode = 0; // OPAQUE
                    props.renderQueue = 2000;
                }
            }
            return;
        }

        // 内置 shader 的自动模式设置
        // 如果启用了混合（s_Blend = 1），需要设置为透明模式
        if (s_Blend === 1) {
            // 判断混合模式类型（使用 Laya 枚举索引值）
            // TRANSPARENT (Fade): s_BlendSrc = 6 (SourceAlpha), s_BlendDst = 7 (OneMinusSourceAlpha)
            if (s_BlendSrc === 6 && s_BlendDst === 7) {
                props.materialRenderMode = 2; // TRANSPARENT
                props.renderQueue = 3000;
                props.s_DepthWrite = false; // 透明模式通常不写深度
            }
            // ADDTIVE: s_BlendSrc = 1 (ONE) 或 6 (SourceAlpha), s_BlendDst = 1 (ONE)
            else if ((s_BlendSrc === 1 || s_BlendSrc === 6) && s_BlendDst === 1) {
                props.materialRenderMode = 3; // ADDTIVE
                props.renderQueue = 3000;
                props.s_DepthWrite = false;
            }
            // ALPHABLENDED: 其他混合组合
            else {
                props.materialRenderMode = 4; // ALPHABLENDED
                props.renderQueue = 3000;
                props.s_DepthWrite = false;
            }
        }
        // 如果禁用了混合
        else if (s_Blend === 0) {
            // CUTOUT: 启用了 alphaTest
            if (alphaTest) {
                props.materialRenderMode = 1; // CUTOUT
                props.renderQueue = 2450;
            }
            // OPAQUE: 默认不透明模式
            else {
                props.materialRenderMode = 0; // OPAQUE
                props.renderQueue = 2000;
            }
        }
    }

    /**
     * 将 Cocos 的混合因子映射到 Laya 的 BlendFactor 枚举索引
     * Laya BlendFactor 枚举: 0=Zero, 1=One, 2=SourceColor, 3=OneMinusSourceColor,
     * 4=DestinationColor, 5=OneMinusDestinationColor, 6=SourceAlpha, 7=OneMinusSourceAlpha,
     * 8=DestinationAlpha, 9=OneMinusDestinationAlpha, 10=SourceAlphaSaturate, 11=BlendColor, 12=OneMinusBlendColor
     */
    private mapBlendFactorToLayaEnum(cocosFactor: number | string): number {
        // 如果是字符串，先转换为数字（Cocos 可能使用字符串枚举）
        if (typeof cocosFactor === "string") {
            const stringMap: Record<string, number> = {
                "src_alpha": 6,
                "one_minus_src_alpha": 7,
                "src_color": 2,
                "one_minus_src_color": 3,
                "dst_alpha": 8,
                "one_minus_dst_alpha": 9,
                "dst_color": 4,
                "one_minus_dst_color": 5,
                "one": 1,
                "zero": 0,
                "src_alpha_saturate": 10,
            };
            return stringMap[cocosFactor] ?? 1;
        }

        // Cocos 混合因子枚举值到 Laya BlendFactor 枚举索引的映射
        // Cocos 的枚举值可能和 Laya 不同，需要映射
        const blendFactorMap: Record<number, number> = {
            0: 0,    // ZERO -> BlendFactor.Zero
            1: 1,    // ONE -> BlendFactor.One
            2: 2,    // SRC_COLOR -> BlendFactor.SourceColor
            3: 3,    // ONE_MINUS_SRC_COLOR -> BlendFactor.OneMinusSourceColor
            4: 4,    // DST_COLOR -> BlendFactor.DestinationColor
            5: 5,    // ONE_MINUS_DST_COLOR -> BlendFactor.OneMinusDestinationColor
            6: 6,    // SRC_ALPHA -> BlendFactor.SourceAlpha
            7: 7,    // ONE_MINUS_SRC_ALPHA -> BlendFactor.OneMinusSourceAlpha
            8: 8,    // DST_ALPHA -> BlendFactor.DestinationAlpha
            9: 9,    // ONE_MINUS_DST_ALPHA -> BlendFactor.OneMinusDestinationAlpha
            10: 10,  // SRC_ALPHA_SATURATE -> BlendFactor.SourceAlphaSaturate
        };
        return blendFactorMap[cocosFactor] ?? 1;
    }

    private convertMaterialProps(layaMaterial: any, cocosProps: any, defines: any, shaderUniformInfo?: { all: Set<string>, textures: Set<string>, colors: Set<string>, vectors: Set<string> }): void {
        const layaProps = layaMaterial.props;
        const textures: Array<any> = layaProps.textures;
        const shaderType = (layaProps.type || "").toString();
        const shaderTypeLower = shaderType.toLowerCase();
        const handledKeys = new Set<string>();

        console.debug(`[MaterialConversion] Converting material props. Cocos props keys:`, Object.keys(cocosProps || {}));
        console.debug(`[MaterialConversion] Shader type: ${shaderType}`);
        console.debug(`[MaterialConversion] Shader uniform info:`, shaderUniformInfo ? {
            all: Array.from(shaderUniformInfo.all),
            textures: Array.from(shaderUniformInfo.textures),
            colors: Array.from(shaderUniformInfo.colors),
            vectors: Array.from(shaderUniformInfo.vectors)
        } : "null");

        // 判断是否是 Laya 内置 shader（注意大小写要一致）
        const isBuiltinShader = (type: string): boolean => {
            const builtinShaders = ["BLINNPHONG", "Unlit", "PBR", "PARTICLESHURIKEN", "Trail", "SkyBox", "SkyPanoramic", "SkyProcedural", "glTFPBR", "StandardWithOutline", "toon_default"];
            return builtinShaders.includes(type);
        };

        // Laya 内置 shader 的 uniform 名称映射（Cocos 属性名 -> Laya uniform 名）
        // 注意：键名必须与 shader 类型完全一致（大小写敏感）
        const builtinShaderUniformMap: Record<string, Record<string, string>> = {
            "Unlit": {
                "mainTexture": "u_AlbedoTexture",
                "mainColor": "u_AlbedoColor",
                "albedoTexture": "u_AlbedoTexture",
                "albedoColor": "u_AlbedoColor",
                "baseColorTexture": "u_AlbedoTexture",
                "baseColor": "u_AlbedoColor"
            },
            "BLINNPHONG": {
                "mainTexture": "u_DiffuseTexture",
                "mainColor": "u_DiffuseColor",
                "diffuseTexture": "u_DiffuseTexture",
                "diffuseColor": "u_DiffuseColor"
            },
            "PBR": {
                "mainTexture": "u_AlbedoTexture",
                "mainColor": "u_AlbedoColor",
                "albedoTexture": "u_AlbedoTexture",
                "albedoColor": "u_AlbedoColor",
                "baseColorTexture": "u_AlbedoTexture",
                "baseColor": "u_AlbedoColor",
                "diffuseTexture": "u_AlbedoTexture",
                "diffuseColor": "u_AlbedoColor",
                "normalMap": "u_NormalTexture",
                "normalTexture": "u_NormalTexture",
                "emissiveMap": "u_EmissionTexture",
                "emissionTexture": "u_EmissionTexture",
                "emissive": "u_EmissionColor",
                "emissionColor": "u_EmissionColor",
                "roughness": "u_Smoothness",
                "metallic": "u_Metallic",
                "occlusionMap": "u_OcclusionTexture",
                "occlusionTexture": "u_OcclusionTexture",
                "tilingOffset": "u_TilingOffset",
                "alphaThreshold": "u_AlphaTestValue"
            },
            "glTFPBR": {
                "mainTexture": "u_AlbedoTexture",
                "mainColor": "u_AlbedoColor",
                "albedoTexture": "u_AlbedoTexture",
                "albedoColor": "u_AlbedoColor",
                "baseColorTexture": "u_AlbedoTexture",
                "baseColor": "u_AlbedoColor"
            },
            "PARTICLESHURIKEN": {
                "mainTexture": "u_texture",
                "mainColor": "u_Tintcolor",
                "tintColor": "u_Tintcolor",
                "tilingOffset": "u_TilingOffset",
                "alphaThreshold": "u_AlphaTestValue"
            },
            // StandardWithOutline: 自定义 PBR + Outline shader
            // uniform 名称与 shader 文件中的定义一致
            "StandardWithOutline": {
                // Cocos -> StandardWithOutline uniform mapping
                "mainTexture": "mainTexture",  // 贴图名称直接使用
                "albedoMap": "mainTexture",
                "mainColor": "mainColor",
                "albedo": "mainColor",
                "tilingOffset": "tilingOffset",
                "normalMap": "normalMap",
                "emissiveMap": "emissiveMap",
                "emissive": "emissive",
                "roughness": "roughness",  // 保持 roughness，不转换为 smoothness
                "metallic": "metallic",
                "occlusionMap": "occlusionMap",
                "alphaThreshold": "alphaThreshold",
                // Outline 参数
                "lineWidth": "lineWidth",
                "depthBias": "depthBias",
                "outlineColor": "outlineColor"
            },
            // toon_default: 预置的 Toon shader
            // Cocos toon 的 mainColor 对应 shader 中的 baseColor
            "toon_default": {
                "mainColor": "baseColor",
                "mainTexture": "mainTexture",
                "tilingOffset": "tilingOffset",
                "alphaThreshold": "alphaThreshold",
                "shadeColor1": "shadeColor1",
                "shadeColor2": "shadeColor2"
            }
        };

        // 从 shader 中查找 uniform 名称（根据 Cocos 属性名动态查找）
        // 对于内置 Shader，使用预定义的映射表
        const findUniformByName = (cocosPropName: string, uniformType: "texture" | "color" | "vector" | "any"): string | null => {
            // 首先检查是否是内置 Shader，如果是，使用预定义的映射表
            if (isBuiltinShader(shaderType)) {
                const uniformMap = builtinShaderUniformMap[shaderType];
                if (uniformMap && uniformMap[cocosPropName]) {
                    console.debug(`[MaterialConversion] Using builtin shader mapping: ${cocosPropName} -> ${uniformMap[cocosPropName]}`);
                    return uniformMap[cocosPropName];
                }
            }

            // 直接使用 Cocos 的属性名，不进行任何转换
            const originalName = cocosPropName;

            if (!shaderUniformInfo || shaderUniformInfo.all.size === 0) {
                // 如果找不到 shader 文件，直接返回原名称
                return originalName;
            }

            // 优先查找原名称
            if (shaderUniformInfo.all.has(originalName)) {
                // 检查类型是否匹配
                if (uniformType === "texture" && shaderUniformInfo.textures.has(originalName)) {
                    return originalName;
                }
                if (uniformType === "color" && shaderUniformInfo.colors.has(originalName)) {
                    return originalName;
                }
                if (uniformType === "vector" && shaderUniformInfo.vectors.has(originalName)) {
                    return originalName;
                }
                if (uniformType === "any") {
                    return originalName;
                }
            }

            // 如果原名称不存在，根据类型返回 shader 中的第一个对应类型的 uniform
            if (uniformType === "texture" && shaderUniformInfo.textures.size > 0) {
                return Array.from(shaderUniformInfo.textures)[0];
            }
            if (uniformType === "color" && shaderUniformInfo.colors.size > 0) {
                return Array.from(shaderUniformInfo.colors)[0];
            }
            if (uniformType === "vector" && shaderUniformInfo.vectors.size > 0) {
                return Array.from(shaderUniformInfo.vectors)[0];
            }

            // 如果都没有，直接返回原名称（即使 shader 中没有，也使用这个名称）
            // 这样即使 shader 中没有对应的 uniform，也会添加属性（可能是用户自定义的属性）
            return originalName;
        };

        const setColor = (key: string, value: any) => {
            layaProps[key] = this.convertColorArray(value);
        };
        const setScalar = (key: string, value: any) => {
            layaProps[key] = value;
        };
        const setVector = (key: string, value: any) => {
            layaProps[key] = this.convertVectorArray(value);
        };
        const addTexture = (name: string, uuidObj: any, define?: string) => {
            if (!uuidObj?.__uuid__)
                return;
            this.pushTexture(textures, name, uuidObj.__uuid__);

            // 如果没有传入 define，根据 uniform 名称自动生成（与 shader 生成逻辑一致）
            let defineName = define;
            if (!defineName) {
                // 对于内置 Shader，使用正确的 define 名称
                const upperName = name.toUpperCase().replace("U_", "");
                
                // 检查是否是使用 MAINTEXTURE define 的 shader（如 builtin-camera-texture 系列）
                const useMainTextureDefine = shaderType.startsWith("builtin-camera-texture") ||
                                              shaderType === "toon_default" ||
                                              shaderType === "builtin-toon_default" ||
                                              shaderType.startsWith("toon") ||
                                              shaderType.startsWith("builtin-toon");
                
                if (upperName === "ALBEDOTEXTURE") {
                    defineName = "ALBEDOTEXTURE";
                } else if (upperName === "MAINTEXTURE") {
                    // 根据 shader 类型决定使用哪个 define
                    if (useMainTextureDefine) {
                        defineName = "MAINTEXTURE";
                    } else {
                        // 对于 PBR、StandardWithOutline 等 shader，使用 ALBEDOTEXTURE
                        defineName = "ALBEDOTEXTURE";
                    }
                } else if (upperName === "DIFFUSETEXTURE") {
                    defineName = "DIFFUSEMAP";
                } else if (upperName.endsWith("TEXTURE")) {
                    defineName = upperName;
                } else if (upperName.endsWith("MAP")) {
                    // normalMap -> NORMALTEXTURE, emissiveMap -> EMISSIONTEXTURE
                    const baseName = upperName.replace("MAP", "");
                    if (baseName === "NORMAL") {
                        defineName = "NORMALTEXTURE";
                    } else if (baseName === "EMISSIVE") {
                        defineName = "EMISSIONTEXTURE";
                    } else if (baseName === "OCCLUSION") {
                        defineName = "OCCLUSIONTEXTURE";
                    } else if (baseName === "PBR") {
                        defineName = "METALLICGLOSSTEXTURE";
                    } else {
                        defineName = baseName + "TEXTURE";
                    }
                } else {
                    defineName = upperName + "TEXTURE";
                }
            }

            if (defineName) {
                this.pushDefine(layaProps.defines, defineName);
                console.debug(`[MaterialConversion] Added texture ${name} with define: ${defineName}`);
            }
        };

        // 通用的属性映射处理函数（不硬编码变量名）
        const handleProperty = (cocosPropName: string, value: any, valueType: "texture" | "color" | "vector" | "scalar" | "any") => {
            const uniformName = findUniformByName(cocosPropName, valueType === "texture" ? "texture" : valueType === "color" ? "color" : valueType === "vector" ? "vector" : "any");

            if (!uniformName) {
                console.debug(`[MaterialConversion] No uniform found for property: ${cocosPropName}`);
                return;
            }

            // 如果 shaderUniformInfo 存在且有 uniform，检查 uniform 是否存在
            // 如果 shader 中找不到对应的 uniform，仍然添加（使用默认名称），因为可能是用户自定义的属性
            // 只有在 shader 文件明确存在且能找到对应类型的 uniform 时，才进行类型匹配检查
            if (shaderUniformInfo && shaderUniformInfo.all.size > 0) {
                // 如果 shader 中有对应类型的 uniform，但找不到匹配的，尝试使用第一个同类型的 uniform
                if (valueType === "color" && shaderUniformInfo.colors.size > 0 && !shaderUniformInfo.colors.has(uniformName)) {
                    // 如果 shader 中有颜色 uniform，但当前名称不匹配，使用第一个颜色 uniform
                    const firstColor = Array.from(shaderUniformInfo.colors)[0];
                    console.debug(`[MaterialConversion] Property ${cocosPropName} uniform ${uniformName} not found in shader, using first color uniform: ${firstColor}`);
                    setColor(firstColor, value);
                    return;
                }
                if (valueType === "texture" && shaderUniformInfo.textures.size > 0 && !shaderUniformInfo.textures.has(uniformName)) {
                    // 如果 shader 中有纹理 uniform，但当前名称不匹配，使用第一个纹理 uniform
                    const firstTexture = Array.from(shaderUniformInfo.textures)[0];
                    console.debug(`[MaterialConversion] Property ${cocosPropName} uniform ${uniformName} not found in shader, using first texture uniform: ${firstTexture}`);
                    addTexture(firstTexture, value);
                    return;
                }
                // 如果 shader 中没有对应类型的 uniform，或者找到了匹配的，继续使用 uniformName
                if (!shaderUniformInfo.all.has(uniformName)) {
                    console.debug(`[MaterialConversion] Property ${cocosPropName} uniform ${uniformName} not found in shader, but adding anyway (may be custom property)`);
                }
            }

            console.debug(`[MaterialConversion] Adding property ${cocosPropName} as ${uniformName}`);

            if (valueType === "texture") {
                // 不传入 define，让 addTexture 根据 uniform 名称自动生成
                addTexture(uniformName, value);
            } else if (valueType === "color") {
                setColor(uniformName, value);
            } else if (valueType === "vector") {
                setVector(uniformName, value);
            } else if (valueType === "scalar") {
                setScalar(uniformName, value);
            } else {
                // 自动判断类型
                if (this.isTextureValue(value)) {
                    addTexture(uniformName, value);
                } else if (this.isColorValue(value)) {
                    setColor(uniformName, value);
                } else if (this.isVectorLike(value)) {
                    setVector(uniformName, value);
                } else {
                    setScalar(uniformName, value);
                }
            }
        };

        // 自动判断属性类型的辅助函数
        const inferPropertyType = (key: string, value: any): "texture" | "color" | "vector" | "scalar" | "any" => {
            // 优先根据值类型判断（最可靠）
            if (this.isTextureValue(value)) {
                return "texture";
            }
            // 注意：Vec3/Vec4 可能有 x,y,z 或 x,y,z,w，颜色有 r,g,b
            // 优先检查是否是向量类型（Vec3/Vec4），因为有些属性名包含 "color" 但实际是向量（如 colorScale）
            if (this.isVectorLike(value)) {
                // 如果值有 x,y,z 或 x,y,z,w 属性，优先判断为向量
                return "vector";
            }
            if (this.isColorValue(value)) {
                // 如果值有 r,g,b 属性，判断为颜色
                return "color";
            }

            // 如果值类型无法判断，再根据属性名推断
            const lowerKey = key.toLowerCase();

            // 纹理相关：包含 texture、map 等关键词
            if (lowerKey.includes("texture") || lowerKey.includes("map")) {
                return "texture";
            }

            // 向量相关：包含 scale、tiling、offset、position、normal 等关键词
            // 注意：scale 应该在 color 之前检查，因为 colorScale 是向量而不是颜色
            if (lowerKey.includes("scale") || lowerKey.includes("tiling") || lowerKey.includes("offset") ||
                lowerKey.includes("position") || lowerKey.includes("normal")) {
                return "vector";
            }

            // 颜色相关：包含 color、albedo、emissive 等关键词
            // 注意：这个检查应该在 scale 之后，避免 colorScale 被误判为颜色
            if (lowerKey.includes("color") || lowerKey.includes("albedo") || lowerKey.includes("emissive") || lowerKey.includes("emission")) {
                return "color";
            }

            // 默认返回 any，让 handleProperty 自动判断
            return "any";
        };

        // 统一处理所有属性（不再区分 mapped 和 unmapped）
        for (const [key, value] of Object.entries(cocosProps)) {
            if (value === undefined)
                continue;

            console.debug(`[MaterialConversion] Processing property: ${key}`);

            // 特殊处理：alphaThreshold 和 cutoff 需要设置 alphaTest
            if (key === "alphaThreshold" || key === "cutoff") {
                const uniformName = findUniformByName(key, "any");
                if (uniformName && (!shaderUniformInfo || shaderUniformInfo.all.size === 0 || shaderUniformInfo.all.has(uniformName))) {
                    const numValue = typeof value === "number" ? value : 0;
                    layaProps.alphaTest = numValue > 0;
                    setScalar(uniformName, numValue);
                }
                continue;
            }

            // 特殊处理：roughness 需要转换
            // - 对于 PBR shader：roughness -> smoothness = 1 - roughness
            // - 对于其他 shader：roughness 直接使用，同时设置 shininess = 1 - roughness
            if (key === "roughness") {
                const numValue = typeof value === "number" ? value : 0;
                const uniformName = findUniformByName(key, "any");
                
                // 检查是否映射到 u_Smoothness（PBR shader）
                if (uniformName === "u_Smoothness") {
                    // PBR shader: smoothness = 1 - roughness
                    const smoothnessValue = Math.max(0, Math.min(1, 1.0 - numValue));
                    setScalar(uniformName, smoothnessValue);
                    console.debug(`[MaterialConversion] Converting roughness ${numValue} to smoothness ${smoothnessValue}`);
                } else {
                    // 其他 shader：直接使用 roughness 值
                    const propertyType = inferPropertyType(key, value);
                    handleProperty(key, value, propertyType);
                }
                
                // 同时设置 shininess（反向关系），用于 BlinnPhong 等 shader
                const shininessUniform = findUniformByName("shininess", "any");
                if (shininessUniform && (!shaderUniformInfo || shaderUniformInfo.all.size === 0 || shaderUniformInfo.all.has(shininessUniform))) {
                    setScalar(shininessUniform, Math.max(0, Math.min(1, 1.0 - numValue)));
                }
                continue;
            }

            // 通用处理：自动判断类型并处理
            const propertyType = inferPropertyType(key, value);
            handleProperty(key, value, propertyType);
        }

        // 对于 PBR shader：如果设置了 u_EmissionColor 且颜色不是纯黑，自动添加 EMISSION define
        if (["PBR", "glTFPBR"].includes(shaderType)) {
            const emColor = layaProps["u_EmissionColor"];
            if (emColor && Array.isArray(emColor) && (emColor[0] > 0 || emColor[1] > 0 || emColor[2] > 0)) {
                this.pushDefine(layaProps.defines, "EMISSION");
                console.debug(`[MaterialConversion] 自动启用 EMISSION define（emissive 颜色非黑）`);
            }
        }

        // Cocos 宏到 Laya 宏的映射表
        const cocosToLayaDefineMap: Record<string, string> = {
            "USE_VERTEX_COLOR": "ENABLEVERTEXCOLOR",
            "USE_ALBEDO_MAP": "ALBEDOTEXTURE",
            "USE_NORMAL_MAP": "NORMALTEXTURE",
            "USE_PBR_MAP": "METALLICGLOSSTEXTURE",
            "USE_OCCLUSION_MAP": "OCCLUSIONTEXTURE",
            "USE_EMISSIVE_MAP": "EMISSIONTEXTURE"
            // 可以继续添加其他宏映射
        };

        // 处理 defines 启用的特性
        for (const [defineKey, defineValue] of Object.entries(defines)) {
            // 跳过值为 false 或 null 的 define
            if (defineValue === false || defineValue === null || defineValue === undefined)
                continue;

            // 跳过 USE_BASE_COLOR_MAP，因为当添加 mainTexture 纹理时，会自动添加 MAINTEXTURE define
            // 这是为了兼容 Cocos 的 toon shader，其中 USE_BASE_COLOR_MAP 在 Laya 中对应 MAINTEXTURE
            if (defineKey === "USE_BASE_COLOR_MAP")
                continue;

            // 特殊处理：USE_ALPHA_TEST 需要设置 alphaTest 属性
            if (defineKey === "USE_ALPHA_TEST" && defineValue === true) {
                layaProps.alphaTest = true;
                // 对于 LayaAir 内置 shader (PBR, BLINNPHONG)，使用 ALPHATEST
                // 对于自定义 shader (toon_default 等)，保持 USE_ALPHA_TEST
                const isBuiltin = ["PBR", "BLINNPHONG", "Unlit", "glTFPBR"].includes(shaderType);
                const defineName = isBuiltin ? "ALPHATEST" : this.toDefineName(defineKey);
                this.pushDefine(layaProps.defines, defineName);
                continue;
            }

            // 检查是否有 Cocos -> Laya 的宏映射
            if (cocosToLayaDefineMap[defineKey]) {
                const layaDefineName = cocosToLayaDefineMap[defineKey];
                this.pushDefine(layaProps.defines, layaDefineName);
                console.log(`[MaterialConversion] Mapped Cocos define "${defineKey}" to Laya define "${layaDefineName}"`);
                continue;
            }

            // 对于带值的 define（如 ALPHA_TEST_CHANNEL: "r"），转换为 ALPHA_TEST_CHANNEL_r 格式
            if (typeof defineValue === "string" || typeof defineValue === "number") {
                const baseDefineName = this.toDefineName(defineKey);
                // 将值转换为字符串并添加到 define 名称后面，用下划线连接
                const valueStr = String(defineValue).toLowerCase();
                const defineName = `${baseDefineName}_${valueStr}`;
                this.pushDefine(layaProps.defines, defineName);
                continue;
            }

            // 对于布尔值为 true 的 define，直接添加
            if (defineValue === true) {
                const defineName = this.toDefineName(defineKey);
                this.pushDefine(layaProps.defines, defineName);
            }
        }
    }

    private convertColorArray(cocosColor: any): number[] {
        if (typeof cocosColor === 'object') {
            // Cocos 颜色格式: {r, g, b, a} 范围 0-255 或 0-1
            const r = cocosColor.r > 1 ? cocosColor.r / 255 : cocosColor.r;
            const g = cocosColor.g > 1 ? cocosColor.g / 255 : cocosColor.g;
            const b = cocosColor.b > 1 ? cocosColor.b / 255 : cocosColor.b;
            const a = cocosColor.a !== undefined ? (cocosColor.a > 1 ? cocosColor.a / 255 : cocosColor.a) : 1;

            // 限制小数位数为最多 3 位
            const roundTo3Decimals = (value: number): number => {
                return Math.round(value * 1000) / 1000;
            };

            return [
                roundTo3Decimals(r),
                roundTo3Decimals(g),
                roundTo3Decimals(b),
                roundTo3Decimals(a)
            ];
        }
        // 默认白色
        return [1, 1, 1, 1];
    }

    private pushTexture(textures: Array<any>, name: string, cocosTextureUuid: string): void {
        // 查找纹理资源
        const textureAsset = this.owner.allAssets.get(cocosTextureUuid);
        if (!textureAsset) {
            console.warn(`Texture not found: ${cocosTextureUuid}`);
            return;
        }

        const uuid = this.mapUuid(cocosTextureUuid, textureAsset);
        let userData: any = textureAsset.userData || {};

        // Cocos stores texture properties (wrapMode, filterMode, etc.) in the subMeta (e.g. uuid@6c48a),
        // not in the top-level image asset. If the current userData doesn't have wrapModeS,
        // try to find the subMeta asset which contains the actual texture properties.
        if (!userData.wrapModeS && !userData.wrapModeU) {
            // If cocosTextureUuid doesn't contain '@', it's a top-level image UUID.
            // Try to find the subMeta by appending common subMeta suffixes.
            if (!cocosTextureUuid.includes("@")) {
                // Common Cocos texture subMeta suffixes
                const subMetaSuffixes = ["@6c48a", "@texture"];
                for (const suffix of subMetaSuffixes) {
                    const subUuid = cocosTextureUuid + suffix;
                    const subAsset = this.owner.allAssets.get(subUuid);
                    if (subAsset?.userData?.wrapModeS || subAsset?.userData?.wrapModeU) {
                        console.debug(`[MaterialConversion] Found texture properties in subMeta: ${subUuid}`);
                        userData = { ...userData, ...subAsset.userData };
                        break;
                    }
                }
            }
        }

        let width = userData.width ?? userData.imageWidth ?? userData.textureWidth ?? userData.pixelWidth ?? userData.rawWidth ?? userData.originalWidth ?? userData.originalSize?.width ?? userData.rect?.width;
        let height = userData.height ?? userData.imageHeight ?? userData.textureHeight ?? userData.pixelHeight ?? userData.rawHeight ?? userData.originalHeight ?? userData.originalSize?.height ?? userData.rect?.height;

        // 如果 Cocos 元数据中没有尺寸信息，从实际 PNG 文件头读取
        if (width === undefined || height === undefined) {
            const dims = this.readImageDimensions(textureAsset?.sourcePath);
            if (dims) {
                width = width ?? dims.width;
                height = height ?? dims.height;
                console.debug(`[MaterialConversion] 从图片文件读取尺寸: ${dims.width}x${dims.height}`);
            }
        }
        width = width ?? 1024;
        height = height ?? 1024;
        const mipmap = userData.generateMipmap ?? userData.generateMipmaps ?? userData.mipmaps ?? (userData.mipfilter ? userData.mipfilter !== "none" : false);

        const filterMode = this.mapFilterMode(userData.minfilter, userData.magFilter, userData.filterMode);
        let wrapModeU = this.mapWrapMode(userData.wrapModeS ?? userData.wrapModeU);
        let wrapModeV = this.mapWrapMode(userData.wrapModeT ?? userData.wrapModeV);
        const aniso = userData.anisotropy ?? userData.anisoLevel;

        // Cocos default wrapMode is "repeat" (0). If we couldn't determine the wrapMode,
        // default to Repeat (0) to match Cocos behavior, not LayaAir's default which may be Clamp (1).
        if (wrapModeU === undefined) {
            wrapModeU = 0; // Repeat
            console.debug(`[MaterialConversion] wrapModeU not found for texture ${name}, defaulting to Repeat (0)`);
        }
        if (wrapModeV === undefined) {
            wrapModeV = 0; // Repeat
            console.debug(`[MaterialConversion] wrapModeV not found for texture ${name}, defaulting to Repeat (0)`);
        }

        const propertyParams: any = {};
        if (filterMode !== undefined)
            propertyParams.filterMode = filterMode;
        propertyParams.wrapModeU = wrapModeU;
        propertyParams.wrapModeV = wrapModeV;
        if (aniso !== undefined)
            propertyParams.anisoLevel = aniso;

        // 判断贴图是否是颜色贴图（需要 sRGB 标记）
        // 法线贴图等非颜色贴图不需要 sRGB
        const isNonColorTexture = /normal/i.test(name) || /metallic/i.test(name) || /roughness/i.test(name) || /occlusion/i.test(name) || /ao/i.test(name);
        const sRGB = !isNonColorTexture;

        // 检查 Cocos 的 fixAlphaTransparencyArtifacts 设置（在顶层 image 资源的 userData 中）
        // 对应 LayaAir 的预乘 Alpha (pma)
        let pma = false;
        const topLevelUuid = cocosTextureUuid.includes("@") ? cocosTextureUuid.split("@")[0] : cocosTextureUuid;
        const topLevelAsset = this.owner.allAssets.get(topLevelUuid);
        if (topLevelAsset?.userData?.fixAlphaTransparencyArtifacts) {
            pma = true;
        }

        if (pma) {
            propertyParams.premultiplyAlpha = true;
        }

        const textureEntry: any = {
            path: `res://${uuid}`,
            constructParams: [width, height, 1, !!mipmap, pma, sRGB],
            name
        };

        if (Object.keys(propertyParams).length > 0)
            textureEntry.propertyParams = propertyParams;

        const existingIndex = textures.findIndex(tex => tex.name === name);
        if (existingIndex !== -1)
            textures.splice(existingIndex, 1);
        textures.push(textureEntry);
    }

    /**
     * 从图片文件头读取实际宽高（支持 PNG 和 JPG）
     */
    private readImageDimensions(sourcePath?: string): { width: number, height: number } | null {
        if (!sourcePath) return null;
        try {
            // 尝试找到实际图片文件路径（sourcePath 可能指向 .meta 或其他）
            let imgPath = sourcePath;
            if (!fs.existsSync(imgPath)) return null;

            const stat = fs.statSync(imgPath);
            if (stat.isDirectory()) return null;

            const header = Buffer.alloc(30);
            const fd = fs.openSync(imgPath, 'r');
            fs.readSync(fd, header, 0, 30, 0);
            fs.closeSync(fd);

            // PNG: signature(8) + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
            if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                const width = header.readUInt32BE(16);
                const height = header.readUInt32BE(20);
                return { width, height };
            }

            // JPEG: 需要扫描 SOF0 标记
            // 简单起见，对 JPEG 不处理，返回 null
            return null;
        } catch (e) {
            return null;
        }
    }

    private pushDefine(defines: Array<string>, define: string): void {
        if (!defines.includes(define))
            defines.push(define);
    }

    private mapFilterMode(minFilter?: string | number, magFilter?: string | number, fallback?: number): number {
        if (typeof fallback === "number")
            return fallback;

        const pick = (value?: string | number): number | undefined => {
            if (typeof value === "number")
                return value;
            switch (value) {
                case "nearest":
                case "point":
                    return 0;
                case "linear":
                case "bilinear":
                    return 1;
                case "trilinear":
                    return 2;
            }
            return undefined;
        };

        return pick(minFilter) ?? pick(magFilter) ?? 1;
    }

    private mapWrapMode(mode?: string | number): number {
        if (typeof mode === "number")
            return mode;

        switch (mode) {
            case "repeat":
            case "wrapping-repeat":
                return 0;
            case "clamp-to-edge":
            case "clamp":
                return 1;
            case "mirrored-repeat":
            case "mirror":
                return 2;
            default:
                return undefined;
        }
    }

    private mapUuid(uuid: string, asset?: { sourcePath: string, userData: any }): string {
        if (!uuid)
            return uuid;

        const internalUUID = getInternalUUID(uuid);
        if(internalUUID){
            return internalUUID;
        }

        const normalized = stripAt(uuid);
        const formatted = formatUuid(normalized, this.owner);
        if (formatted !== normalized)
            return formatted;

        const assetInfo = asset ?? this.owner.allAssets.get(normalized);
        const userData = assetInfo?.userData;
        const candidate = resolveUserDataUuid(userData);
        if (candidate)
            return stripAt(formatUuid(candidate, this.owner));

        return normalized;
    }

    private sanitizeEffectName(candidate: string): string | null {
        if (!candidate)
            return null;
        const normalized = candidate.replace(/\\/g, "/");
        const parts = normalized.split("/");
        let name = parts.pop() || "";
        if (name === "")
            name = parts.pop() || "";
        if (!name)
            return null;
        name = name.replace(/\.(effect|mtl|json)$/i, "");
        return name;
    }

    private normalizeEffectKey(name: string): string {
        return name.replace(/\\/g, "/").toLowerCase();
    }

    private toLayaTypeName(name: string): string {
        return name;
        // const parts = name.replace(/\\/g, "/").split(/[\/\-_]+/).filter(Boolean);
        // if (parts.length === 0)
        //     return "CustomMaterial";
        // return parts.map((part, index) => {
        //     if (index === 0 && part.length > 1 && part === part.toUpperCase())
        //         return part;
        //     return part.charAt(0).toUpperCase() + part.slice(1);
        // }).join("");
    }

    private toUniformName(name: string): string {
        // 保持变量名原样，不进行任何转换
        // 用户会根据 Cocos 的 shader 在 Laya 这边做对应的 shader，所以变量名不需要转换
        return name;
    }

    private toTextureUniformName(name: string): string {
        // 保持变量名原样，不进行任何转换
        // 用户会根据 Cocos 的 shader 在 Laya 这边做对应的 shader，所以变量名不需要转换
        return name;
    }

    private toDefineName(name: string): string {
        return name.replace(/[^\w]/g, "_").toUpperCase();
    }

    private isTextureValue(value: any): boolean {
        return value && typeof value === "object" && typeof value.__uuid__ === "string";
    }

    private isColorValue(value: any): boolean {
        return value && typeof value === "object" &&
            ("r" in value) && ("g" in value) && ("b" in value);
    }

    private isVectorLike(value: any): boolean {
        if (!value || typeof value !== "object")
            return false;
        const keys = ["x", "y", "z", "w"];
        return keys.some(k => k in value);
    }

    private convertVectorArray(value: any): number[] {
        if (!value || typeof value !== "object")
            return [];
        const components = [
            value.x ?? value[0],
            value.y ?? value[1],
            value.z ?? value[2],
            value.w ?? value[3]
        ];
        while (components.length > 0 && components[components.length - 1] === undefined) {
            components.pop();
        }
        return components.map(v => v ?? 0);
    }
}


function stripAt(uuid: string): string {
    const at = uuid.indexOf("@");
    return at >= 0 ? uuid.substring(0, at) : uuid;
}

function resolveUserDataUuid(userData: any): string | null {
    if (!userData || typeof userData !== "object")
        return null;
    const candidate = userData.__layaUuid ?? userData.__layaId ?? userData.__layaID;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}