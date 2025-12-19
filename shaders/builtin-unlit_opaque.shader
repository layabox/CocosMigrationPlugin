Shader3D Start
{
    type:Shader3D,
    name:builtin-unlit_opaque,
    enableInstancing:true,
    shaderType:D3,
    supportReflectionProbe:true,
    uniformMap:{
        mainTexture: { type: Texture2D },
        tilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },

        mainColor: { type: Color, default: [1, 1, 1, 1] },
        colorScale: { type: Vector3 ,default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },
    },
    shaderPass:[
        {
            pipeline:Forward,
            VS:CCUnlitVS,
            FS:CCUnlitFS
        },
        // {
        //     pipeline:Forward,
        //     VS:CCUnlitPlanarShadowVS,
        //     FS:CCUnlitPlanarShadowFS
        // }
    ]
}
Shader3D End

GLSL Start
#defineGLSL CCUnlitVS
#define SHADER_NAME builtin-unlit_opaque

#include "Math.glsl";
#include "Sprite3DVertex.glsl";
#include "Camera.glsl";
#include "VertexCommon.glsl";

#ifdef USE_VERTEX_COLOR
out vec4 v_color;
#endif

#ifdef USE_TEXTURE
varying vec2 v_uv;
#endif

void main()
{
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();

    #ifdef USE_TEXTURE
        v_uv = a_Texcoord0 * tilingOffset.xy + tilingOffset.zw;
        #ifdef SAMPLE_FROM_RT
            v_uv = u_CameraPos.w > 1.0 ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv;
        #endif
    #endif

    #ifdef USE_VERTEX_COLOR
        v_color = a_Color;
    #endif


    gl_Position = u_Projection * (u_View * worldMat) * vec4(vertex.positionOS, 1.0);

    // #ifdef FOG
    //     FogHandle(gl_Position.z);
    // #endif
}
#endGLSL

#defineGLSL CCUnlitFS

    #define SHADER_NAME builtin-unlit_opaque

#include "Color.glsl";
// #include "SceneFog.glsl";

varying vec2 v_uv;

#ifdef USE_VERTEX_COLOR
in vec4 v_color;
#endif


void main() 
{
    vec4 o = mainColor;
    o.rgb *= colorScale;

    #ifdef USE_VERTEX_COLOR
        o.rgb *= gammaToLinear(v_color.rgb);//use linear
        o.a *= v_color.a;
    #endif

    #ifdef USE_TEXTURE
        vec4 texColor = texture2D(mainTexture, v_uv);
        texColor.rgb = gammaToLinear(texColor.rgb);
        o *= texColor;
    #endif

    #ifdef USE_ALPHA_TEST
        // 根据 ALPHA_TEST_CHANNEL 宏定义选择不同的通道进行测试
        float alphaTestValue = alphaThreshold;
        #ifdef ALPHA_TEST_CHANNEL_r
            if (o.r < alphaTestValue) discard;
        #elif defined(ALPHA_TEST_CHANNEL_g)
            if (o.g < alphaTestValue) discard;
        #elif defined(ALPHA_TEST_CHANNEL_b)
            if (o.b < alphaTestValue) discard;
        #elif defined(ALPHA_TEST_CHANNEL_a)
            if (o.a < alphaTestValue) discard;
        #else
            // 默认使用 alpha 通道
            if (o.a < alphaTestValue) discard;
        #endif
    #endif
    
    // #ifdef FOG
    //     o = sceneLitFog(o);
    // #endif
    gl_FragColor = o;
}
#endGLSL

#defineGLSL CCUnlitPlanarShadowVS
#define SHADER_NAME CCUnlitPlanarShadowVS

#define EPSILON_LOWP 1.0e-4

#include "Math.glsl";
#include "Camera.glsl";
// #include "Lighting.glsl";
#include "VertexCommon.glsl";
#include "Sprite3DVertex.glsl";

varying float v_dist;

vec4 CalculatePlanarShadowPos(vec3 meshWorldPos, vec3 cameraPos, vec3 lightDir, vec4 plane) {
    vec3 P = meshWorldPos;
    vec3 L = lightDir;
    vec3 N = plane.xyz;
    float d = plane.w + EPSILON_LOWP;
    float dist = (-d - dot(P, N)) / (dot(L, N) + EPSILON_LOWP);
    vec3 shadowPos = P + L * dist;

    return vec4(shadowPos, dist);
}

vec4 CalculatePlanarShadowClipPos(vec4 shadowPos, vec3 cameraPos, mat4 matView, mat4 matProj, vec4 nearFar, float bias) {
  vec4 camPos = matView * vec4(shadowPos.xyz, 1.0);
  float lerpCoef = saturate((nearFar.z < 0.0 ? -camPos.z : camPos.z) / (nearFar.y - nearFar.x));
  camPos.z += mix(nearFar.x * 0.01, nearFar.y * EPSILON_LOWP * bias, lerpCoef);
  return matProj * camPos;
}

void main() 
{
    Vertex vertex;
    getVertexParams(vertex);

    vec4 position;
    position = vec4(vertex.positionOS, 1.0);

    mat4 worldMat = getWorldMatrix();
    mat4 worldMatIT = transpose(inverse(worldMat));

    // Light light;
    // light = getLight(getDirectionLight(0,vec3(0.0,0.0,0.0)));
    vec3 light = vec3(0.5, -1.0, 0.2);

    vec4 planar = vec4(0.0, 1.0, 0.0, 0.0);

    vec4 nearFar = vec4(0.3, 1000.0, 1.0, 0.0);

    vec3 worldPos = (worldMat * position).xyz;
    vec4 shadowPos = CalculatePlanarShadowPos(worldPos, u_CameraPos.xyz, light, planar);
    position = CalculatePlanarShadowClipPos(shadowPos, u_CameraPos.xyz, u_View, u_Projection, nearFar, 1.0);

    v_dist = shadowPos.w;
    gl_Position = position;
}
#endGLSL

#defineGLSL CCUnlitPlanarShadowFS
#define SHADER_NAME CCUnlitPlanarShadowFS

varying float v_dist;

void main()
{
    if(v_dist < 0.0)
    discard;

    gl_FragColor = vec4(0.1, 0.1, 0.1, 1.0);
    // gl_FragColor = test;
}
#endGLSL
GLSL End


