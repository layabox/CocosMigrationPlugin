import fs from "fs";
import path from "path";
import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import { formatUuid } from "../Utils";

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

            //console.log(`Material converted: ${sourcePath} -> ${targetPath}`);
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

        // 转换渲染状态
        const states = cocosMatData._states?.[techniqueIndex];
        if (states) {
            this.convertRenderStates(layaMaterial, states);
        }

        // 获取 shader 文件路径，读取实际的 uniform 名称
        const shaderUniformInfo = this.getShaderUniforms(shaderInfo.type);

        // 转换材质属性（传入 shader 的 uniform 信息）
        this.convertMaterialProps(layaMaterial, props, defines, shaderUniformInfo);

        return layaMaterial;
    }

    private getShaderUniforms(shaderType: string): { all: Set<string>, textures: Set<string>, colors: Set<string>, vectors: Set<string> } {
        const all = new Set<string>();
        const textures = new Set<string>();
        const colors = new Set<string>();
        const vectors = new Set<string>();
        
        if (!shaderType) {
            console.log(`[MaterialConversion] No shader type provided`);
            return { all, textures, colors, vectors };
        }
        
        // 查找 shader 文件
        const shaderAsset = this.findShaderAsset(shaderType);
        if (!shaderAsset?.sourcePath) {
            console.log(`[MaterialConversion] Shader file not found for type: ${shaderType}`);
            return { all, textures, colors, vectors };
        }
        
        console.log(`[MaterialConversion] Reading shader uniforms from: ${shaderAsset.sourcePath}`);
        
        try {
            const shaderContent = fs.readFileSync(shaderAsset.sourcePath, "utf8");
            
            // 提取 uniformMap 块（需要处理多行和嵌套的大括号）
            // 使用更健壮的方法：找到 uniformMap: { 的开始，然后找到匹配的 }
            let uniformMapStart = shaderContent.indexOf("uniformMap:");
            if (uniformMapStart === -1) {
                console.log(`[MaterialConversion] No uniformMap found in shader file`);
                return { all, textures, colors, vectors };
            }
            
            // 找到第一个 {
            let braceStart = shaderContent.indexOf("{", uniformMapStart);
            if (braceStart === -1) {
                console.log(`[MaterialConversion] No opening brace found for uniformMap`);
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
                console.log(`[MaterialConversion] No matching closing brace found for uniformMap`);
                return { all, textures, colors, vectors };
            }
            
            const uniformMapContent = shaderContent.substring(braceStart + 1, i);
            
            console.log(`[MaterialConversion] Extracted uniformMap content (first 300 chars):`, uniformMapContent.substring(0, 300));
            
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
                    
                    console.log(`[MaterialConversion] Found uniform: ${uniformName} (${uniformType})`);
                }
            }
            
            // 调试：打印解析结果
            console.log(`[MaterialConversion] Parsed uniformMap content:`, uniformMapContent.substring(0, 200));
            
            console.log(`[MaterialConversion] Total uniforms found: ${all.size} (textures: ${textures.size}, colors: ${colors.size}, vectors: ${vectors.size})`);
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
                console.log(`[MaterialConversion] Found shader file at target path: ${shaderPath}`);
                return { sourcePath: shaderPath };
            }
            
            // 也尝试在 shader 子目录中查找
            const shaderDir = path.join(targetDir, "shader");
            if (fs.existsSync(shaderDir)) {
                const shaderPathInDir = path.join(shaderDir, `${shaderType}.shader`);
                if (fs.existsSync(shaderPathInDir)) {
                    console.log(`[MaterialConversion] Found shader file in shader directory: ${shaderPathInDir}`);
                    return { sourcePath: shaderPathInDir };
                }
            }
        }
        
        console.log(`[MaterialConversion] Shader file not found for type: ${shaderType}`);
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
            "builtin-standard": "BLINNPHONG",
            "builtin-unlit": "Unlit",
            "builtin-toon": "Toon",
            "builtin-particle": "PARTICLESHURIKEN",
            "builtin-spine": "Spine",
            "builtin-sprite": "Sprite2D",
            "builtin-terrain": "Terrain",
            "builtin-pbr": "PBR",
            "builtin-trail": "Trail",
            "builtin-skybox": "SkyBox",
            "builtin-sky-panoramic": "SkyPanoramic",
            "builtin-sky-procedural": "SkyProcedural",
            "builtin-gltf-pbr": "glTFPBR"
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

        for (const candidate of effectCandidates) {
            const builtin = builtinShaderMap[candidate.normalized];
            if (builtin) {
                return { type: builtin, source: candidate.raw };
            }
        }

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

    private convertMaterialProps(layaMaterial: any, cocosProps: any, defines: any, shaderUniformInfo?: { all: Set<string>, textures: Set<string>, colors: Set<string>, vectors: Set<string> }): void {
        const layaProps = layaMaterial.props;
        const textures: Array<any> = layaProps.textures;
        const shaderType = (layaProps.type || "").toString();
        const shaderTypeLower = shaderType.toLowerCase();
        const handledKeys = new Set<string>();
        
        console.log(`[MaterialConversion] Converting material props. Cocos props keys:`, Object.keys(cocosProps || {}));
        console.log(`[MaterialConversion] Shader type: ${shaderType}`);
        console.log(`[MaterialConversion] Shader uniform info:`, shaderUniformInfo ? {
            all: Array.from(shaderUniformInfo.all),
            textures: Array.from(shaderUniformInfo.textures),
            colors: Array.from(shaderUniformInfo.colors),
            vectors: Array.from(shaderUniformInfo.vectors)
        } : "null");
        
        // 判断是否是 Laya 内置 shader（注意大小写要一致）
        const isBuiltinShader = (type: string): boolean => {
            const builtinShaders = ["BLINNPHONG", "Unlit", "PBR", "PARTICLESHURIKEN", "Trail", "SkyBox", "SkyPanoramic", "SkyProcedural", "glTFPBR"];
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
                "baseColor": "u_AlbedoColor"
            },
            "glTFPBR": {
                "mainTexture": "u_AlbedoTexture",
                "mainColor": "u_AlbedoColor",
                "albedoTexture": "u_AlbedoTexture",
                "albedoColor": "u_AlbedoColor",
                "baseColorTexture": "u_AlbedoTexture",
                "baseColor": "u_AlbedoColor"
            }
        };
        
        // 从 shader 中查找 uniform 名称（根据 Cocos 属性名动态查找）
        // 不硬编码变量名，而是根据属性名生成可能的 uniform 名称，然后在 shader 中查找
        const findUniformByName = (cocosPropName: string, uniformType: "texture" | "color" | "vector" | "any"): string | null => {
            // 如果是 Laya 内置 shader，优先使用内置 shader 的 uniform 名称映射
            if (isBuiltinShader(shaderType)) {
                // 注意：使用原始的 shaderType（大小写敏感），而不是 shaderTypeLower
                const builtinMap = builtinShaderUniformMap[shaderType];
                if (builtinMap && builtinMap[cocosPropName]) {
                    const mappedName = builtinMap[cocosPropName];
                    // 对于内置 shader，强制使用映射的名称（即使 shader 文件中找不到，因为内置 shader 的 uniform 名称是固定的）
                    console.log(`[MaterialConversion] Using builtin shader uniform mapping: ${cocosPropName} -> ${mappedName} (shader: ${shaderType})`);
                    return mappedName;
                }
            }
            // 根据 Cocos 属性名生成可能的 uniform 名称
            const possibleNames = [
                this.toUniformName(cocosPropName), // 最可能：mainColor -> u_mainColor
                this.toTextureUniformName(cocosPropName) // 如果是纹理：mainTexture -> u_mainTexture
            ];
            
            if (!shaderUniformInfo || shaderUniformInfo.all.size === 0) {
                // 如果找不到 shader 文件，返回第一个可能的名称作为默认值
                return possibleNames[0] || null;
            }
            
            // 优先查找生成的名称
            for (const name of possibleNames) {
                if (shaderUniformInfo.all.has(name)) {
                    // 检查类型是否匹配
                    if (uniformType === "texture" && shaderUniformInfo.textures.has(name)) {
                        return name;
                    }
                    if (uniformType === "color" && shaderUniformInfo.colors.has(name)) {
                        return name;
                    }
                    if (uniformType === "vector" && shaderUniformInfo.vectors.has(name)) {
                        return name;
                    }
                    if (uniformType === "any") {
                        return name;
                    }
                }
            }
            
            // 如果生成的名称都不存在，根据类型返回 shader 中的第一个对应类型的 uniform
            if (uniformType === "texture" && shaderUniformInfo.textures.size > 0) {
                return Array.from(shaderUniformInfo.textures)[0];
            }
            if (uniformType === "color" && shaderUniformInfo.colors.size > 0) {
                return Array.from(shaderUniformInfo.colors)[0];
            }
            if (uniformType === "vector" && shaderUniformInfo.vectors.size > 0) {
                return Array.from(shaderUniformInfo.vectors)[0];
            }
            
            // 如果都没有，返回第一个可能的名称作为默认值（即使 shader 中没有，也使用这个名称）
            // 这样即使 shader 中没有对应的 uniform，也会添加属性（可能是用户自定义的属性）
            return possibleNames[0] || null;
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
            if (define)
                this.pushDefine(layaProps.defines, define);
        };

        // 通用的属性映射处理函数（不硬编码变量名）
        const handleProperty = (cocosPropName: string, value: any, valueType: "texture" | "color" | "vector" | "scalar" | "any") => {
            const uniformName = findUniformByName(cocosPropName, valueType === "texture" ? "texture" : valueType === "color" ? "color" : valueType === "vector" ? "vector" : "any");
            
            if (!uniformName) {
                console.log(`[MaterialConversion] No uniform found for property: ${cocosPropName}`);
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
                    console.log(`[MaterialConversion] Property ${cocosPropName} uniform ${uniformName} not found in shader, using first color uniform: ${firstColor}`);
                    setColor(firstColor, value);
                    return;
                }
                if (valueType === "texture" && shaderUniformInfo.textures.size > 0 && !shaderUniformInfo.textures.has(uniformName)) {
                    // 如果 shader 中有纹理 uniform，但当前名称不匹配，使用第一个纹理 uniform
                    const firstTexture = Array.from(shaderUniformInfo.textures)[0];
                    console.log(`[MaterialConversion] Property ${cocosPropName} uniform ${uniformName} not found in shader, using first texture uniform: ${firstTexture}`);
                    addTexture(firstTexture, value, "ALBEDOTEXTURE");
                    return;
                }
                // 如果 shader 中没有对应类型的 uniform，或者找到了匹配的，继续使用 uniformName
                if (!shaderUniformInfo.all.has(uniformName)) {
                    console.log(`[MaterialConversion] Property ${cocosPropName} uniform ${uniformName} not found in shader, but adding anyway (may be custom property)`);
                }
            }
            
            console.log(`[MaterialConversion] Adding property ${cocosPropName} as ${uniformName}`);
            
            if (valueType === "texture") {
                addTexture(uniformName, value, "ALBEDOTEXTURE");
            } else if (valueType === "color") {
                setColor(uniformName, value);
            } else if (valueType === "vector") {
                setVector(uniformName, value);
            } else if (valueType === "scalar") {
                setScalar(uniformName, value);
            } else {
                // 自动判断类型
                if (this.isTextureValue(value)) {
                    addTexture(uniformName, value, "ALBEDOTEXTURE");
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
            // 特殊属性名判断（基于命名规则，不硬编码具体名称）
            const lowerKey = key.toLowerCase();
            
            // 纹理相关：包含 texture、map 等关键词
            if (lowerKey.includes("texture") || lowerKey.includes("map")) {
                return "texture";
            }
            
            // 颜色相关：包含 color、albedo、emissive 等关键词
            if (lowerKey.includes("color") || lowerKey.includes("albedo") || lowerKey.includes("emissive") || lowerKey.includes("emission")) {
                return "color";
            }
            
            // 向量相关：包含 tiling、offset、position、normal 等关键词
            if (lowerKey.includes("tiling") || lowerKey.includes("offset") || lowerKey.includes("position") || lowerKey.includes("normal")) {
                return "vector";
            }
            
            // 根据值类型判断
            if (this.isTextureValue(value)) {
                return "texture";
            }
            if (this.isColorValue(value)) {
                return "color";
            }
            if (this.isVectorLike(value)) {
                return "vector";
            }
            
            // 默认返回 any，让 handleProperty 自动判断
            return "any";
        };

        // 统一处理所有属性（不再区分 mapped 和 unmapped）
        for (const [key, value] of Object.entries(cocosProps)) {
            if (value === undefined)
                continue;
            
            console.log(`[MaterialConversion] Processing property: ${key}`);
            
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
            
            // 特殊处理：roughness 和 shininess 是反向关系
            if (key === "roughness") {
                const propertyType = inferPropertyType(key, value);
                handleProperty(key, value, propertyType);
                // 同时设置 shininess（反向关系）
                const shininessUniform = findUniformByName("shininess", "any");
                if (shininessUniform && (!shaderUniformInfo || shaderUniformInfo.all.size === 0 || shaderUniformInfo.all.has(shininessUniform))) {
                    const numValue = typeof value === "number" ? value : 0;
                    setScalar(shininessUniform, Math.max(0, Math.min(1, 1.0 - numValue)));
                }
                continue;
            }
            
            // 通用处理：自动判断类型并处理
            const propertyType = inferPropertyType(key, value);
            handleProperty(key, value, propertyType);
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