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
        mainColor: { type: Color, default: [1.0, 1.0, 1.0, 1.0] },
        colorScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },
    },
    defines: {
        ENABLEVERTEXCOLOR: { type: bool, default: false },
        ALBEDOTEXTURE: { type: bool, default: false },
        ALPHATEST: { type: bool, default: false },
    }
    shaderPass:[
        {
            pipeline:Forward,
            VS:unlitVS,
            FS:unlitPS
        }
    ]
}
Shader3D End

GLSL Start
#defineGLSL unlitVS

    #define SHADER_NAME CCUnlitShaderVS

    #include "Math.glsl";

    #include "Scene.glsl";
    #include "SceneFogInput.glsl";

    #include "Camera.glsl";
    #include "Sprite3DVertex.glsl";

    #include "VertexCommon.glsl";

    #ifdef UV
    varying vec2 v_Texcoord0;
    #endif // UV

    #ifdef COLOR
    varying vec4 v_VertexColor;
    #endif // COLOR

    void main()
    {
        Vertex vertex;
        getVertexParams(vertex);

    #ifdef UV
        v_Texcoord0 = transformUV(vertex.texCoord0, tilingOffset);
    #endif // UV

    #ifdef COLOR
        v_VertexColor = vertex.vertexColor;
    #endif // COLOR

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

#defineGLSL unlitPS

    #define SHADER_NAME CCUnlitShaderFS

    #include "Color.glsl";

    #include "Scene.glsl";
    #include "SceneFog.glsl";

    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";

    // varying vec4 v_Color;
    // varying vec2 v_Texcoord0;

    #ifdef UV
        varying vec2 v_Texcoord0;
    #endif // UV

    #ifdef COLOR
        varying vec4 v_VertexColor;
    #endif // COLOR

    void main()
    {
        vec3 color = mainColor.rgb;
        float alpha = mainColor.a;

        #ifdef COLOR
        #ifdef ENABLEVERTEXCOLOR
            vec4 vertexColor = v_VertexColor;
            color *= vertexColor.rgb;
            alpha *= vertexColor.a;
        #endif // ENABLEVERTEXCOLOR
        #endif // COLOR

        #ifdef UV
            vec2 uv = v_Texcoord0;

        #ifdef ALBEDOTEXTURE
            vec4 albedoSampler = texture2D(mainTexture, uv);

        #ifdef Gamma_u_AlbedoTexture
            albedoSampler = gammaToLinear(albedoSampler);
        #endif // Gamma_u_AlbedoTexture

            color *= albedoSampler.rgb;
            alpha *= albedoSampler.a;
        #endif // ALBEDOTEXTURE
        #endif // UV

        #ifdef ALPHATEST
            if (alpha < alphaThreshold)
            discard;
        #endif // ALPHATEST

        #ifdef FOG
            color = scenUnlitFog(color);
        #endif // FOG

        gl_FragColor = vec4(color, alpha);
        gl_FragColor = outputTransform(gl_FragColor);
    }
#endGLSL
GLSL End