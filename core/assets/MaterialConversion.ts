import fs from "fs";
import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";

export class MaterialConversion implements ICocosAssetConversion {
    constructor(private owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        try {
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
            
            console.log(`Material converted: ${sourcePath} -> ${targetPath}`);
        } catch (error) {
            console.error(`Failed to convert material ${sourcePath}:`, error);
            // 如果转换失败，至少复制原文件
            await fs.promises.copyFile(sourcePath, targetPath);
            await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", { uuid: meta.uuid });
        }
    }

    private convertMaterial(cocosMatData: any, meta: any): any {
        // 基础 LayaAir 材质结构
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
                u_AlphaTestValue: 0,
                u_AlbedoColor: [1, 1, 1, 1],
                u_MaterialSpecular: [1, 1, 1, 1],
                u_Shininess: 0.078125,
                u_TilingOffset: [1, 1, 0, 0],
                u_TransmissionRate: 0,
                u_BackDiffuse: 0,
                u_BackScale: 0,
                u_TransmissionColor: [1, 1, 1, 1],
                u_AlbedoIntensity: 1,
                u_EmissionColor: [0, 0, 0, 1],
                defines: []
            }
        };

        // 解析 Cocos 材质数据
        const technique = cocosMatData._techIdx ?? 0;
        const effectUuid = cocosMatData._effectAsset?.__uuid__ || "";
        const defines = this.normalizeDefines(cocosMatData._defines);
        const props = this.normalizeProps(cocosMatData._props);

        // 映射 Shader 名称
        const shaderInfo = this.resolveShaderInfo(effectUuid, cocosMatData, defines);
        layaMaterial.props.type = shaderInfo.type;
        if (shaderInfo.source)
            layaMaterial.props._cocosEffect = shaderInfo.source;

        // 转换渲染状态
        const states = cocosMatData._states?.[technique];
        if (states) {
            this.convertRenderStates(layaMaterial, states);
        }

        // 转换材质属性
        this.convertMaterialProps(layaMaterial, props, defines);

        return layaMaterial;
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

    private resolveShaderInfo(cocoEffectUuid: string, cocosMatData: any, defines: any): { type: string, source?: string } {
        // 获取 effect 资源信息
        const effectAsset = this.owner.allAssets.get(cocoEffectUuid);
        
        // 根据 Cocos effect 名称映射到 LayaAir shader
        // 常见的内置材质映射
        const builtinShaderMap: Record<string, string> = {
            "builtin-standard": "BLINNPHONG",
            "builtin-unlit": "Unlit",
            "builtin-toon": "Toon",
            "builtin-particle": "PARTICLESHURIKEN",
            "builtin-spine": "Spine",
            "builtin-sprite": "Sprite2D",
            "builtin-terrain": "Terrain"
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

        for (const candidate of effectCandidates) {
            const builtin = builtinShaderMap[candidate.normalized];
            if (builtin) {
                return { type: builtin, source: candidate.raw };
            }
        }

        if (effectCandidates.length > 0) {
            const first = effectCandidates[0];
            return { type: this.toLayaTypeName(first.raw), source: first.raw };
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
            // Cocos: 0=none, 1=front, 2=back
            // Laya: 0=off, 1=front, 2=back
            props.s_Cull = cullMode;
        }

        // 混合模式
        if (states.blendState?.targets?.[0]) {
            const blendTarget = states.blendState.targets[0];
            if (blendTarget.blend) {
                props.s_Blend = 1;
                renderState.srcBlend = this.mapBlendFactor(blendTarget.blendSrc);
                renderState.dstBlend = this.mapBlendFactor(blendTarget.blendDst);
                
                if (blendTarget.blendSrcAlpha !== undefined) {
                    renderState.srcBlendAlpha = this.mapBlendFactor(blendTarget.blendSrcAlpha);
                    renderState.dstBlendAlpha = this.mapBlendFactor(blendTarget.blendDstAlpha);
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
    }

    private mapBlendFactor(cocosFactor: number): number {
        // Cocos 和 LayaAir 的混合因子映射
        // 这里使用常见的映射，具体可能需要根据实际情况调整
        const blendFactorMap: Record<number, number> = {
            0: 0,    // ZERO
            1: 1,    // ONE
            2: 768,  // SRC_COLOR
            3: 769,  // ONE_MINUS_SRC_COLOR
            4: 770,  // SRC_ALPHA
            5: 771,  // ONE_MINUS_SRC_ALPHA
            6: 772,  // DST_ALPHA
            7: 773,  // ONE_MINUS_DST_ALPHA
            8: 774,  // DST_COLOR
            9: 775,  // ONE_MINUS_DST_COLOR
            10: 776, // SRC_ALPHA_SATURATE
        };
        return blendFactorMap[cocosFactor] ?? 1;
    }

    private convertMaterialProps(layaMaterial: any, cocosProps: any, defines: any): void {
        const layaProps = layaMaterial.props;
        const textures: Array<any> = layaProps.textures;
        const shaderType = (layaProps.type || "").toString().toLowerCase();
        const diffuseTextureName = shaderType === "unlit" ? "u_AlbedoTexture" : "u_DiffuseTexture";
        const handledKeys = new Set<string>();

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
            if (define)
                this.pushDefine(layaProps.defines, define);
        };

        const propertyMappings: Record<string, (value: any) => void> = {
            mainColor: (value) => setColor("u_AlbedoColor", value),
            albedo: (value) => setColor("u_AlbedoColor", value),
            baseColor: (value) => setColor("u_AlbedoColor", value),
            emissive: (value) => setColor("u_EmissionColor", value),
            emissionColor: (value) => setColor("u_EmissionColor", value),
            metallic: (value) => setVector("u_MaterialSpecular", { x: value, y: value, z: value, w: 1 }),
            roughness: (value) => {
                setScalar("u_Roughness", value);
                setScalar("u_Shininess", Math.max(0, Math.min(1, 1.0 - value)));
            },
            shininess: (value) => setScalar("u_Shininess", value),
            occlusion: (value) => setScalar("u_OcclusionIntensity", value),
            normalStrength: (value) => setScalar("u_NormalTextureIntensity", value),
            tilingOffset: (value) => setVector("u_TilingOffset", value),
            alphaThreshold: (value) => {
                layaProps.alphaTest = value > 0;
                setScalar("u_AlphaTestValue", value);
            },
            cutoff: (value) => {
                layaProps.alphaTest = value > 0;
                setScalar("u_AlphaTestValue", value);
            },
            mainTexture: (value) => addTexture(diffuseTextureName, value, "ALBEDOTEXTURE"),
            albedoMap: (value) => addTexture(diffuseTextureName, value, "ALBEDOTEXTURE"),
            baseColorMap: (value) => addTexture(diffuseTextureName, value, "ALBEDOTEXTURE"),
            diffuseMap: (value) => addTexture(diffuseTextureName, value, "ALBEDOTEXTURE"),
            normalMap: (value) => addTexture("u_NormalTexture", value, "NORMALTEXTURE"),
            emissiveMap: (value) => addTexture("u_EmissionTexture", value, "EMISSION"),
            emissionMap: (value) => addTexture("u_EmissionTexture", value, "EMISSION"),
            pbrMap: (value) => addTexture("u_SpecularTexture", value, "SPECULARTEXTURE"),
            metallicRoughnessMap: (value) => addTexture("u_SpecularTexture", value, "SPECULARTEXTURE"),
            occlusionMap: (value) => addTexture("u_OcclusionTexture", value, "OCCLUSIONTEXTURE"),
        };

        for (const [key, handler] of Object.entries(propertyMappings)) {
            if (cocosProps[key] !== undefined) {
                handler(cocosProps[key]);
                handledKeys.add(key);
            }
        }

        for (const [key, value] of Object.entries(cocosProps)) {
            if (handledKeys.has(key))
                continue;
            if (value === undefined)
                continue;
            if (this.isTextureValue(value)) {
                const name = this.toTextureUniformName(key);
                addTexture(name, value);
                continue;
            }
            if (this.isColorValue(value)) {
                setColor(this.toUniformName(key), value);
                continue;
            }
            if (this.isVectorLike(value)) {
                setVector(this.toUniformName(key), value);
                continue;
            }
            if (Array.isArray(value)) {
                layaProps[this.toUniformName(key)] = value;
                continue;
            }
            if (typeof value === "object") {
                layaProps[this.toUniformName(key)] = value;
                continue;
            }
            layaProps[this.toUniformName(key)] = value;
        }

        // 处理 defines 启用的特性
        for (const [defineKey, defineValue] of Object.entries(defines)) {
            if (!defineValue)
                continue;
            const defineName = this.toDefineName(defineKey);
            this.pushDefine(layaProps.defines, defineName);
        }
    }

    private convertColorArray(cocosColor: any): number[] {
        if (typeof cocosColor === 'object') {
            // Cocos 颜色格式: {r, g, b, a} 范围 0-255 或 0-1
            const r = cocosColor.r > 1 ? cocosColor.r / 255 : cocosColor.r;
            const g = cocosColor.g > 1 ? cocosColor.g / 255 : cocosColor.g;
            const b = cocosColor.b > 1 ? cocosColor.b / 255 : cocosColor.b;
            const a = cocosColor.a !== undefined ? (cocosColor.a > 1 ? cocosColor.a / 255 : cocosColor.a) : 1;

            return [r, g, b, a];
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
        const userData: any = textureAsset.userData || {};

        const width = userData.width ?? userData.imageWidth ?? userData.textureWidth ?? userData.pixelWidth ?? userData.rawWidth ?? userData.originalWidth ?? userData.originalSize?.width ?? userData.rect?.width ?? 1024;
        const height = userData.height ?? userData.imageHeight ?? userData.textureHeight ?? userData.pixelHeight ?? userData.rawHeight ?? userData.originalHeight ?? userData.originalSize?.height ?? userData.rect?.height ?? 1024;
        const mipmap = userData.generateMipmap ?? userData.generateMipmaps ?? userData.mipmaps ?? (userData.mipfilter ? userData.mipfilter !== "none" : false);

        const filterMode = this.mapFilterMode(userData.minfilter, userData.magFilter, userData.filterMode);
        const wrapModeU = this.mapWrapMode(userData.wrapModeS ?? userData.wrapModeU);
        const wrapModeV = this.mapWrapMode(userData.wrapModeT ?? userData.wrapModeV);
        const aniso = userData.anisotropy ?? userData.anisoLevel;

        const propertyParams: any = {};
        if (filterMode !== undefined)
            propertyParams.filterMode = filterMode;
        if (wrapModeU !== undefined)
            propertyParams.wrapModeU = wrapModeU;
        if (wrapModeV !== undefined)
            propertyParams.wrapModeV = wrapModeV;
        if (aniso !== undefined)
            propertyParams.anisoLevel = aniso;

        const textureEntry: any = {
            path: `res://${uuid}`,
            constructParams: [width, height, 1, !!mipmap, false, false],
            name
        };

        if (Object.keys(propertyParams).length > 0)
            textureEntry.propertyParams = propertyParams;

        const existingIndex = textures.findIndex(tex => tex.name === name);
        if (existingIndex !== -1)
            textures.splice(existingIndex, 1);
        textures.push(textureEntry);
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

        const normalized = stripAt(uuid);
        const formatted = formatUuid(normalized);
        if (formatted !== normalized)
            return formatted;

        const assetInfo = asset ?? this.owner.allAssets.get(normalized);
        const userData = assetInfo?.userData;
        const candidate = resolveUserDataUuid(userData);
        if (candidate)
            return stripAt(formatUuid(candidate));

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
        const parts = name.replace(/\\/g, "/").split(/[\/\-_]+/).filter(Boolean);
        if (parts.length === 0)
            return "CustomMaterial";
        return parts.map((part, index) => {
            if (index === 0 && part.length > 1 && part === part.toUpperCase())
                return part;
            return part.charAt(0).toUpperCase() + part.slice(1);
        }).join("");
    }

    private toUniformName(name: string): string {
        let trimmed = name;
        if (/^u[_A-Z]/.test(name)) {
            trimmed = name.replace(/^u[_]?/, "");
        }
        const sanitized = this.toLayaTypeName(trimmed);
        return `u_${sanitized}`;
    }

    private toTextureUniformName(name: string): string {
        let trimmed = name;
        if (/^u[_A-Z]/.test(name)) {
            trimmed = name.replace(/^u[_]?/, "");
        }
        const sanitized = this.toLayaTypeName(trimmed);
        const base = sanitized.replace(/^u_/, "");
        return `u_${base}${base.endsWith("Texture") ? "" : "Texture"}`;
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

function formatUuid(uuid: string): string {
    return uuid;
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