Shader3D Start
{
    type:Shader3D,
    name:toon_default,
    enableInstancing:true,
    shaderType:D3,
    supportReflectionProbe:false,
    uniformMap:{
        // Outline Parameters
        lineWidth: { type: Float, default: 10.0 },
        depthBias: { type: Float, default: 0.0 },
        outlineColor: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },

        // Tiling and Offset
        tilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },

        // Base Color (Cocos x² linear 0.6 → sqrt 0.775)
        baseColor: { type: Color, default: [0.775, 0.775, 0.775, 1.0] },
        mainTexture: { type: Texture2D, options: { define: "MAINTEXTURE" } },

        // Color Scale and Alpha Threshold
        colorScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },

        // Shade Colors (Cocos x² linear 0.4/0.2 → sqrt 0.632/0.447)
        shadeColor1: { type: Color, default: [0.632, 0.632, 0.632, 1.0] },
        shadeColor2: { type: Color, default: [0.447, 0.447, 0.447, 1.0] },
        shadeMap1: { type: Texture2D, options: { define: "USE_1ST_SHADE_MAP" } },
        shadeMap2: { type: Texture2D, options: { define: "USE_2ND_SHADE_MAP" } },

        // Specular (xyz: color, w: power)
        specular: { type: Color, default: [1.0, 1.0, 1.0, 0.0] },
        specularMap: { type: Texture2D, options: { define: "USE_SPECULAR_MAP" } },

        // Shade Parameters
        baseStep: { type: Float, default: 0.8 },
        baseFeather: { type: Float, default: 0.001 },
        shadeStep: { type: Float, default: 0.5 },
        shadeFeather: { type: Float, default: 0.001 },

        // Shadow Cover
        shadowCover: { type: Float, default: 0.5 },

        // Emissive
        emissive: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },
        emissiveScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        emissiveMap: { type: Texture2D, options: { define: "USE_EMISSIVE_MAP" } },

        // Normal Map
        normalMap: { type: Texture2D, options: { define: "USE_NORMAL_MAP" } },
        normalStrength: { type: Float, default: 1.0 },
    },
    defines: {
        USE_ALPHA_TEST: { type: bool, default: false },
        USE_POSITION_SCALING: { type: bool, default: false },
        USE_OUTLINE_PASS: { type: bool, default: false },
        SHADE_MAP_1_AS_SHADE_MAP_2: { type: bool, default: false },
        BASE_COLOR_MAP_AS_SHADE_MAP_1: { type: bool, default: false },
        BASE_COLOR_MAP_AS_SHADE_MAP_2: { type: bool, default: false },
    },
    shaderPass:[
        // Pass 0: Outline Pass (render back faces expanded along normals)
        {
            pipeline:Forward,
            VS:ToonOutlineVS,
            FS:ToonOutlineFS,
            statefirst:true,
            renderState:{
                cull:"Front"
            }
        },
        // Pass 1: Main Toon Shading Pass
        {
            pipeline:Forward,
            VS:ToonVS,
            FS:ToonFS
        },
        // Pass 2: Shadow Caster Pass (writes depth to shadow map)
        {
            pipeline:ShadowCaster,
            VS:ToonShadowCasterVS,
            FS:ToonShadowCasterFS
        }
    ]
}
Shader3D End

GLSL Start
// ============================================
// OUTLINE VERTEX SHADER (Pass 0)
// ============================================
#defineGLSL ToonOutlineVS
#define SHADER_NAME toon_outline

#include "Math.glsl";
#include "Scene.glsl";
#include "Camera.glsl";
#include "Sprite3DVertex.glsl";
#include "VertexCommon.glsl";

out vec2 v_UV;

void main()
{
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();

    // Object-space normal extrusion (matching Cocos builtin-toon.effect)
    // LayaAir FBX unitScaleFactor is baked into localScale (e.g. 100 for cm→m),
    // which inflates avgScale and makes outline huge without compensation.
    // Only compensate when avgScale > 1 (unitScaleFactor scaling);
    // avgScale < 1 is original Cocos scene scale — no compensation needed.
    float width = lineWidth * 0.001;
    float scaleX = length(vec3(worldMat[0][0], worldMat[0][1], worldMat[0][2]));
    float scaleY = length(vec3(worldMat[1][0], worldMat[1][1], worldMat[1][2]));
    float scaleZ = length(vec3(worldMat[2][0], worldMat[2][1], worldMat[2][2]));
    float avgScale = max((scaleX + scaleY + scaleZ) / 3.0, 1.0);
    width /= avgScale;

    vec3 positionOS = vertex.positionOS;

    #ifdef USE_POSITION_SCALING
        vec3 dir = normalize(positionOS);
        float flip = dot(dir, normalize(vertex.normalOS)) < 0.0 ? -1.0 : 1.0;
        positionOS += flip * dir * width * 2.0;
    #else
        positionOS += normalize(vertex.normalOS) * width;
    #endif

    vec4 positionWS = worldMat * vec4(positionOS, 1.0);
    vec4 pos = u_Projection * u_View * positionWS;

    pos.z -= depthBias * 0.002;

    #ifdef UV
        v_UV = vertex.texCoord0;
    #else
        v_UV = vec2(0.0);
    #endif

    gl_Position = pos;
    gl_Position = remapPositionZ(gl_Position);
}
#endGLSL

// ============================================
// OUTLINE FRAGMENT SHADER (Pass 0)
// ============================================
#defineGLSL ToonOutlineFS
#define SHADER_NAME toon_outline

#include "Color.glsl";
#include "Lighting.glsl";

in vec2 v_UV;

void main()
{
    vec4 color = outlineColor;

    #ifdef DIRECTIONLIGHT
        DirectionLight dirLight = getDirectionLight(0, vec3(0.0));
        Light light = getLight(dirLight);
        color.rgb *= light.color;
    #endif

    gl_FragColor = vec4(color.rgb, 1.0);
    gl_FragColor = outputTransform(gl_FragColor);
}
#endGLSL

// ============================================
// MAIN TOON VERTEX SHADER (Pass 1)
// ============================================
#defineGLSL ToonVS
#define SHADER_NAME toon_default

#include "Math.glsl";
#include "Scene.glsl";
#include "SceneFogInput.glsl";
#include "Camera.glsl";
#include "Sprite3DVertex.glsl";
#include "VertexCommon.glsl";

out vec3 v_PositionWS;
out vec2 v_UV;
out vec3 v_NormalWS;

#ifdef TANGENT
out vec3 v_TangentWS;
out vec3 v_BitangentWS;
#endif

void main()
{
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();
    mat4 worldMatIT = transpose(inverse(worldMat));

    vec4 positionWS = worldMat * vec4(vertex.positionOS, 1.0);
    v_PositionWS = positionWS.xyz;

    #ifdef UV
        v_UV = vertex.texCoord0 * tilingOffset.xy + tilingOffset.zw;
    #else
        v_UV = vec2(0.0);
    #endif

    v_NormalWS = normalize((worldMatIT * vec4(vertex.normalOS, 0.0)).xyz);

    #ifdef TANGENT
        v_TangentWS = normalize((worldMat * vec4(vertex.tangentOS.xyz, 0.0)).xyz);
        v_BitangentWS = cross(v_NormalWS, v_TangentWS) * vertex.tangentOS.w;
    #endif

    gl_Position = u_Projection * u_View * positionWS;
    gl_Position = remapPositionZ(gl_Position);

    #ifdef FOG
        FogHandle(gl_Position.z);
    #endif
}
#endGLSL

// ============================================
// MAIN TOON FRAGMENT SHADER (Pass 1)
// ============================================
#defineGLSL ToonFS
#define SHADER_NAME toon_default

#include "Color.glsl";
#include "Scene.glsl";
#include "SceneFog.glsl";
#include "Camera.glsl";
#include "Sprite3DFrag.glsl";
#include "Lighting.glsl";

in vec3 v_PositionWS;
in vec2 v_UV;
in vec3 v_NormalWS;

#ifdef TANGENT
in vec3 v_TangentWS;
in vec3 v_BitangentWS;
#endif

// 标准线性 → Cocos x² 线性空间
// LayaAir 引擎对 Color uniform 做 gammaToLinearSpace (标准 sRGB 曲线)
// sRGB 纹理经 GPU 硬件解码到标准线性空间
// 此函数转换为 Cocos 使用的 x² 近似线性空间: sRGB → sRGB² (Cocos SRGBToLinear)
vec3 toCocosLinear(vec3 linearVal) {
    // 先还原为 sRGB: 标准线性 → sRGB
    vec3 srgb = 1.055 * pow(max(linearVal, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    srgb = max(srgb, vec3(0.0));
    // 再用 Cocos 的 x² 转换: sRGB → Cocos linear
    return srgb * srgb;
}

void main()
{
    vec2 uv = v_UV;

    // Base color: 转换到 Cocos x² 线性空间
    vec4 localBaseColor = baseColor;
    localBaseColor.rgb = toCocosLinear(localBaseColor.rgb);
    #ifdef MAINTEXTURE
        vec4 mainTextureSample = texture2D(mainTexture, uv);
        mainTextureSample.rgb = toCocosLinear(mainTextureSample.rgb);
        localBaseColor *= mainTextureSample;
    #endif
    localBaseColor.rgb *= colorScale;

    // Alpha test
    #ifdef USE_ALPHA_TEST
        if (localBaseColor.a < alphaThreshold) discard;
    #endif

    // Shade colors: 已通过 ensureToonDefaults 编码为 sqrt(cocosLinear)
    // 经引擎 gammaToLinear 后再经 toCocosLinear 恢复正确的 Cocos 线性值
    vec3 shade1 = toCocosLinear(shadeColor1.rgb) * colorScale;
    #ifdef USE_1ST_SHADE_MAP
        vec4 shadeMap1Sample = texture2D(shadeMap1, uv);
        shadeMap1Sample.rgb = toCocosLinear(shadeMap1Sample.rgb);
        shade1 *= shadeMap1Sample.rgb;
    #endif

    vec3 shade2 = toCocosLinear(shadeColor2.rgb) * colorScale;
    #ifdef USE_2ND_SHADE_MAP
        vec4 shadeMap2Sample = texture2D(shadeMap2, uv);
        shadeMap2Sample.rgb = toCocosLinear(shadeMap2Sample.rgb);
        shade2 *= shadeMap2Sample.rgb;
    #endif

    #ifdef BASE_COLOR_MAP_AS_SHADE_MAP_1
        #ifdef MAINTEXTURE
            shade1 *= mainTextureSample.rgb;
        #endif
    #endif
    #ifdef BASE_COLOR_MAP_AS_SHADE_MAP_2
        #ifdef MAINTEXTURE
            shade2 *= mainTextureSample.rgb;
        #endif
    #endif
    #ifdef SHADE_MAP_1_AS_SHADE_MAP_2
        shade2 *= shade1;
    #endif

    // Normal
    vec3 N = normalize(v_NormalWS);
    #ifdef USE_NORMAL_MAP
        #ifdef TANGENT
            vec3 normalSample = texture2D(normalMap, uv).xyz - vec3(0.5);
            vec3 tangent = normalize(v_TangentWS);
            vec3 bitangent = normalize(v_BitangentWS);
            N = normalize(
                (normalSample.x * normalStrength) * tangent +
                (normalSample.y * normalStrength) * bitangent +
                normalSample.z * N
            );
        #endif
    #endif

    // Get main direction light
    // 灯光颜色已在转换时预补偿（linearToGammaSpace），经引擎 gammaToLinearSpace 后恢复为 sRGB
    vec3 lightColor = vec3(1.0);
    vec3 lightDir = normalize(vec3(0.5, -1.0, 0.2));
    float shadowAtten = 1.0;
    #ifdef DIRECTIONLIGHT
        DirectionLight dirLight = getDirectionLight(0, v_PositionWS);
        Light light = getLight(dirLight);
        lightColor = light.color;
        lightDir = light.dir;
        shadowAtten = light.attenuation;
    #endif

    vec3 L = normalize(-lightDir);
    vec3 V = normalize(u_CameraPos - v_PositionWS);

    // 背面不应用阴影贴图，防止 shadow acne 伪影
    float NdotLraw = dot(N, L);
    float facingLight = step(0.0, NdotLraw);
    shadowAtten = mix(1.0, shadowAtten, facingLight);

    // Half-Lambert NdotL (shadow applied POST-STEP, matching Cocos)
    float NL = 0.5 * NdotLraw + 0.5;

    // Two-step toon shade transition (matching Cocos CCToonShading)
    // Step 1: shade1 -> shade2 transition
    float shadeFeatherSafe = max(shadeFeather, 0.0001);
    float shadeBlend = clamp(1.0 + (shadeStep - shadeFeather - NL) / shadeFeatherSafe, 0.0, 1.0);
    vec3 diffuse = mix(shade1, shade2, shadeBlend);

    // Step 2: baseColor -> shaded transition
    float baseFeatherSafe = max(baseFeather, 0.0001);
    float baseBlend = clamp(1.0 + (baseStep - baseFeather - NL) / baseFeatherSafe, 0.0, 1.0);
    diffuse = mix(localBaseColor.rgb, diffuse, baseBlend);

    // Apply shadow POST-STEP (matching Cocos: toonColor * shadow)
    // Shadow multiplies the already-computed toon color, not the NdotL input
    float shadow = mix(1.0, shadowAtten, shadowCover);
    diffuse *= shadow;

    // Specular highlight (hard edge), also affected by shadow
    vec3 H = normalize(V + L);
    float NH = 0.5 * dot(H, N) + 0.5;
    float specularWeight = 1.0 - pow(specular.a, 5.0);
    float specularMask = step(specularWeight + 0.0001, NH);
    vec3 specularColor = toCocosLinear(specular.rgb) * specularMask * shadow;

    // Final color: 匹配 Cocos CCToonShading（在 Cocos x² 线性空间中计算）
    vec3 finalColor = lightColor * baseStep * (diffuse + specularColor);

    // Emissive
    vec3 emissiveContrib = toCocosLinear(emissive.rgb) * emissiveScale;
    #ifdef USE_EMISSIVE_MAP
        vec4 emissiveMapSample = texture2D(emissiveMap, uv);
        emissiveMapSample.rgb = toCocosLinear(emissiveMapSample.rgb);
        emissiveContrib *= emissiveMapSample.rgb;
    #endif
    finalColor += emissiveContrib;

    #ifdef FOG
        finalColor = sceneLitFog(finalColor);
    #endif

    // Cocos x² 线性 → 标准线性输出（匹配 Cocos 的 LinearToSRGB = sqrt）
    // Cocos: sqrt(x²_linear) → sRGB → 引擎 gamma 校正
    // LayaAir: x²_linear → sqrt → sRGB → gammaToLinear → 标准线性 → 引擎 gamma 校正
    vec3 outSrgb = sqrt(max(finalColor, vec3(0.0)));
    vec3 stdLinear;
    stdLinear.r = outSrgb.r <= 0.04045 ? outSrgb.r / 12.92 : pow((outSrgb.r + 0.055) / 1.055, 2.4);
    stdLinear.g = outSrgb.g <= 0.04045 ? outSrgb.g / 12.92 : pow((outSrgb.g + 0.055) / 1.055, 2.4);
    stdLinear.b = outSrgb.b <= 0.04045 ? outSrgb.b / 12.92 : pow((outSrgb.b + 0.055) / 1.055, 2.4);
    gl_FragColor = vec4(stdLinear, localBaseColor.a);
    gl_FragColor = outputTransform(gl_FragColor);
}
#endGLSL

// ============================================
// SHADOW CASTER VERTEX SHADER (Pass 2)
// ============================================
#defineGLSL ToonShadowCasterVS
#define SHADER_NAME ToonShadowCasterVS

#include "DepthVertex.glsl";

out vec2 v_UV;

void main()
{
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();
    vec4 pos = (worldMat * vec4(vertex.positionOS, 1.0));
    vec3 positionWS = pos.xyz / pos.w;

    mat4 normalMat = transpose(inverse(worldMat));
    vec3 normalWS = normalize((normalMat * vec4(vertex.normalOS, 0.0)).xyz);

    #ifdef UV
        v_UV = vertex.texCoord0;
    #else
        v_UV = vec2(0.0);
    #endif

    vec4 positionCS = DepthPositionCS(positionWS, normalWS);
    gl_Position = remapPositionZ(positionCS);
}
#endGLSL

// ============================================
// SHADOW CASTER FRAGMENT SHADER (Pass 2)
// ============================================
#defineGLSL ToonShadowCasterFS
#define SHADER_NAME ToonShadowCasterFS

#include "DepthFrag.glsl";

in vec2 v_UV;

void main()
{
    // Alpha test: discard transparent pixels so they don't cast shadows
    #ifdef USE_ALPHA_TEST
        float alpha = baseColor.a;
        #ifdef MAINTEXTURE
            alpha *= texture2D(mainTexture, v_UV).a;
        #endif
        if (alpha < alphaThreshold) discard;
    #endif

    gl_FragColor = getDepthColor();
}
#endGLSL

GLSL End
