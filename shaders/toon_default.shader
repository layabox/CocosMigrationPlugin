Shader3D Start
{
    type:Shader3D,
    name:toon_default,
    enableInstancing:true,
    shaderType:D3,
    supportReflectionProbe:false,
    uniformMap:{
        // Outline Parameters - Cocos: lineWidth, depthBias, outlineColor (Pass 0 baseColor)
        lineWidth: { type: Float, default: 10.0 },
        depthBias: { type: Float, default: 0.0 },
        outlineColor: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },
        
        // Tiling and Offset (Cocos: tilingOffset)
        tilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },
        
        // Base Color (Cocos: mainColor/baseColor, mainTexture/baseColorMap)
        baseColor: { type: Color, default: [0.6, 0.6, 0.6, 1.0] },
        mainTexture: { type: Texture2D, options: { define: "MAINTEXTURE" } },
        
        // Color Scale and Alpha Threshold
        colorScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },
        
        // Shade Colors (Cocos: shadeColor1, shadeColor2)
        shadeColor1: { type: Color, default: [0.4, 0.4, 0.4, 1.0] },
        shadeColor2: { type: Color, default: [0.2, 0.2, 0.2, 1.0] },
        shadeMap1: { type: Texture2D, options: { define: "USE_1ST_SHADE_MAP" } },
        shadeMap2: { type: Texture2D, options: { define: "USE_2ND_SHADE_MAP" } },
        
        // Specular (Cocos: specular - xyz: color, w: power)
        specular: { type: Color, default: [1.0, 1.0, 1.0, 0.3] },
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
        // Renders the expanded model with cull:Front (only back faces visible)
        // This creates the outline effect around the model edges
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
        // Renders the normal model, covering the outline's front
        {
            pipeline:Forward,
            VS:ToonVS,
            FS:ToonFS
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
    
    // lineWidth scaled for appropriate visual size
    // Cocos uses 0.001, but Laya coordinate system is different
    // Using 0.00001 to match visual appearance (Cocos lineWidth=10 ≈ Laya lineWidth=10)
    float width = lineWidth * 0.00001;
    
    vec3 positionOS = vertex.positionOS;
    
    #ifdef USE_POSITION_SCALING
        // Position scaling mode: expand along position direction
        vec3 dir = normalize(positionOS);
        float flip = dot(dir, normalize(vertex.normalOS)) < 0.0 ? -1.0 : 1.0;
        positionOS += flip * dir * width * 2.0;
    #else
        // Normal mode: expand along normal direction
        positionOS += normalize(vertex.normalOS) * width;
    #endif
    
    vec4 positionWS = worldMat * vec4(positionOS, 1.0);
    vec4 pos = u_Projection * u_View * positionWS;
    
    // Depth bias
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
    // Outline uses outlineColor (default: black) instead of baseColor
    // This matches Cocos behavior where Pass 0 has its own baseColor property
    vec4 color = outlineColor;
    
    // Get main light color for outline (like Cocos: baseColor * cc_mainLitColor)
    #ifdef DIRECTIONLIGHT
        DirectionLight dirLight = getDirectionLight(0, vec3(0.0));
        color.rgb *= dirLight.color;
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

// Toon Surface Structure
struct ToonSurface {
    vec4 baseColor;
    vec4 specular;
    vec3 position;
    vec3 normal;
    vec3 shade1;
    vec3 shade2;
    vec3 emissive;
    float baseStep;
    float baseFeather;
    float shadeStep;
    float shadeFeather;
    float shadowCover;
};

// Get Main Direction Light
void getMainDirectionLight(out vec3 lightColor, out vec3 lightDir, in vec3 positionWS)
{
    #ifdef DIRECTIONLIGHT
        DirectionLight dirLight = getDirectionLight(0, positionWS);
        Light light = getLight(dirLight);
        lightColor = light.color;
        lightDir = light.dir;
    #else
        // Fallback: use default light direction
        lightColor = vec3(1.0, 1.0, 1.0);
        lightDir = normalize(vec3(0.5, -1.0, 0.2));
    #endif
}

// Toon Shading Function
// Inspired by Cocos CCToonShading - matches the exact behavior
vec4 ToonShading(ToonSurface s)
{
    vec3 position = s.position;
    vec3 V = normalize(u_CameraPos - position);
    vec3 N = normalize(s.normal);

    vec3 lightColor;
    vec3 lightDir;
    getMainDirectionLight(lightColor, lightDir, position);
    
    vec3 L = normalize(-lightDir);
    
    // Half-Lambert style NdotL (same as Cocos)
    float NL = 0.5 * dot(N, L) + 0.5;
    
    // Half vector for specular
    vec3 H = normalize(V + L);
    float NH = 0.5 * dot(H, N) + 0.5;
    
    // Light color multiplied by baseStep (matching Cocos behavior)
    // In Cocos: vec3 lightColor = cc_mainLitColor.rgb * cc_mainLitColor.w * s.baseStep;
    vec3 litColor = lightColor * s.baseStep;

    // Toon Diffuse: Two-step shade transition
    // Step 1: Calculate blend factor for shade1 -> shade2 transition
    // When NL < shadeStep, we blend towards shade2
    float shadeFeatherSafe = max(s.shadeFeather, 0.0001);
    float shadeBlend = clamp(1.0 + (s.shadeStep - s.shadeFeather - NL) / shadeFeatherSafe, 0.0, 1.0);
    vec3 diffuse = mix(s.shade1, s.shade2, shadeBlend);
    
    // Step 2: Calculate blend factor for baseColor -> shaded transition
    // When NL < baseStep, we blend towards shaded colors
    float baseFeatherSafe = max(s.baseFeather, 0.0001);
    float baseBlend = clamp(1.0 + (s.baseStep - s.baseFeather - NL) / baseFeatherSafe, 0.0, 1.0);
    diffuse = mix(s.baseColor.rgb, diffuse, baseBlend);

    // Toon Specular: Hard edge specular highlight
    // specular.a controls the highlight size (higher = larger highlight)
    float specularWeight = 1.0 - pow(s.specular.a, 5.0);
    float specularMask = step(specularWeight + 0.0001, NH);
    vec3 specularColor = s.specular.rgb * specularMask;

    vec3 dirlightContrib = diffuse + specularColor;
    
    vec3 finalColor = litColor * dirlightContrib;
    finalColor += s.emissive;

    return vec4(finalColor, s.baseColor.a);
}

// Surface Initialization
void initToonSurface(out ToonSurface s)
{
    vec2 uv = v_UV;

    // Shade colors
    s.shade2 = shadeColor2.rgb * colorScale;
    #ifdef USE_2ND_SHADE_MAP
        vec4 shadeMap2Sample = texture2D(shadeMap2, uv);
        s.shade2 *= gammaToLinear(shadeMap2Sample.rgb);
    #endif

    s.shade1 = shadeColor1.rgb * colorScale;
    #ifdef USE_1ST_SHADE_MAP
        vec4 shadeMap1Sample = texture2D(shadeMap1, uv);
        s.shade1 *= gammaToLinear(shadeMap1Sample.rgb);
        #ifdef SHADE_MAP_1_AS_SHADE_MAP_2
            s.shade2 *= s.shade1;
        #endif
    #endif

    // Base color
    vec4 localBaseColor = baseColor;
    #ifdef MAINTEXTURE
        vec4 mainTextureSample = texture2D(mainTexture, uv);
        mainTextureSample.rgb = gammaToLinear(mainTextureSample.rgb);
        localBaseColor *= mainTextureSample;
        #ifdef BASE_COLOR_MAP_AS_SHADE_MAP_1
            s.shade1 *= mainTextureSample.rgb;
        #endif
        #ifdef BASE_COLOR_MAP_AS_SHADE_MAP_2
            s.shade2 *= mainTextureSample.rgb;
        #endif
    #endif
    s.baseColor = localBaseColor;
    s.baseColor.rgb *= colorScale;

    // Alpha test
    #ifdef USE_ALPHA_TEST
        if (s.baseColor.a < alphaThreshold) discard;
    #endif

    // Normal
    s.normal = normalize(v_NormalWS);
    #ifdef USE_NORMAL_MAP
        #ifdef TANGENT
            vec3 normalSample = texture2D(normalMap, uv).xyz - vec3(0.5);
            vec3 tangent = normalize(v_TangentWS);
            vec3 bitangent = normalize(v_BitangentWS);
            s.normal =
                (normalSample.x * normalStrength) * tangent +
                (normalSample.y * normalStrength) * bitangent +
                normalSample.z * s.normal;
            s.normal = normalize(s.normal);
        #endif
    #endif

    s.position = v_PositionWS;

    // Specular
    s.specular = specular;
    #ifdef USE_SPECULAR_MAP
        vec4 specularMapSample = texture2D(specularMap, uv);
        s.specular.rgb *= gammaToLinear(specularMapSample.rgb);
    #endif

    // Emissive
    s.emissive = emissive.rgb * emissiveScale;
    #ifdef USE_EMISSIVE_MAP
        vec4 emissiveMapSample = texture2D(emissiveMap, uv);
        s.emissive *= gammaToLinear(emissiveMapSample.rgb);
    #endif

    // Shade parameters
    s.baseStep = baseStep;
    s.baseFeather = baseFeather;
    s.shadeStep = shadeStep;
    s.shadeFeather = shadeFeather;
    s.shadowCover = shadowCover;
}

void main()
{
    ToonSurface s;
    initToonSurface(s);

    vec4 color = ToonShading(s);

    #ifdef FOG
        color.rgb = sceneLitFog(color.rgb);
    #endif

    gl_FragColor = color;
    gl_FragColor = outputTransform(gl_FragColor);
}
#endGLSL

GLSL End
