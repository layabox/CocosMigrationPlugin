Shader3D Start
{
    type:Shader3D,
    name:builtin-camera-texture_add,
    enableInstancing:false,
    shaderType:D3,
    supportReflectionProbe:false,
    uniformMap:{
        u_AlphaTestValue: { type: Float, default: 0.5 },
        u_AlbedoColor: { type: Color, default: [1, 1, 1, 1] },
        u_TilingOffset: { type: Vector4, default: [1, 1, 0, 0] },
        u_AlbedoTexture: { type: Texture2D, options: { define: "ALBEDOTEXTURE" } }
    },
    defines: {
        ALPHATEST: { type: bool, default: false }
    },
    shaderPass:[
        {
            pipeline:Forward,
            VS:builtinCameraTextureAddVS,
            FS:builtinCameraTextureAddPS,
            blendState:{
                blend:true,
                blendSrc:BlendFactor.SourceAlpha,
                blendDst:BlendFactor.One
            }
        }
    ]
}
Shader3D End


GLSL Start
#defineGLSL builtinCameraTextureAddVS
    #define SHADER_NAME builtin-camera-texture_add

    #include "Math.glsl";
    #include "Scene.glsl";
    #include "SceneFogInput.glsl";
    #include "Camera.glsl";
    #include "Sprite3DVertex.glsl";
    #include "VertexCommon.glsl";

    varying vec2 v_Texcoord0;

    void main()
    {
        Vertex vertex;
        getVertexParams(vertex);

    #ifdef UV
        // Use Cocos-style UV transform (no V-flip like LayaAir's transformUV)
        v_Texcoord0 = vertex.texCoord0 * u_TilingOffset.xy + u_TilingOffset.zw;
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

#defineGLSL builtinCameraTextureAddPS
    #define SHADER_NAME builtin-camera-texture_add

    #include "Color.glsl";
    #include "Scene.glsl";
    #include "SceneFog.glsl";
    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";

    varying vec2 v_Texcoord0;

    void main()
    {
        vec4 color = u_AlbedoColor;

    #ifdef ALBEDOTEXTURE
        vec4 texColor = texture2D(u_AlbedoTexture, v_Texcoord0);
        color *= texColor;
    #endif

    #ifdef ALPHATEST
        if (color.a < u_AlphaTestValue) discard;
    #endif

        gl_FragColor = color;
        gl_FragColor = outputTransform(gl_FragColor);
    }
#endGLSL
GLSL End

