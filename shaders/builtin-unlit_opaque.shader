Shader3D Start
{
    type:Shader3D,
    name:builtin-unlit_opaque,
    enableInstancing:true,
    shaderType:D3,
    supportReflectionProbe:true,
    uniformMap:{
        mainTexture: { type: Texture2D, options: { define: "USE_TEXTURE" } },
        tilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },

        mainColor: { type: Color, default: [1, 1, 1, 1] },
        colorScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },
    },
    defines: {
        USE_TEXTURE: { type: bool, default: false },
        USE_VERTEX_COLOR: { type: bool, default: false },
        USE_ALPHA_TEST: { type: bool, default: false },
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
    #include "Scene.glsl";
    #include "SceneFogInput.glsl";
    #include "Camera.glsl";
    #include "Sprite3DVertex.glsl";
    #include "VertexCommon.glsl";

    varying vec2 v_uv;

    #ifdef USE_VERTEX_COLOR
    varying vec4 v_color;
    #endif

    void main()
    {
        Vertex vertex;
        getVertexParams(vertex);

        v_uv = vertex.texCoord0 * tilingOffset.xy + tilingOffset.zw;

        #ifdef USE_VERTEX_COLOR
            v_color = vertex.vertexColor;
        #endif

        mat4 worldMat = getWorldMatrix();
        vec4 pos = (worldMat * vec4(vertex.positionOS, 1.0));
        vec3 positionWS = pos.xyz / pos.w;
        
        gl_Position = getPositionCS(positionWS);
        gl_Position = remapPositionZ(gl_Position);

        #ifdef FOG
            FogHandle(gl_Position.z);
        #endif
    }
#endGLSL

#defineGLSL CCUnlitFS
    #define SHADER_NAME builtin-unlit_opaque

    #include "Color.glsl";
    #include "Scene.glsl";
    #include "SceneFog.glsl";
    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";

    varying vec2 v_uv;

    #ifdef USE_VERTEX_COLOR
    varying vec4 v_color;
    #endif

    void main() 
    {
        vec4 o = mainColor;
        o.rgb *= colorScale;

        #ifdef USE_VERTEX_COLOR
            o.rgb *= gammaToLinear(v_color.rgb);
            o.a *= v_color.a;
        #endif

        #ifdef USE_TEXTURE
            vec4 texColor = texture2D(mainTexture, v_uv);
            #ifdef Gamma_mainTexture
                texColor.rgb = gammaToLinear(texColor.rgb);
            #endif
            o *= texColor;
        #endif

        #ifdef USE_ALPHA_TEST
            if (o.a < alphaThreshold) discard;
        #endif
        
        #ifdef FOG
            o.rgb = scenUnlitFog(o.rgb);
        #endif

        gl_FragColor = o;
        gl_FragColor = outputTransform(gl_FragColor);
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


