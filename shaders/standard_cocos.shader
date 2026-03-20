Shader3D Start
{
    type:Shader3D,
    name:standard_cocos,
    enableInstancing:true,
    shaderType:D3,
    supportReflectionProbe:false,
    uniformMap:{
        // Base Color
        u_AlbedoColor: { type: Color, default: [1.0, 1.0, 1.0, 1.0] },
        u_AlbedoTexture: { type: Texture2D, options: { define: "ALBEDOTEXTURE" } },

        // PBR Parameters
        u_Metallic: { type: Float, default: 0.0 },
        u_Smoothness: { type: Float, default: 0.5 },
        u_AlphaTestValue: { type: Float, default: 0.5 },

        // Tiling and Offset
        u_TilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },

        // Normal Map
        u_NormalTexture: { type: Texture2D, options: { define: "NORMALTEXTURE" } },
        u_NormalScale: { type: Float, default: 1.0 },

        // Emissive
        u_EmissionColor: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },
        u_EmissionTexture: { type: Texture2D, options: { define: "EMISSIONTEXTURE" } },
    },
    defines: {
        ALPHATEST: { type: bool, default: false },
    },
    shaderPass:[
        // Pass 0: Main PBR Pass
        {
            pipeline:Forward,
            VS:StandardCocosVS,
            FS:StandardCocosFS
        },
        // Pass 1: Shadow Caster Pass
        {
            pipeline:ShadowCaster,
            VS:StandardCocosShadowVS,
            FS:StandardCocosShadowFS
        }
    ]
}
Shader3D End

GLSL Start
// ============================================
// MAIN VERTEX SHADER
// ============================================
#defineGLSL StandardCocosVS
#define SHADER_NAME standard_cocos

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
        v_UV = vertex.texCoord0 * u_TilingOffset.xy + u_TilingOffset.zw;
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
// MAIN FRAGMENT SHADER
// ============================================
#defineGLSL StandardCocosFS
#define SHADER_NAME standard_cocos

#include "Color.glsl";
#include "Scene.glsl";
#include "SceneFog.glsl";
#include "Camera.glsl";
#include "Sprite3DFrag.glsl";
#include "Lighting.glsl";
#include "globalIllumination.glsl";

#define PI 3.14159265359
#define INV_PI 0.31830988618
#define EPSILON 1e-6

in vec3 v_PositionWS;
in vec2 v_UV;
in vec3 v_NormalWS;

#ifdef TANGENT
in vec3 v_TangentWS;
in vec3 v_BitangentWS;
#endif

// Cocos GGX Distribution (D)
float D_GGX(float roughness, float NoH) {
    float a = roughness * roughness;
    float a2 = a * a;
    float d = (NoH * a2 - NoH) * NoH + 1.0;
    return a2 / max(EPSILON, PI * d * d);
}

// Cocos Smith GGX Visibility (G / denominator)
float V_SmithGGX(float roughness, float NoV, float NoL) {
    float k = (0.5 + 0.5 * roughness);
    k = k * k;
    float GV = NoV * (1.0 - k) + k;
    float GL = NoL * (1.0 - k) + k;
    return 0.25 / max(EPSILON, GV * GL);
}

// Schlick Fresnel
vec3 F_Schlick(vec3 F0, float VoH) {
    float Fc = pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
    return F0 * (1.0 - Fc) + vec3(Fc);
}

void main()
{
    vec2 uv = v_UV;

    // Albedo
    vec4 albedo = u_AlbedoColor;
    #ifdef ALBEDOTEXTURE
        vec4 texColor = texture2D(u_AlbedoTexture, uv);
        albedo *= texColor;
    #endif

    // Alpha test
    #ifdef ALPHATEST
        if (albedo.a < u_AlphaTestValue) discard;
    #endif

    // PBR parameters
    float metallic = u_Metallic;
    float perceptualRoughness = 1.0 - u_Smoothness;
    float roughness = max(perceptualRoughness, 0.045);

    // F0 - Cocos uses specularIntensity=0.5 default: F0 = 0.04 * 0.5 = 0.02 for dielectrics
    // But standard value is 0.04
    vec3 F0 = mix(vec3(0.04), albedo.rgb, metallic);
    vec3 diffuseColor = albedo.rgb * (1.0 - metallic);

    // Normal
    vec3 N = normalize(v_NormalWS);
    #ifdef NORMALTEXTURE
        #ifdef TANGENT
            vec3 normalSample = texture2D(u_NormalTexture, uv).xyz * 2.0 - 1.0;
            normalSample.xy *= u_NormalScale;
            vec3 tangent = normalize(v_TangentWS);
            vec3 bitangent = normalize(v_BitangentWS);
            N = normalize(tangent * normalSample.x + bitangent * normalSample.y + N * normalSample.z);
        #endif
    #endif

    // View direction
    vec3 V = normalize(u_CameraPos - v_PositionWS);
    float NoV = max(dot(N, V), EPSILON);

    // Lighting
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
    vec3 H = normalize(V + L);

    float NoL = max(dot(N, L), 0.0);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 0.0);

    // Cocos standard direct lighting:
    // irradiance = NoL × lightColor × intensity (intensity already in lightColor)
    vec3 irradiance = lightColor * NoL;

    // Diffuse: Lambert with energy conservation (1/π) matching Cocos
    vec3 Fd = diffuseColor * INV_PI;

    // Specular: D × V × F (matching Cocos standard)
    float D = D_GGX(roughness, NoH);
    float Vis = V_SmithGGX(roughness, NoV, NoL);
    vec3 F = F_Schlick(F0, VoH);
    vec3 Fr = vec3(D * Vis) * F;

    // Combine direct lighting with shadow
    vec3 directColor = (Fd + Fr) * irradiance * shadowAtten;

    // Scene ambient light (matching Cocos cc_ambientSky/cc_ambientGround)
    vec3 ambient = diffuseColor * u_AmbientColor.rgb * u_AmbientIntensity;

    vec3 finalColor = directColor + ambient;

    // Emissive
    vec3 emissiveContrib = u_EmissionColor.rgb;
    #ifdef EMISSIONTEXTURE
        emissiveContrib *= texture2D(u_EmissionTexture, uv).rgb;
    #endif
    finalColor += emissiveContrib;

    #ifdef FOG
        finalColor = sceneLitFog(finalColor);
    #endif

    gl_FragColor = vec4(finalColor, albedo.a);
    gl_FragColor = outputTransform(gl_FragColor);
}
#endGLSL

// ============================================
// SHADOW CASTER VERTEX SHADER
// ============================================
#defineGLSL StandardCocosShadowVS
#define SHADER_NAME StandardCocosShadowVS

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
// SHADOW CASTER FRAGMENT SHADER
// ============================================
#defineGLSL StandardCocosShadowFS
#define SHADER_NAME StandardCocosShadowFS

#include "DepthFrag.glsl";

in vec2 v_UV;

void main()
{
    #ifdef ALPHATEST
        float alpha = u_AlbedoColor.a;
        #ifdef ALBEDOTEXTURE
            alpha *= texture2D(u_AlbedoTexture, v_UV).a;
        #endif
        if (alpha < u_AlphaTestValue) discard;
    #endif

    gl_FragColor = getDepthColor();
}
#endGLSL

GLSL End
