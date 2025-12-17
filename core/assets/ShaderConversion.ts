import fs from "fs";
import fpath from "path";

import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";

// 直接使用 require 加载 js-yaml
const yaml = require("../../lib/js-yaml.js");

// 已移除 PROPERTY_TYPE_MAP 和 PROPERTY_UNIFORM_NAME_MAP，改为完全动态推断
// 所有变量名通过 ensureUniformName 函数动态转换为 uniform 名称
// 所有类型通过命名规则和值类型自动推断

// Cocos 到 Laya 的 API 映射（已禁用，保持变量名原样）
// 用户会根据 Cocos 的 shader 在 Laya 这边做对应的 shader，所以变量名不需要转换
// const COCOS_TO_LAYA_API_MAP: Record<string, string> = {
//     // 顶点着色器
//     "CCVertInput": "getVertexParams",
//     "CCGetWorldMatrix": "getWorldMatrix",
//     "CCGetWorldMatrixFull": "getWorldMatrix",
//     "cc_matViewProj": "getPositionCS",
//     "a_position": "vertex.positionOS",
//     "a_texCoord": "vertex.texCoord0",
//     "a_normal": "vertex.normalOS",
//     "a_color": "vertex.vertexColor",
//     // 片段着色器
//     "CCFragOutput": "outputTransform",
//     "texture(": "texture2D(",
//     "cc_time": "u_Time",
//     "cc_cameraPos": "u_CameraPos",
//     "cc_ambientSky": "diffuseIrradiance",
//     // 输入输出
//     "in ": "varying ",
//     "out ": "varying ",
// };

// 渲染状态映射
const BLEND_FACTOR_MAP: Record<string, string> = {
    "src_alpha": "BlendFactor.SourceAlpha",
    "one_minus_src_alpha": "BlendFactor.OneMinusSourceAlpha",
    "src_color": "BlendFactor.SourceColor",
    "one_minus_src_color": "BlendFactor.OneMinusSourceColor",
    "dst_alpha": "BlendFactor.DestAlpha",
    "one_minus_dst_alpha": "BlendFactor.OneMinusDestAlpha",
    "dst_color": "BlendFactor.DestColor",
    "one_minus_dst_color": "BlendFactor.OneMinusDestColor",
    "one": "BlendFactor.One",
    "zero": "BlendFactor.Zero",
};

const CULL_MODE_MAP: Record<string, string> = {
    "none": "CullMode.Off",
    "front": "CullMode.Front",
    "back": "CullMode.Back",
};

interface ShaderPass {
    vert?: string;
    frag?: string;
    blendState?: any;
    depthStencilState?: any;
    rasterizerState?: any;
    properties?: any;
}

interface Technique {
    name: string;
    passes: ShaderPass[];
}

export class ShaderConversion implements ICocosAssetConversion {
    constructor(private readonly _owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        const ext = fpath.extname(sourcePath).toLowerCase();
        if (ext === ".effect") {
            await this.convertEffect(sourcePath, targetPath, meta);
        }
    }

    private async convertEffect(sourcePath: string, targetPath: string, meta: any) {
        const effectContent = await fs.promises.readFile(sourcePath, "utf8");
        const shaderName = fpath.basename(sourcePath, ".effect");

        // 提取 CCEffect 块（使用字符串方法，不用正则）
        const effectBody = extractEffectBody(effectContent);
        if (!effectBody) {
            console.warn(`[ShaderConversion] No CCEffect block found in ${shaderName}.effect`);
            return;
        }

        // 提取 CCProgram 块（使用字符串方法，不用正则）
        const programs = extractCCPrograms(effectContent);

        // 使用 js-yaml 解析器解析 effect body
        let yamlData: any;
        try {
            yamlData = yaml.load(effectBody);
            console.log(`[ShaderConversion] Successfully parsed YAML for ${shaderName}.effect`);
        } catch (error: any) {
            //console.error(`[ShaderConversion] Failed to parse YAML: ${error.message}`);
            //console.error(`[ShaderConversion] Error stack: ${error.stack}`);
            return;
        }

        if (!yamlData || typeof yamlData !== "object") {
            console.warn(`[ShaderConversion] Invalid YAML structure in ${shaderName}.effect`);
            return;
        }

        // 解析 techniques
        const techniques = parseTechniquesFromYAML(yamlData);
        console.log(`[ShaderConversion] Parsed ${techniques.length} techniques from ${shaderName}.effect`);
        if (techniques.length > 0) {
            console.log(`[ShaderConversion] Techniques: ${techniques.map(t => t.name).join(", ")}`);
            for (const tech of techniques) {
                console.log(`[ShaderConversion]   - ${tech.name}: ${tech.passes.length} passes`);
                for (const pass of tech.passes) {
                    console.log(`[ShaderConversion]     - pass: vert=${pass.vert || "none"}, frag=${pass.frag || "none"}`);
                }
            }
        }

        // 辅助函数：为单个 technique 收集 properties（严格只从 Cocos properties 中读取）
        const collectTechniqueProperties = (technique: Technique): Map<string, string> => {
            const techniqueUniforms = new Map<string, string>();
            const techniqueDefines = new Set<string>();

            // 严格只从 technique 的 passes 的 properties 中收集，不从代码中提取
            for (const pass of technique.passes) {
                if (pass.properties && typeof pass.properties === "object") {
                    extractPropertiesFromYAML(pass.properties, techniqueUniforms, techniqueDefines);
                }
            }

            return techniqueUniforms;
        };

        // 辅助函数：为单个 technique 建立 variableToUniformMap（严格只从 properties 中读取）
        const buildVariableToUniformMap = (technique: Technique, techniqueUniforms: Map<string, string>): Map<string, string> => {
            const variableToUniformMap = new Map<string, string>();

            // 严格只从 technique 的 properties 中收集原始变量名
            for (const pass of technique.passes) {
                if (pass.properties && typeof pass.properties === "object") {
                    for (const [propertyName] of Object.entries(pass.properties)) {
                        const uniformName = ensureUniformName(propertyName);
                        variableToUniformMap.set(propertyName, uniformName);
                        // 也支持直接使用 uniformName（如果代码中已经使用了 u_ 前缀）
                        variableToUniformMap.set(uniformName, uniformName);
                        // 如果 uniformName 有 u_ 前缀，也建立反向映射
                        if (uniformName.startsWith("u_")) {
                            const originalName = uniformName.substring(2);
                            variableToUniformMap.set(originalName, uniformName);
                        }
                    }
                }
            }

            return variableToUniformMap;
        };

        // 获取 assets 路径（用于检查 cc-internal/shaders 目录）
        let assetsPath: string | undefined = undefined;
        if (typeof EditorEnv !== "undefined" && EditorEnv.assetsPath) {
            assetsPath = EditorEnv.assetsPath;
        } else {
            // 如果无法获取 EditorEnv，尝试从 targetPath 推断
            let currentPath = targetPath;
            while (currentPath && !currentPath.endsWith("assets")) {
                const parent = fpath.dirname(currentPath);
                if (parent === currentPath) break; // 到达根目录
                currentPath = parent;
            }
            if (currentPath.endsWith("assets")) {
                assetsPath = currentPath;
            }
        }

        // 检查 shader 是否已存在的辅助函数
        const checkShaderExists = (shaderFileName: string): boolean => {
            if (!assetsPath) return false;
            const internalShaderPath = fpath.join(assetsPath, "cc-internal", "shaders", shaderFileName);
            return fs.existsSync(internalShaderPath);
        };

        // 为每个 technique 生成一个独立的 shader 文件
        // 始终使用 原文件名_technique名称.shader 的格式，即使只有一个 technique
        if (techniques.length === 0) {
            // 如果没有 techniques，生成一个默认的
            const defaultTechniqueName = "default";
            const shaderFileName = `${shaderName}_${defaultTechniqueName}.shader`;
            
            // 检查是否已存在
            if (checkShaderExists(shaderFileName)) {
                console.log(`[ShaderConversion] Shader already exists in cc-internal/shaders, skipping: ${shaderFileName}`);
                return;
            }

            console.log(`[ShaderConversion] No techniques found, generating default shader: ${shaderFileName}`);
            const techniqueShaderName = `${shaderName}_${defaultTechniqueName}`;
            const defaultUniforms = new Map<string, string>();
            const defaultDefines = new Set<string>();
            const defaultVariableMap = new Map<string, string>();
            const shaderContent = composeShader(techniqueShaderName, defaultUniforms, defaultDefines, programs, [], defaultVariableMap);

            const basePath = fpath.dirname(targetPath);
            const shaderPath = fpath.join(basePath, shaderFileName);

            await fs.promises.writeFile(shaderPath, shaderContent, "utf8");
            const techniqueUuid = meta?.uuid ? `${meta.uuid}_${defaultTechniqueName}` : undefined;
            await writeMeta(shaderPath + ".meta", techniqueUuid);
        } else {
            // 为每个 technique 生成独立的文件，始终使用 原文件名_technique名称.shader 格式
            console.log(`[ShaderConversion] Generating ${techniques.length} shader file(s) for ${techniques.length} technique(s)`);
            for (const technique of techniques) {
                const techniqueName = technique.name || "default";
                const shaderFileName = `${shaderName}_${techniqueName}.shader`;

                // 检查是否已存在
                if (checkShaderExists(shaderFileName)) {
                    console.log(`[ShaderConversion] Shader already exists in cc-internal/shaders, skipping: ${shaderFileName}`);
                    continue;
                }

                const techniqueShaderName = `${shaderName}_${techniqueName}`;
                console.log(`[ShaderConversion] Generating shader for technique: ${techniqueName}`);

                // 为这个 technique 单独收集 properties（严格只从 Cocos properties 中读取）
                const techniqueUniforms = collectTechniqueProperties(technique);
                const techniqueDefines = new Set<string>();

                // 从 technique 的 passes 的 properties 中收集 defines（严格只从 Cocos 数据中读取）
                for (const pass of technique.passes) {
                    if (pass.properties && typeof pass.properties === "object") {
                        for (const [propertyName, propertyData] of Object.entries(pass.properties)) {
                            const prop = propertyData as any;
                            if (prop.editor && typeof prop.editor === "object" && prop.editor.parent) {
                                techniqueDefines.add(prop.editor.parent);
                            } else if (prop.define) {
                                techniqueDefines.add(prop.define);
                            }
                        }
                    }
                }

                // 为这个 technique 建立 variableToUniformMap（严格只从 properties 中读取）
                const variableToUniformMap = buildVariableToUniformMap(technique, techniqueUniforms);

                // 为这个 technique 生成 shader 内容
                const shaderContent = composeShader(techniqueShaderName, techniqueUniforms, techniqueDefines, programs, [technique], variableToUniformMap);

                // 生成文件路径：原文件名_technique名称.shader
                const basePath = fpath.dirname(targetPath);
                const shaderPath = fpath.join(basePath, shaderFileName);

                console.log(`[ShaderConversion] Writing shader file: ${shaderPath}`);
                console.log(`[ShaderConversion] Technique ${techniqueName} uniforms:`, Array.from(techniqueUniforms.keys()));
                await fs.promises.writeFile(shaderPath, shaderContent, "utf8");
                console.log(`[ShaderConversion] Successfully created: ${shaderFileName}`);

                // 为每个 shader 文件生成 meta
                const techniqueUuid = meta?.uuid ? `${meta.uuid}_${techniqueName}` : undefined;
                await writeMeta(shaderPath + ".meta", techniqueUuid);
            }
        }
    }
}

// 提取 CCEffect 块（使用字符串方法，不用正则）
function extractEffectBody(content: string): string | null {
    const startMarker = "CCEffect";
    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) return null;

    // 查找 %{ 的开始位置
    let braceStart = content.indexOf("%{", startIndex);
    if (braceStart === -1) return null;

    // 查找对应的 }% 结束位置（注意是 }% 而不是 %}）
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

// 提取 CCProgram 块（使用字符串方法，不用正则）
function extractCCPrograms(content: string): Map<string, string> {
    const programs = new Map<string, string>();
    const startMarker = "CCProgram";
    let searchIndex = 0;

    while (true) {
        const programStart = content.indexOf(startMarker, searchIndex);
        if (programStart === -1) break;

        // 查找程序名称（CCProgram 后面的标识符）
        let nameStart = programStart + startMarker.length;
        while (nameStart < content.length && /\s/.test(content[nameStart])) {
            nameStart++;
        }
        let nameEnd = nameStart;
        while (nameEnd < content.length && /[A-Za-z0-9_-]/.test(content[nameEnd])) {
            nameEnd++;
        }
        const programName = content.substring(nameStart, nameEnd).trim();

        // 查找 %{ 的开始位置
        let braceStart = content.indexOf("%{", nameEnd);
        if (braceStart === -1) {
            searchIndex = nameEnd;
            continue;
        }

        // 查找对应的 }% 结束位置（注意是 }% 而不是 %}）
        let depth = 1;
        let i = braceStart + 2;
        while (i < content.length && depth > 0) {
            if (content.substring(i, i + 2) === "}%") {
                depth--;
                if (depth === 0) {
                    const programBody = content.substring(braceStart + 2, i).trim();
                    programs.set(programName, programBody);
                    searchIndex = i + 2;
                    break;
                }
            } else if (content.substring(i, i + 2) === "%{") {
                depth++;
            }
            i++;
        }

        if (depth > 0) {
            // 没有找到匹配的结束标记
            searchIndex = braceStart + 2;
        }
    }

    return programs;
}

// 从 YAML 数据解析 techniques
function parseTechniquesFromYAML(yamlData: any): Technique[] {
    const techniques: Technique[] = [];

    if (!yamlData || typeof yamlData !== "object") {
        return techniques;
    }

    // 获取 techniques 数组
    let techniquesArray: any[] = [];
    if (Array.isArray(yamlData.techniques)) {
        techniquesArray = yamlData.techniques;
    } else if (yamlData.techniques && typeof yamlData.techniques === "object") {
        techniquesArray = [yamlData.techniques];
    }

    for (const tech of techniquesArray) {
        if (!tech || typeof tech !== "object") continue;

        const technique: Technique = {
            name: tech.name || "default",
            passes: []
        };

        // 解析 passes
        let passesArray: any[] = [];
        if (Array.isArray(tech.passes)) {
            passesArray = tech.passes;
        } else if (tech.passes && typeof tech.passes === "object") {
            passesArray = [tech.passes];
        }

        for (const passData of passesArray) {
            if (!passData || typeof passData !== "object") continue;

            const pass: ShaderPass = {};

            // 解析 vert 和 frag
            if (typeof passData.vert === "string") {
                // vert: hello-vert:vert -> 提取 hello-vert
                pass.vert = passData.vert.split(":")[0].trim();
            }
            if (typeof passData.frag === "string") {
                // frag: hello-frag:frag -> 提取 hello-frag
                pass.frag = passData.frag.split(":")[0].trim();
            }

            // 解析 blendState
            if (passData.blendState && typeof passData.blendState === "object") {
                pass.blendState = parseBlendStateFromYAML(passData.blendState);
            }

            // 解析 depthStencilState
            if (passData.depthStencilState && typeof passData.depthStencilState === "object") {
                pass.depthStencilState = passData.depthStencilState;
            }

            // 解析 rasterizerState
            if (passData.rasterizerState && typeof passData.rasterizerState === "object") {
                pass.rasterizerState = passData.rasterizerState;
            }

            // 解析 properties（可能被引用）
            if (passData.properties && typeof passData.properties === "object") {
                pass.properties = passData.properties;
            }

            technique.passes.push(pass);
        }

        techniques.push(technique);
    }

    return techniques;
}

// 从 YAML 对象解析 blendState
function parseBlendStateFromYAML(blendStateData: any): any {
    const blendState: any = { blend: false };

    // 处理 targets 数组（Cocos 格式）
    if (Array.isArray(blendStateData.targets)) {
        const target = blendStateData.targets[0];
        if (target && typeof target === "object") {
            blendState.blend = target.blend === true;
            if (target.blendSrc) {
                blendState.blendSrc = BLEND_FACTOR_MAP[target.blendSrc] || target.blendSrc;
            }
            if (target.blendDst) {
                blendState.blendDst = BLEND_FACTOR_MAP[target.blendDst] || target.blendDst;
            }
            if (target.blendSrcAlpha) {
                blendState.blendSrcAlpha = BLEND_FACTOR_MAP[target.blendSrcAlpha] || target.blendSrcAlpha;
            }
            if (target.blendDstAlpha) {
                blendState.blendDstAlpha = BLEND_FACTOR_MAP[target.blendDstAlpha] || target.blendDstAlpha;
            }
        }
    } else if (typeof blendStateData === "object") {
        // 直接是对象格式
        blendState.blend = blendStateData.blend === true;
        if (blendStateData.blendSrc) {
            blendState.blendSrc = BLEND_FACTOR_MAP[blendStateData.blendSrc] || blendStateData.blendSrc;
        }
        if (blendStateData.blendDst) {
            blendState.blendDst = BLEND_FACTOR_MAP[blendStateData.blendDst] || blendStateData.blendDst;
        }
        if (blendStateData.blendSrcAlpha) {
            blendState.blendSrcAlpha = BLEND_FACTOR_MAP[blendStateData.blendSrcAlpha] || blendStateData.blendSrcAlpha;
        }
        if (blendStateData.blendDstAlpha) {
            blendState.blendDstAlpha = BLEND_FACTOR_MAP[blendStateData.blendDstAlpha] || blendStateData.blendDstAlpha;
        }
    }

    return blendState;
}

// 从 YAML 数据收集所有 properties
function collectPropertiesFromYAML(yamlData: any, defineCollector: Set<string>): Map<string, string> {
    const result = new Map<string, string>();

    if (!yamlData || typeof yamlData !== "object") {
        return result;
    }

    // 获取 techniques 数组
    let techniquesArray: any[] = [];
    if (Array.isArray(yamlData.techniques)) {
        techniquesArray = yamlData.techniques;
    } else if (yamlData.techniques && typeof yamlData.techniques === "object") {
        techniquesArray = [yamlData.techniques];
    }

    // 遍历所有 techniques 和 passes，收集 properties
    for (const tech of techniquesArray) {
        if (!tech || typeof tech !== "object") continue;

        let passesArray: any[] = [];
        if (Array.isArray(tech.passes)) {
            passesArray = tech.passes;
        } else if (tech.passes && typeof tech.passes === "object") {
            passesArray = [tech.passes];
        }

        for (const pass of passesArray) {
            if (!pass || typeof pass !== "object") continue;

            if (pass.properties && typeof pass.properties === "object") {
                extractPropertiesFromYAML(pass.properties, result, defineCollector);
            }
        }
    }

    return result;
}

// 从 YAML 对象中提取 properties
function extractPropertiesFromYAML(properties: any, result: Map<string, string>, defineCollector: Set<string>): void {
    for (const [propertyName, propertyData] of Object.entries(properties)) {
        if (!propertyData || typeof propertyData !== "object") continue;

        const prop = propertyData as any;

        // 提取 value
        let rawValue: string | undefined;
        if (prop.value !== undefined) {
            if (Array.isArray(prop.value)) {
                // 如果是数组，格式化数值（限制小数位数为最多 3 位）
                const formattedValues = prop.value.map((v: any) => {
                    if (typeof v === "number") {
                        // 限制小数位数为最多 3 位
                        const rounded = Math.round(v * 1000) / 1000;
                        // 如果是整数，不显示小数点；否则最多显示 3 位小数
                        return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(3).replace(/\.?0+$/, "");
                    }
                    return String(v);
                });
                rawValue = `[${formattedValues.join(", ")}]`;
            } else if (typeof prop.value === "object") {
                rawValue = JSON.stringify(prop.value);
            } else {
                rawValue = String(prop.value);
            }
        }

        // 提取 define（从 editor 中）
        if (prop.editor && typeof prop.editor === "object") {
            if (prop.editor.parent) {
                defineCollector.add(prop.editor.parent);
            }
        } else if (prop.define) {
            defineCollector.add(prop.define);
        }

        // 确定类型（优先级：editor.type > 名称推断 > 值推断）
        // 完全基于命名规则和值类型自动推断，不依赖硬编码的变量名映射
        const uniformName = ensureUniformName(propertyName);
        if (!result.has(uniformName)) {
            let type: string | null = null;

            // 1. 最优先：检查 editor.type（最可靠，不依赖变量名）
            if (prop.editor && typeof prop.editor === "object" && prop.editor.type) {
                if (prop.editor.type === "color") {
                    type = "Color";
                } else if (prop.editor.type === "texture") {
                    type = "Texture2D";
                }
                // 其他 editor.type 可以在这里扩展
            }

            // 2. 根据变量名推断（通用规则，不依赖具体名字）
            if (!type) {
                type = inferUniformType(propertyName, rawValue);
            }

            if (type) {
                result.set(uniformName, type);
            }
        }
    }
}

// 从 GLSL 代码中提取 uniform blocks 中的变量
function extractUniformsFromCode(code: string, uniforms: Map<string, string>): void {
    // 使用简单的字符串查找，不用正则
    let searchIndex = 0;

    while (true) {
        const uniformIndex = code.indexOf("uniform", searchIndex);
        if (uniformIndex === -1) break;

        // 查找 uniform 关键字后的内容
        let endIndex = code.indexOf(";", uniformIndex);
        if (endIndex === -1) {
            searchIndex = uniformIndex + 7;
            continue;
        }

        const uniformLine = code.substring(uniformIndex, endIndex).trim();

        // 检查是否是 uniform block（如 uniform Constant { ... }）
        const blockStart = uniformLine.indexOf("{");
        if (blockStart !== -1) {
            // 这是一个 uniform block，需要找到对应的 }
            // 查找匹配的右大括号
            let blockEnd = uniformIndex + blockStart + 1;
            let depth = 1;
            while (blockEnd < code.length && depth > 0) {
                if (code[blockEnd] === "{") depth++;
                if (code[blockEnd] === "}") depth--;
                if (depth === 0) break;
                blockEnd++;
            }

            if (depth === 0) {
                const blockBody = code.substring(uniformIndex + blockStart + 1, blockEnd);
                // 解析 block 中的变量
                const vars = blockBody.split(";").filter(v => v.trim());
                for (const v of vars) {
                    const trimmed = v.trim();
                    if (!trimmed) continue;
                    const parts = trimmed.split(/\s+/).filter(p => p.length > 0);
                    if (parts.length >= 2) {
                        const type = parts[0];
                        const name = parts[1].split(/[,\[]/)[0].trim();
                        if (name) {
                            const uniformName = ensureUniformName(name);
                            const layaType = mapGLSLTypeToLaya(type);
                            if (layaType && !uniforms.has(uniformName)) {
                                uniforms.set(uniformName, layaType);
                                console.log(`[ShaderConversion] Extracted uniform from block: ${uniformName} (${layaType})`);
                            }
                        }
                    }
                }
                searchIndex = blockEnd + 1;
            } else {
                searchIndex = endIndex + 1;
            }
        } else {
            // 单独的 uniform 声明
            const parts = uniformLine.split(/\s+/).filter(p => p.length > 0);
            if (parts.length >= 3) {
                const type = parts[1];
                const name = parts[2].split(/[,\[]/)[0].trim();
                if (type === "sampler2D" || type === "samplerCube") {
                    searchIndex = endIndex + 1;
                    continue;
                }
                if (name) {
                    const uniformName = ensureUniformName(name);
                    const layaType = mapGLSLTypeToLaya(type);
                    if (layaType && !uniforms.has(uniformName)) {
                        uniforms.set(uniformName, layaType);
                    }
                }
            }
            searchIndex = endIndex + 1;
        }
    }
}

// 映射 GLSL 类型到 Laya 类型
function mapGLSLTypeToLaya(type: string): string | null {
    if (type === "vec2") return "Vector2";
    if (type === "vec3") return "Vector3";
    if (type === "vec4") return "Vector4";
    if (type === "float") return "Float";
    if (type === "int") return "Int";
    if (type === "bool") return "Bool";
    return null;
}

// 转换 Cocos GLSL 代码到 Laya 格式
function convertGLSLCode(code: string, isVertex: boolean, variableToUniformMap?: Map<string, string>): string {
    // 提取自定义 varying 变量（out/in -> varying）
    const varyingVars: string[] = [];
    const varyingRegex = /(out|in)\s+(\w+)\s+(\w+)\s*;/g;
    let match;
    while ((match = varyingRegex.exec(code)) !== null) {
        const type = match[2];
        const name = match[3];
        // 跳过标准变量，只保留自定义的
        if (name !== "v_position" && name !== "v_texcoord" && name !== "v_color") {
            // 如果 v_uv 声明为 vec3 但实际只使用 xy 分量，改为 vec2
            if (name === "v_uv" && type === "vec3") {
                // 检查代码中是否只使用了 xy 分量
                const codeAfter = code.substring(code.indexOf(match[0]) + match[0].length);
                if (codeAfter.match(/v_uv\.xy/g) && !codeAfter.match(/v_uv\.z/g) && !codeAfter.match(/v_uv\.rgb/g)) {
                    varyingVars.push(`    varying vec2 ${name};`);
                } else {
                    varyingVars.push(`    varying ${type} ${name};`);
                }
            } else {
                varyingVars.push(`    varying ${type} ${name};`);
            }
        }
    }

    // 提取函数体内容（从 vert() 或 frag() 函数中）
    let functionBody = "";
    let originalFunctionBody = ""; // 保存原始函数体，用于提取 tiling/offset 计算
    const vertMatch = code.match(/vec4\s+vert\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
    const fragMatch = code.match(/vec4\s+frag\s*\([^)]*\)\s*\{([\s\S]*?)\}/);

    if (isVertex && vertMatch) {
        functionBody = vertMatch[1].trim();
        originalFunctionBody = functionBody; // 保存原始内容
    } else if (!isVertex && fragMatch) {
        functionBody = fragMatch[1].trim();
        originalFunctionBody = functionBody; // 保存原始内容
    }

    // 处理顶点着色器
    if (isVertex) {
        // 提取自定义逻辑（移除 Cocos 标准代码）
        let customLogic = functionBody
            .replace(/\/\/.*$/gm, "") // 移除注释
            .replace(/StandardVertInput\s+\w+\s*;/g, "")
            .replace(/CCVertInput\s*\([^)]+\)\s*;/g, "")
            .replace(/CCGetWorldMatrixFull\s*\([^)]+\)\s*;/g, "")
            .replace(/mat4\s+matWorld[^;]*;/g, "")
            .replace(/mat4\s+matWorldIT[^;]*;/g, "")
            .replace(/In\.position/g, "vertex.positionOS")
            .replace(/In\.normal/g, "vertex.normalOS")
            .replace(/In\.texCoord/g, "vertex.texCoord0")
            .replace(/In\.color/g, "vertex.vertexColor")
            .replace(/a_texCoord/g, "vertex.texCoord0") // 替换 Cocos 的输入变量
            .replace(/cc_matProj\s*\*\s*\([^)]+\)\s*\*\s*[^;]+/g, "") // 移除标准位置计算
            .replace(/return\s+[^;]+\s*;/g, "") // 移除有内容的 return 语句
            .replace(/return\s*;/g, "") // 移除空的 return 语句
            .replace(/v_position\s*=\s*[^;]+\s*;/g, "") // 移除简单的变量传递
            .replace(/vec4\s+pos\s*=\s*matWorld\s*\*\s*[^;]+\s*;/g, "") // 移除标准的位置计算
            .replace(/vec4\s+pos\s*=\s*[^;]+\s*;/g, "") // 移除所有 pos 变量声明
            .replace(/matWorld/g, "") // 移除所有 matWorld 引用
            .replace(/matWorldIT/g, "") // 移除所有 matWorldIT 引用
            .replace(/pos\.xyz/g, "") // 移除 pos.xyz 引用
            .replace(/pos\.x/g, "") // 移除 pos.x 引用
            .replace(/pos\.y/g, "") // 移除 pos.y 引用
            .replace(/pos\.z/g, "") // 移除 pos.z 引用
            .replace(/pos\.w/g, "") // 移除 pos.w 引用
            .split("\n")
            .map(line => line.trim())
            .filter(line => {
                // 过滤掉空行
                if (line.length === 0) return false;
                // 过滤掉残留的 return 语句
                if (line.match(/^\s*return\s*;?\s*$/)) return false;
                // 过滤掉 Cocos 标准代码的残留
                if (line.includes("cc_matProj") || line.includes("cc_matView") || line.includes("cc_matWorld")) return false;
                if (line.includes("StandardVertInput") || line.includes("CCVertInput") || line.includes("CCGetWorldMatrix")) return false;
                if (line.includes("matWorld") || line.includes("matWorldIT")) return false;
                if (line.match(/^\s*pos\s*[=;]/)) return false; // 过滤掉 pos 变量相关的行
                return true;
            })
            .join("\n")
            .trim();

        // 构建标准的 Laya 顶点着色器结构
        const includes = [
            '#include "Math.glsl";',
            '#include "Scene.glsl";',
            '#include "SceneFogInput.glsl";',
            '#include "Camera.glsl";',
            '#include "Sprite3DVertex.glsl";',
            '#include "VertexCommon.glsl";'
        ];

        let result = includes.join("\n    ") + "\n\n";

        // 添加 varying 变量声明
        if (varyingVars.length > 0) {
            result += varyingVars.join("\n") + "\n\n";
        }

        // 检查是否需要 UV 和 COLOR
        const hasUV = code.includes("texCoord") || code.includes("uv") || code.includes("UV");
        const hasColor = code.includes("color") || code.includes("Color");

        result += "    void main()\n    {\n";
        result += "        Vertex vertex;\n";
        result += "        getVertexParams(vertex);\n\n";

        // 检查是否有自定义的 UV varying（如 v_uv）
        const hasCustomUV = customLogic.includes("v_uv") || code.includes("v_uv");

        // 检查是否有 tiling/offset 计算（如 v_uv = ... * Tiling_Offset.xy + Tiling_Offset.zw）
        // 使用原始函数体检查，因为 functionBody 可能已经被处理过
        const hasTilingOffset = originalFunctionBody.includes("Tiling_Offset") ||
            originalFunctionBody.includes("TilingOffset") ||
            originalFunctionBody.includes("mainTiling_Offset") ||
            originalFunctionBody.match(/v_uv\s*=\s*[^;]*\*[^;]*\+[^;]*/);

        if (hasUV) {
            // 如果有自定义的 v_uv，使用它；否则使用标准的 v_Texcoord0
            if (hasCustomUV) {
                // 检查是否有 tiling/offset 计算需要保留
                if (hasTilingOffset) {
                    // 从原始函数体中提取 tiling/offset 计算逻辑
                    const tilingOffsetMatch = originalFunctionBody.match(/v_uv\s*=\s*([^;]+);/);
                    if (tilingOffsetMatch) {
                        let tilingOffsetExpr = tilingOffsetMatch[1].trim();
                        // 替换变量名
                        tilingOffsetExpr = tilingOffsetExpr.replace(/a_texCoord/g, "vertex.texCoord0");
                        // 使用动态映射替换变量名
                        if (variableToUniformMap) {
                            // 按长度从长到短排序，避免部分匹配
                            const sortedEntries = Array.from(variableToUniformMap.entries()).sort((a, b) => b[0].length - a[0].length);
                            for (const [originalName, uniformName] of sortedEntries) {
                                const regex = new RegExp(`\\b${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g");
                                tilingOffsetExpr = tilingOffsetExpr.replace(regex, uniformName);
                            }
                        } else {
                            // 如果没有映射表，使用默认规则（添加 u_ 前缀）
                            tilingOffsetExpr = tilingOffsetExpr.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
                                // 跳过已经是 uniform 的、varying 的、内置变量等
                                if (match.startsWith("u_") || match.startsWith("v_") || match.startsWith("cc_") ||
                                    match === "vertex" || match === "texCoord0" || match === "xy" || match === "zw") {
                                    return match;
                                }
                                return ensureUniformName(match);
                            });
                        }
                        result += `        v_uv = ${tilingOffsetExpr};\n\n`;
                    } else {
                        // 如果没有找到匹配，使用默认值
                        result += "        v_uv = vertex.texCoord0;\n\n";
                    }
                } else {
                    // 自定义 UV 变量已经在 varyingVars 中声明了
                    // 直接使用 vertex.texCoord0 赋值
                    result += "        v_uv = vertex.texCoord0;\n\n";
                }
            } else {
                result += "    #ifdef UV\n";
                result += "        v_Texcoord0 = transformUV(vertex.texCoord0, u_TilingOffset);\n";
                result += "    #endif // UV\n\n";
            }
        }

        if (hasColor) {
            result += "    #ifdef COLOR\n";
            result += "        v_VertexColor = vertex.vertexColor;\n";
            result += "    #endif // COLOR\n\n";
        }

        // 添加自定义逻辑（如果有且不是空）
        // 但需要过滤掉已经被标准结构处理的代码（如 v_uv = a_texCoord）
        if (customLogic && customLogic.length > 0) {
            // 替换 uniform block 中的变量名（如 noiseTilingOffset -> u_noiseTilingOffset）
            if (variableToUniformMap) {
                const sortedEntries = Array.from(variableToUniformMap.entries()).sort((a, b) => b[0].length - a[0].length);
                for (const [originalName, uniformName] of sortedEntries) {
                    const regex = new RegExp(`\\b${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g");
                    customLogic = customLogic.replace(regex, uniformName);
                }
            } else {
                // 如果没有映射表，使用默认规则（添加 u_ 前缀）
                customLogic = customLogic.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
                    // 跳过已经是 uniform 的、varying 的、内置变量等
                    if (match.startsWith("u_") || match.startsWith("v_") || match.startsWith("cc_") ||
                        match === "vertex" || match === "texCoord0" || match === "xy" || match === "zw" ||
                        match === "vec2" || match === "vec3" || match === "vec4" || match === "float" ||
                        match === "mat4" || match === "texture2D" || match === "gl_Position" ||
                        match === "getWorldMatrix" || match === "getPositionCS" || match === "remapPositionZ") {
                        return match;
                    }
                    return ensureUniformName(match);
                });
            }

            // 移除已经被处理的代码行
            let filteredLogic = customLogic
                .split("\n")
                .filter(line => {
                    const trimmed = line.trim();
                    // 过滤掉已经被标准结构处理的代码
                    if (trimmed.includes("v_uv = a_texCoord") || trimmed.includes("v_uv = vertex.texCoord0")) {
                        return false;
                    }
                    if (trimmed.match(/^\s*v_uv\s*=\s*a_texCoord\s*$/)) {
                        return false;
                    }
                    // 过滤掉重复的 v_uv.xy 赋值（如果前面已经有 v_uv = vertex.texCoord0）
                    // 如果 v_uv 是 vec2，不能使用 v_uv.xy，应该直接使用 v_uv
                    if (trimmed.match(/^\s*v_uv\.xy\s*=\s*vertex\.texCoord0\.xy\s*$/) ||
                        trimmed.match(/^\s*v_uv\.xy\s*=\s*a_texCoord\.xy\s*$/)) {
                        return false;
                    }
                    // 过滤掉 v_uv = vertex.texCoord0 之后的重复赋值
                    // 注意：如果已经有 v_uv = vertex.texCoord0，后续的 v_uv = vertex.texCoord0.xy 也是重复的
                    if (trimmed.match(/^\s*v_uv\s*=\s*vertex\.texCoord0\s*$/) ||
                        trimmed.match(/^\s*v_uv\s*=\s*vertex\.texCoord0\.xy\s*$/)) {
                        return false;
                    }
                    // 过滤掉空的 vec4 position 声明
                    if (trimmed.match(/^\s*vec4\s+position\s*;?\s*$/)) {
                        return false;
                    }
                    return true;
                })
                .join("\n")
                .trim();
            
            // 如果 v_uv 被声明为 vec2，需要将 v_uv.xy 替换为 v_uv
            // 检查 varyingVars 中是否有 vec2 v_uv
            const hasVec2V_uv = varyingVars.some(v => v.includes("varying vec2 v_uv"));
            if (hasVec2V_uv) {
                // 将 v_uv.xy 替换为 v_uv（因为 v_uv 已经是 vec2，不需要 .xy）
                // 使用单词边界匹配，避免误替换
                filteredLogic = filteredLogic.replace(/\bv_uv\.xy\b/g, "v_uv");
            }
            
            // 同样处理 v_noiseUV（如果它是 vec2）
            const hasVec2V_noiseUV = varyingVars.some(v => v.includes("varying vec2 v_noiseUV"));
            if (hasVec2V_noiseUV) {
                // 将 v_noiseUV.xy 替换为 v_noiseUV
                filteredLogic = filteredLogic.replace(/\bv_noiseUV\.xy\b/g, "v_noiseUV");
            }

            if (filteredLogic && filteredLogic.length > 0) {
                // 确保自定义逻辑有正确的缩进
                const indentedLogic = filteredLogic.split("\n").map(line => "        " + line.trim()).join("\n");
                result += indentedLogic + "\n\n";
            }
        }

        // 标准位置计算
        result += "        mat4 worldMat = getWorldMatrix();\n";
        result += "        vec4 pos = (worldMat * vec4(vertex.positionOS, 1.0));\n";
        result += "        vec3 positionWS = pos.xyz / pos.w;\n";
        result += "        gl_Position = getPositionCS(positionWS);\n";
        result += "        gl_Position = remapPositionZ(gl_Position);\n\n";

        // 添加雾效处理
        result += "    #ifdef FOG\n";
        result += "        FogHandle(gl_Position.z);\n";
        result += "    #endif\n";

        result += "    }";

        return result;
    } else {
        // 处理片段着色器
        // 提取自定义逻辑
        let customLogic = functionBody
            .replace(/\/\/.*$/gm, "") // 移除注释
            .replace(/texture\s*\(/g, "texture2D(")
            .replace(/uniform\s+\w+\s*\{[^}]*\}\s*;/g, "") // 移除 uniform block 声明（已经在 uniformMap 中定义）
            // 将 Cocos 的 #if MACRO_NAME 转换为 GLSL 标准的 #ifdef MACRO_NAME
            .replace(/#if\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm, "#ifdef $1")
            .trim();

        // 先处理 return CCFragOutput(...) 的情况，在替换变量名之前
        // 这样可以避免 col 被错误地替换为 u_col
        customLogic = customLogic.replace(/return\s+CCFragOutput\s*\(\s*([^)]+)\s*\)\s*;/g, (match, returnValue) => {
            const value = returnValue.trim();
            // 返回值通常是局部变量（如 col），不应该添加 u_ 前缀
            return `gl_FragColor = ${value};`;
        });

        // 提取所有局部变量声明，避免被替换为 uniform
        const localVars = new Set<string>();
        const varDeclRegex = /\b(vec2|vec3|vec4|float|int|bool|mat4)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        let varMatch;
        while ((varMatch = varDeclRegex.exec(customLogic)) !== null) {
            localVars.add(varMatch[2]);
        }

        // 替换所有 uniform 变量引用为正确的名称（使用动态映射）
        if (variableToUniformMap) {
            // 按长度从长到短排序，避免部分匹配（如 mainTiling_Offset 应该在 Tiling_Offset 之前）
            const sortedEntries = Array.from(variableToUniformMap.entries()).sort((a, b) => b[0].length - a[0].length);
            for (const [originalName, uniformName] of sortedEntries) {
                // 跳过局部变量，不应该被替换
                if (localVars.has(originalName)) {
                    continue;
                }
                // 使用单词边界匹配，避免部分匹配
                const regex = new RegExp(`\\b${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g");
                customLogic = customLogic.replace(regex, uniformName);
            }
        } else {
            // 如果没有映射表，使用默认规则（添加 u_ 前缀，但排除已有前缀的）
            // 注意：需要排除局部变量（如 col, finalColor, texColor 等）
            customLogic = customLogic.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
                // 跳过已经是 uniform 的（u_ 开头）、varying 的（v_ 开头）、内置变量（cc_ 开头）等
                if (match.startsWith("u_") || match.startsWith("v_") || match.startsWith("cc_") ||
                    match === "texture2D" || match === "vec2" || match === "vec3" || match === "vec4" ||
                    match === "float" || match === "int" || match === "bool" || match === "mat4" ||
                    match === "gl_FragColor" || match === "gl_Position" || match === "vertex" ||
                    match === "finalColor" || match === "texColor" || match === "col" ||
                    localVars.has(match)) {
                    return match;
                }
                // 其他变量名，添加 u_ 前缀
                return ensureUniformName(match);
            });
        }

        // 清理多余的右括号（可能来自 CCFragOutput 转换）
        customLogic = customLogic.replace(/gl_FragColor\s*=\s*([^;)]+)\)\s*;/g, (match, value) => {
            return `gl_FragColor = ${value.trim()};`;
        });

        // 处理普通的 return 语句（如果还有的话）
        const returnMatch = customLogic.match(/return\s+([^;]+)\s*;/);
        if (returnMatch) {
            const returnValue = returnMatch[1].trim();
            // 返回值通常是局部变量，不应该添加 u_ 前缀
            customLogic = customLogic.replace(/return\s+([^;]+)\s*;/g, `gl_FragColor = $1;`);
        }

        // 构建标准的 Laya 片段着色器结构
        const includes = [
            '#include "Color.glsl";',
            '#include "Scene.glsl";',
            '#include "SceneFog.glsl";',
            '#include "Camera.glsl";',
            '#include "Sprite3DFrag.glsl";'
        ];

        // 如果代码中使用了 cc_ambientSky 或 diffuseIrradiance，添加 globalIllumination.glsl
        if (code.includes("cc_ambientSky") || code.includes("diffuseIrradiance") || code.includes("DAY_AND_NIGHT")) {
            includes.push('#include "globalIllumination.glsl";');
        }

        let result = includes.join("\n    ") + "\n\n";

        // 添加 varying 变量声明（标准变量）
        // 只有在真正使用 v_Texcoord0 时才声明（如果使用自定义的 v_uv，则不需要）
        const usesStandardUV = code.includes("v_Texcoord0") && !code.includes("v_uv");
        if (usesStandardUV) {
            result += "    varying vec2 v_Texcoord0;\n\n";
        }
        if (code.includes("v_Color") || code.includes("vertexColor")) {
            result += "    varying vec4 v_Color;\n\n";
        }

        // 添加自定义 varying 变量
        if (varyingVars.length > 0) {
            result += varyingVars.join("\n") + "\n\n";
        }

        result += "    void main()\n    {\n";

        // 添加自定义逻辑
        if (customLogic && customLogic.length > 0) {
            // 替换 u_finalColor 为 finalColor（如果存在）
            customLogic = customLogic.replace(/u_finalColor/g, "finalColor");

            // 替换 Cocos 的环境光变量为 Laya 的格式
            // cc_ambientSky 需要替换为 diffuseIrradiance(normalWS)，但这里我们使用默认法线
            // diffuseIrradiance 返回 vec3，所以需要处理 vec4 ambient = cc_ambientSky 的情况
            // 先处理 vec4 ambient = cc_ambientSky; 的情况，将其转换为 vec3 ambient = diffuseIrradiance(...);
            customLogic = customLogic.replace(/vec4\s+ambient\s*=\s*cc_ambientSky\s*;/g, "vec3 ambient = diffuseIrradiance(vec3(0.0, 1.0, 0.0));");
            // 然后处理其他 cc_ambientSky 的使用（但需要确保不会再次匹配上面的模式）
            customLogic = customLogic.replace(/cc_ambientSky/g, "diffuseIrradiance(vec3(0.0, 1.0, 0.0))");
            // 修复已经转换后的 vec4 ambient = diffuseIrradiance(...) 的情况
            customLogic = customLogic.replace(/vec4\s+ambient\s*=\s*diffuseIrradiance\(/g, "vec3 ambient = diffuseIrradiance(");

            // 替换 LinearToSRGB 为 Laya 的格式（如果存在）
            customLogic = customLogic.replace(/LinearToSRGB\s*\(/g, "linearToGamma(");

            // 如果 v_uv 被声明为 vec2，需要将 v_uv.xy 替换为 v_uv
            // 检查 varyingVars 中是否有 vec2 v_uv
            const hasVec2V_uv = varyingVars.some(v => v.includes("varying vec2 v_uv"));
            if (hasVec2V_uv) {
                // 将 v_uv.xy 替换为 v_uv（因为 v_uv 已经是 vec2，不需要 .xy）
                // 使用单词边界匹配，避免误替换
                customLogic = customLogic.replace(/\bv_uv\.xy\b/g, "v_uv");
            }
            
            // 同样处理 v_noiseUV（如果它是 vec2）
            const hasVec2V_noiseUV = varyingVars.some(v => v.includes("varying vec2 v_noiseUV"));
            if (hasVec2V_noiseUV) {
                // 将 v_noiseUV.xy 替换为 v_noiseUV
                customLogic = customLogic.replace(/\bv_noiseUV\.xy\b/g, "v_noiseUV");
            }
            
            // 修复 vec3 ambient 的 .rgb 访问（vec3 不能访问 .rgb，应该直接使用）
            // 将 ambient.rgb 替换为 ambient（因为 ambient 已经是 vec3）
            customLogic = customLogic.replace(/\bambient\.rgb\b/g, "ambient");

            // 清理空行和多余的空白
            customLogic = customLogic
                .split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0) // 移除空行
                .join("\n");

            // 确保自定义逻辑有正确的缩进
            const indentedLogic = customLogic.split("\n").map(line => "        " + line).join("\n");
            result += indentedLogic + "\n";
        } else {
            // 默认颜色
            result += "        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);\n";
        }

        // 确保有 outputTransform（如果没有在自定义逻辑中）
        // 检查 customLogic 中是否已经有 outputTransform 调用
        const hasOutputTransform = customLogic && (
            customLogic.includes("outputTransform") ||
            customLogic.match(/gl_FragColor\s*=\s*outputTransform\s*\(/g)
        );

        if (!hasOutputTransform) {
            result += "\n        gl_FragColor = outputTransform(gl_FragColor);\n";
        }

        result += "    }";

        return result;
    }
}

// 生成完整的 shader 内容
function composeShader(
    shaderName: string,
    uniforms: Map<string, string>,
    defines: Set<string>,
    programs: Map<string, string>,
    techniques: Technique[],
    variableToUniformMap?: Map<string, string>
): string {
    const uniformEntries = Array.from(uniforms.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => {
            let entry = `        ${name}: { type: ${type}`;
            // 纹理添加 define 选项
            if (type === "Texture2D") {
                let defineName = name.toUpperCase().replace("U_", "");
                if (defineName === "DIFFUSETEXTURE") {
                    defineName = "DIFFUSEMAP";
                } else if (defineName === "ALBEDOTEXTURE") {
                    defineName = "ALBEDOTEXTURE";
                } else if (!defineName.endsWith("TEXTURE")) {
                    defineName = defineName + "TEXTURE";
                }
                entry += `, options: { define: "${defineName}" }`;
            }
            // Color 类型添加默认值
            else if (type === "Color" || (type === "Vector4" && name.toLowerCase().includes("color"))) {
                entry += `, default: [1, 1, 1, 1]`;
            }
            entry += " }";
            return entry;
        });

    const defineEntries = Array.from(defines)
        .sort()
        .map(name => `        ${name}: { type: bool, default: false }`);

    const uniformBlock = uniformEntries.length > 0
        ? `    uniformMap:{\n${uniformEntries.join(",\n")}\n    },`
        : "    uniformMap:{},";

    const definesBlock = defineEntries.length > 0
        ? `    defines: {\n${defineEntries.join(",\n")}\n    }`
        : "    defines: {}";

    // 生成 shaderPass 数组
    const shaderPasses: string[] = [];
    const glslCodeBlocks: string[] = [];

    // 处理 techniques
    if (techniques.length > 0) {
        for (const technique of techniques) {
            let passIndex = 0;

            for (const pass of technique.passes) {
                const vsName = pass.vert ? `${toCamelCase(shaderName)}VS${passIndex > 0 ? passIndex : ""}` : null;
                const fsName = pass.frag ? `${toCamelCase(shaderName)}PS${passIndex > 0 ? passIndex : ""}` : null;

                if (vsName || fsName) {
                    // 生成 shaderPass
                    const passEntry: string[] = [
                        "        {",
                        "            pipeline:Forward,"
                    ];

                    if (vsName) {
                        passEntry.push(`            VS:${vsName},`);
                        // 转换顶点着色器代码
                        if (pass.vert && programs.has(pass.vert)) {
                            const vsCode = convertGLSLCode(programs.get(pass.vert)!, true, variableToUniformMap);
                            glslCodeBlocks.push(`#defineGLSL ${vsName}\n    #define SHADER_NAME ${shaderName}\n\n    ${vsCode}\n#endGLSL`);
                        } else {
                            console.warn(`[ShaderConversion] Program "${pass.vert}" not found for vertex shader`);
                            glslCodeBlocks.push(`#defineGLSL ${vsName}\n    #define SHADER_NAME ${shaderName}\n\n    // TODO: Program "${pass.vert}" not found\n    void main() {}\n#endGLSL`);
                        }
                    }

                    if (fsName) {
                        passEntry.push(`            FS:${fsName}`);
                        // 转换片段着色器代码
                        if (pass.frag && programs.has(pass.frag)) {
                            const fsCode = convertGLSLCode(programs.get(pass.frag)!, false, variableToUniformMap);
                            glslCodeBlocks.push(`#defineGLSL ${fsName}\n    #define SHADER_NAME ${shaderName}\n\n    ${fsCode}\n#endGLSL`);
                        } else {
                            console.warn(`[ShaderConversion] Program "${pass.frag}" not found for fragment shader`);
                            glslCodeBlocks.push(`#defineGLSL ${fsName}\n    #define SHADER_NAME ${shaderName}\n\n    // TODO: Program "${pass.frag}" not found\n    void main() {}\n#endGLSL`);
                        }
                    }

                    passEntry.push("        }");
                    shaderPasses.push(passEntry.join("\n"));
                    passIndex++;
                }
            }
        }
    }

    // 如果没有找到 passes，生成默认的占位符
    if (shaderPasses.length === 0) {
        console.warn(`[ShaderConversion] No passes found in techniques. Found ${techniques.length} techniques.`);
        shaderPasses.push("        // TODO: Add shader passes");
        glslCodeBlocks.push("// TODO: Provide shader implementation manually.");
    }

    const shaderPassBlock = shaderPasses.length > 0
        ? `    shaderPass:[\n${shaderPasses.join(",\n")}\n    ]`
        : "    shaderPass:[]";

    return [
        "Shader3D Start",
        "{",
        "    type:Shader3D,",
        `    name:${shaderName},`,
        "    enableInstancing:false,",
        "    shaderType:D3,",
        "    supportReflectionProbe:false,",
        uniformBlock,
        definesBlock + ",",
        shaderPassBlock,
        "}",
        "Shader3D End",
        "",
        "",
        "GLSL Start",
        glslCodeBlocks.join("\n\n"),
        "GLSL End",
        ""
    ].join("\n");
}

function toCamelCase(str: string): string {
    let result = "";
    let upperNext = false;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === "-" || char === "_") {
            upperNext = true;
        } else {
            result += upperNext ? char.toUpperCase() : char;
            upperNext = false;
        }
    }
    return result;
}

function collectDefinesFromCode(source: string, collector: Set<string>): void {
    // 使用简单的字符串查找收集宏定义
    let searchIndex = 0;
    while (true) {
        const ifdefIndex = source.indexOf("#ifdef", searchIndex);
        const ifndefIndex = source.indexOf("#ifndef", searchIndex);
        const ifIndex = source.indexOf("#if", searchIndex);
        const elifIndex = source.indexOf("#elif", searchIndex);

        let nextIndex = -1;
        let macroStart = -1;

        if (ifdefIndex !== -1 && (nextIndex === -1 || ifdefIndex < nextIndex)) {
            nextIndex = ifdefIndex;
            macroStart = ifdefIndex + 6;
        }
        if (ifndefIndex !== -1 && (nextIndex === -1 || ifndefIndex < nextIndex)) {
            nextIndex = ifndefIndex;
            macroStart = ifndefIndex + 7;
        }
        if (ifIndex !== -1 && (nextIndex === -1 || ifIndex < nextIndex)) {
            nextIndex = ifIndex;
            macroStart = ifIndex + 3;
        }
        if (elifIndex !== -1 && (nextIndex === -1 || elifIndex < nextIndex)) {
            nextIndex = elifIndex;
            macroStart = elifIndex + 5;
        }

        if (nextIndex === -1) break;

        // 跳过空白字符
        while (macroStart < source.length && /\s/.test(source[macroStart])) {
            macroStart++;
        }

        // 提取宏名称
        let macroEnd = macroStart;
        while (macroEnd < source.length && /[A-Za-z0-9_]/.test(source[macroEnd])) {
            macroEnd++;
        }

        if (macroEnd > macroStart) {
            const macroName = source.substring(macroStart, macroEnd);
            collector.add(macroName);
        }

        searchIndex = nextIndex + 1;
    }
}

function inferUniformType(name: string, rawValue?: string): string | null {
    const nameLower = name.toLowerCase();

    // 1. 根据变量名推断（通用规则，不依赖具体名字）
    if (nameLower.endsWith("texture") || nameLower.endsWith("tex")) {
        return "Texture2D";
    }

    // 如果变量名包含 "color"，且值是 4 元素数组，推断为 Color（而不是 Vector4）
    // 但如果没有值，默认推断为 Vector4（因为可能是其他用途的 vec4）
    if (nameLower.includes("color")) {
        if (rawValue) {
            const trimmed = rawValue.trim();
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                const items = trimmed.substring(1, trimmed.length - 1).split(",").map(item => item.trim()).filter(Boolean);
                if (items.length === 4) {
                    return "Color"; // 4 元素的颜色值，推断为 Color
                }
            }
        }
        // 如果没有值或值不是 4 元素数组，默认推断为 Vector4（保持兼容性）
        return "Vector4";
    }

    if (nameLower.includes("mask")) {
        return "Vector4";
    }

    if (nameLower.includes("offset") || nameLower.includes("tiling")) {
        return "Vector4";
    }

    // 2. 根据值的格式推断（最可靠，不依赖变量名）
    if (rawValue) {
        const trimmed = rawValue.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            const items = trimmed.substring(1, trimmed.length - 1).split(",").map(item => item.trim()).filter(Boolean);
            switch (items.length) {
                case 2:
                    return "Vector2";
                case 3:
                    return "Vector3";
                case 4:
                    // 4 元素数组默认推断为 Vector4
                    // 如果是颜色，应该通过 editor.type 或变量名（包含 "color"）来识别
                    return "Vector4";
                default:
                    return "Float";
            }
        }

        if (trimmed === "true" || trimmed === "false") {
            return "Bool";
        }

        if (!isNaN(Number(trimmed))) {
            return "Float";
        }
    }

    // 3. 默认推断为 Float
    return "Float";
}

function ensureUniformName(name: string): string {
    // 保持变量名原样，不进行任何转换
    // 用户会根据 Cocos 的 shader 在 Laya 这边做对应的 shader，所以变量名不需要转换
    return name;
}

async function writeMeta(metaPath: string, uuid?: string): Promise<void> {
    if (!uuid) return;
    await IEditorEnv.utils.writeJsonAsync(metaPath, { uuid });
}

