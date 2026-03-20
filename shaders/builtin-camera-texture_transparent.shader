Shader3D Start
{
    type:Shader3D,
    name:builtin-camera-texture_transparent,
    enableInstancing:false,
    shaderType:D3,
    supportReflectionProbe:false,
    uniformMap:{
        alphaThreshold: { type: Float, default: 0.5 },
        mainColor: { type: Color, default: [1, 1, 1, 1] },
        colorScale: { type: Vector3, default: [1, 1, 1] },
        mainTexture: { type: Texture2D, options: { define: "MAINTEXTURE" } },
        tilingOffset: { type: Vector4, default: [1, 1, 0, 0] }
    },
    defines: {
        USE_ALPHA_TEST: { type: bool, default: false }
    },
    shaderPass:[
        {
            pipeline:Forward,
            VS:builtinCameraTextureTransparentVS,
            FS:builtinCameraTextureTransparentPS,
            renderState:{
                blend:true,
                blendSrc:"SrcAlpha",
                blendDst:"OneMinusSrcAlpha",
                depthWrite:false
            }
        }
    ]
}
Shader3D End


GLSL Start
#defineGLSL builtinCameraTextureTransparentVS
    #define SHADER_NAME builtin-camera-texture_transparent

    #include "Math.glsl";
    #include "Scene.glsl";
    #include "SceneFogInput.glsl";
    #include "Camera.glsl";
    #include "Sprite3DVertex.glsl";
    #include "VertexCommon.glsl";

    varying vec2 v_uv;
    varying vec4 v_color;

    void main()
    {
        Vertex vertex;
        getVertexParams(vertex);

        // 直接使用 UV 坐标，不需要条件判断
        v_uv = vertex.texCoord0 * tilingOffset.xy + tilingOffset.zw;

        #ifdef COLOR
            v_color = vertex.vertexColor;
        #else
            v_color = vec4(1.0);
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

#defineGLSL builtinCameraTextureTransparentPS
    #define SHADER_NAME builtin-camera-texture_transparent

    #include "Color.glsl";
    #include "Scene.glsl";
    #include "SceneFog.glsl";
    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";

    varying vec2 v_uv;
    varying vec4 v_color;

    void main()
    {
        vec4 o = mainColor;
        o.rgb *= colorScale;
        
        #ifdef COLOR
            o *= v_color;
        #endif
        
        #ifdef MAINTEXTURE
            o *= texture2D(mainTexture, v_uv);
        #endif
        
        #ifdef USE_ALPHA_TEST
            if (o.a < alphaThreshold) discard;
        #endif
        
        #ifdef FOG
            o.rgb = sceneLitFog(o.rgb);
        #endif
        
        gl_FragColor = o;
        gl_FragColor = outputTransform(gl_FragColor);
    }
#endGLSL
GLSL End
