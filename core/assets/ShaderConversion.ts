import fs from "fs";
import fpath from "path";

import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";

const PROPERTY_TYPE_MAP: Record<string, string> = {
    mainTexture: "Texture2D",
    noiseTexture: "Texture2D",
    maskTexture: "Texture2D",
    mainColor: "Vector4",
    lastMask: "Vector4",
    nextMask: "Vector4",
    intensity: "Float",
    curWeight: "Float",
    translationRange: "Float",
    noiseTilingOffset: "Vector4"
};

const PROPERTY_UNIFORM_NAME_MAP: Record<string, string> = {
    mainTexture: "u_DiffuseTexture",
    mainColor: "u_mainColor",
    noiseTexture: "u_noiseTexture",
    maskTexture: "u_maskTexture",
    noiseTilingOffset: "u_noiseTilingOffset",
    lastMask: "u_lastMask",
    nextMask: "u_nextMask",
    intensity: "u_intensity",
    curWeight: "u_curWeight",
    translationRange: "u_translationRange"
};

const CHUNK_HEADER = "// Source chunk generated from Cocos .chunk file.\n// Integrate manually into your shader implementation.\n\n";
const GLSL_PLACEHOLDER = "// TODO: Provide shader implementation manually.\n";
const MACRO_REGEX = /#\s*(?:ifn?def|if|elif)\s+(?:defined\()?([A-Za-z_][A-Za-z0-9_]*)/g;

export class ShaderConversion implements ICocosAssetConversion {
    constructor(private readonly _owner: ICocosMigrationTool) { }

    async run(sourcePath: string, targetPath: string, meta: any) {
        const ext = fpath.extname(sourcePath).toLowerCase();
        if (ext === ".effect") {
            await this.convertEffect(sourcePath, targetPath, meta);
        }
        else if (ext === ".chunk") {
            await this.convertChunk(sourcePath, targetPath, meta);
        }
    }

    private async convertEffect(sourcePath: string, targetPath: string, meta: any) {
        const effectContent = await fs.promises.readFile(sourcePath, "utf8");
        const shaderName = fpath.basename(sourcePath, ".effect");
        const defines = new Set<string>();
        const uniforms = parseProperties(effectContent, defines);
        collectDefinesFromText(effectContent, defines);

        const shaderContent = composeShaderStub(shaderName, uniforms, defines);
        const shaderPath = targetPath.replace(/\.effect$/i, ".shader");
        await fs.promises.writeFile(shaderPath, shaderContent, "utf8");
        await writeMeta(shaderPath + ".meta", meta?.uuid);
    }

    private async convertChunk(sourcePath: string, targetPath: string, meta: any) {
        const content = await fs.promises.readFile(sourcePath, "utf8");
        const glslPath = targetPath.replace(/\.chunk$/i, ".glsl");
        await fs.promises.writeFile(glslPath, CHUNK_HEADER + content, "utf8");
        await writeMeta(glslPath + ".meta", meta?.uuid);
    }
}

function composeShaderStub(shaderName: string, uniforms: Map<string, string>, defines: Set<string>): string {
    const uniformEntries = Array.from(uniforms.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => `        ${name}: { type: ${type} }`);

    const defineEntries = Array.from(defines)
        .sort()
        .map(name => `        ${name}: { type: bool, default: false }`);

    const uniformBlock = uniformEntries.length > 0
        ? `    uniformMap:{\n${uniformEntries.join(",\n")}\n    },`
        : "    uniformMap:{},";

    const definesBlock = defineEntries.length > 0
        ? `    defines:{\n${defineEntries.join(",\n")}\n    },`
        : "    defines:{},";

    return [
        "Shader3D Start",
        "{",
        "    type:Shader3D",
        `    name:${shaderName},`,
        "    shaderType:D3,",
        "    enableInstancing:false,",
        "    supportReflectionProbe:false,",
        uniformBlock,
        definesBlock,
        "    shaderPass:[]",
        "}",
        "Shader3D End",
        "",
        "",
        "GLSL Start",
        GLSL_PLACEHOLDER.trimEnd(),
        "GLSL End",
        ""
    ].join("\n");
}

function parseProperties(effectContent: string, defineCollector: Set<string>): Map<string, string> {
    const result = new Map<string, string>();
    const effectBody = extractEffectBody(effectContent);
    const searchSource = effectBody ?? effectContent;

    if (effectBody) {
        const lines = effectBody.split(/\r?\n/);
        let inProperties = false;
        let baseIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const indent = getIndentation(line);

            if (!inProperties) {
                if (trimmed.startsWith("properties")) {
                    inProperties = true;
                    baseIndent = indent;
                }
                continue;
            }

            if (trimmed === "" || trimmed.startsWith("#"))
                continue;

            if (!trimmed.startsWith("&") && indent <= baseIndent) {
                inProperties = false;
                continue;
            }

            const propertyStart = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{/);
            if (!propertyStart)
                continue;

            const propertyName = propertyStart[1];
            let body = line.substring(line.indexOf("{") + 1);
            let braceDepth = countChar(line, "{") - countChar(line, "}");

            while (braceDepth > 0 && i + 1 < lines.length) {
                i++;
                const nextLine = lines[i];
                braceDepth += countChar(nextLine, "{") - countChar(nextLine, "}");
                body += "\n" + nextLine.trim();
            }

            body = body.replace(/\}\s*$/, "").trim();

            const valueMatch = body.match(/value\s*:\s*([^\n,}]+)/);
            const rawValue = valueMatch ? valueMatch[1].trim() : undefined;

            const optionsMatch = body.match(/define\s*:\s*"?([A-Za-z_][A-Za-z0-9_]*)"?/);
            if (optionsMatch)
                defineCollector.add(optionsMatch[1]);

            const uniformName = ensureUniformName(propertyName);
            if (!result.has(uniformName)) {
                const type = PROPERTY_TYPE_MAP[propertyName] ?? inferUniformType(propertyName, rawValue);
                if (type)
                    result.set(uniformName, type);
            }
        }
    }

    if (result.size === 0) {
        for (const [property, type] of Object.entries(PROPERTY_TYPE_MAP)) {
            const pattern = new RegExp(`\\b${property}\\s*:`);
            if (pattern.test(searchSource)) {
                const uniformName = ensureUniformName(property);
                if (!result.has(uniformName))
                    result.set(uniformName, type);
            }
        }
    }

    return result;
}

function extractEffectBody(content: string): string | null {
    const match = content.match(/CCEffect\s*%{([\s\S]*?)%}/);
    return match ? match[1] : null;
}

function collectDefinesFromText(source: string, collector: Set<string>): void {
    let match: RegExpExecArray | null;
    while ((match = MACRO_REGEX.exec(source)) !== null) {
        collector.add(match[1]);
    }
}

function inferUniformType(name: string, rawValue?: string): string | null {
    if (/texture$/i.test(name))
        return "Texture2D";

    if (rawValue) {
        const trimmed = rawValue.replace(/,$/, "").trim();
        if (/^\[.*\]$/.test(trimmed)) {
            const items = trimmed.replace(/[\[\]]/g, "").split(",").map(item => item.trim()).filter(Boolean);
            switch (items.length) {
                case 2:
                    return "Vector2";
                case 3:
                    return "Vector3";
                case 4:
                    return "Vector4";
                default:
                    return "Float";
            }
        }

        if (/^(true|false)$/i.test(trimmed))
            return "Bool";

        if (!Number.isNaN(Number(trimmed)))
            return "Float";
    }

    if (/color/i.test(name) || /mask/i.test(name))
        return "Vector4";

    if (/offset/i.test(name) || /tiling/i.test(name))
        return "Vector4";

    return "Float";
}

function ensureUniformName(name: string): string {
    const override = PROPERTY_UNIFORM_NAME_MAP[name];
    if (override)
        return override;
    if (name.startsWith("u_"))
        return name;
    if (/^cc_/.test(name))
        return name;
    return `u_${name}`;
}

function getIndentation(line: string): number {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
}

function countChar(text: string, char: string): number {
    return (text.match(new RegExp(`\\${char}`, "g")) || []).length;
}

async function writeMeta(metaPath: string, uuid?: string): Promise<void> {
    if (!uuid)
        return;
    await IEditorEnv.utils.writeJsonAsync(metaPath, { uuid });
}

