Shader3D Start
{
    type:Shader3D,
    name:standard_opaque,
    enableInstancing:true,
    supportReflectionProbe:true,
    shaderType:D3, 
    uniformMap:{
        tilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },
        mainColor: { type: Color, default: [1.0, 1.0, 1.0, 1.0] },
        albedoScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },
        occlusion: { type: Float, default: 0.0 },
        roughness: { type: Float, default: 0.5 },
        metallic: { type: Float, default: 0.0 },
        specularIntensity: { type: Float, default: 0.5 },
        emissive: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },
        emissiveScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        normalStrength: { type: Float, default: 1.0 },
        mainTexture: { type: Texture2D, options: { define: "ALBEDOTEXTURE" } },
        normalMap: { type: Texture2D, options: { define: "NORMALTEXTURE" } },
        pbrMap: { type: Texture2D, options: { define: "METALLICGLOSSTEXTURE" } },
        occlusionMap: { type: Texture2D, options: { define: "OCCLUSIONTEXTURE" } },
        emissiveMap: { type: Texture2D, options: { define: "EMISSIONTEXTURE" } },
    },
    defines: {
        ENABLEVERTEXCOLOR: { type: bool, default: false },
        ALBEDOTEXTURE: { type: bool, default: false },
        NORMALTEXTURE: { type: bool, default: false },
        METALLICGLOSSTEXTURE: { type: bool, default: false },
        OCCLUSIONTEXTURE: { type: bool, default: false },
        EMISSIONTEXTURE: { type: bool, default: false },
        ALPHATEST: { type: bool, default: false },
    },
    shaderPass:[
        {
            pipeline:Forward,
            VS:StandardVS,
            FS:StandardFS
        }
    ]
}
Shader3D End

GLSL Start
#defineGLSL StandardVS
    #define SHADER_NAME StandardVS

    #include "Math.glsl";
    #include "Scene.glsl";
    #include "SceneFogInput.glsl";
    #include "Camera.glsl";
    #include "Sprite3DVertex.glsl";
    #include "VertexCommon.glsl";
    #include "PBRVertex.glsl";

    void main()
    {
        Vertex vertex;
        getVertexParams(vertex);

        PixelParams pixel;
        initPixelParams(pixel, vertex);

        gl_Position = getPositionCS(pixel.positionWS);
        gl_Position = remapPositionZ(gl_Position);

        #ifdef FOG
            FogHandle(gl_Position.z);
        #endif
    }
#endGLSL

#defineGLSL StandardFS
    #define SHADER_NAME StandardFS

    #include "Color.glsl";
    #include "Scene.glsl";
    #include "SceneFog.glsl";
    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";
    #include "PBRMetallicFrag.glsl";

    void initSurfaceInputs(inout SurfaceInputs inputs, inout PixelParams pixel)
    {
        #ifdef UV
            vec2 uv = transformUV(pixel.uv0, tilingOffset);
        #else
            vec2 uv = vec2(0.0);
        #endif

        // Cocos mainColor -> Laya diffuseColor
        inputs.diffuseColor = mainColor.rgb;
        inputs.alpha = mainColor.a;

        #ifdef COLOR
            #ifdef ENABLEVERTEXCOLOR
                inputs.diffuseColor *= pixel.vertexColor.xyz;
                inputs.alpha *= pixel.vertexColor.a;
            #endif
        #endif

        inputs.alphaTest = alphaThreshold;

        #ifdef ALBEDOTEXTURE
            vec4 albedoSampler = texture2D(mainTexture, uv);
            #ifdef Gamma_mainTexture
                albedoSampler = gammaToLinear(albedoSampler);
            #endif
            inputs.diffuseColor *= albedoSampler.rgb;
            inputs.alpha *= albedoSampler.a;
        #endif

        // Cocos albedoScale
        inputs.diffuseColor *= albedoScale;

        // Normal
        inputs.normalTS = vec3(0.0, 0.0, 1.0);
        #ifdef NORMALTEXTURE
            vec3 normalSampler = texture2D(normalMap, uv).rgb;
            normalSampler = normalize(normalSampler * 2.0 - 1.0);
            normalSampler.y *= -1.0;
            inputs.normalTS = normalScale(normalSampler, normalStrength);
        #endif

        // PBR params - Cocos style
        // Cocos: roughness is roughness, Laya: smoothness = 1 - roughness
        // But in this shader, we follow Cocos convention where roughness uniform IS roughness
        inputs.metallic = metallic;
        inputs.smoothness = 1.0 - roughness; // Convert Cocos roughness to Laya smoothness

        #ifdef METALLICGLOSSTEXTURE
            vec4 pbrSampler = texture2D(pbrMap, uv);
            // Cocos pbrMap channels: r: occlusion, g: roughness, b: metallic, a: specularIntensity
            inputs.metallic = pbrSampler.b * metallic;
            inputs.smoothness = 1.0 - (pbrSampler.g * roughness);
        #endif

        // Occlusion
        inputs.occlusion = 1.0;
        #ifdef OCCLUSIONTEXTURE
            vec4 occlusionSampler = texture2D(occlusionMap, uv);
            // Cocos uses .r channel for occlusion in occlusionMap, .g in pbrMap
            inputs.occlusion = mix(1.0, occlusionSampler.r, occlusion);
        #endif
        #ifdef METALLICGLOSSTEXTURE
            // If using pbrMap, occlusion is in .r channel
            vec4 pbrOcc = texture2D(pbrMap, uv);
            inputs.occlusion = mix(1.0, pbrOcc.r, occlusion);
        #endif

        // Emission
        inputs.emissionColor = vec3(0.0);
        #ifdef EMISSION
            inputs.emissionColor = emissive.rgb * emissiveScale;
            #ifdef EMISSIONTEXTURE
                vec4 emissionSampler = texture2D(emissiveMap, uv);
                #ifdef Gamma_emissiveMap
                    emissionSampler = gammaToLinear(emissionSampler);
                #endif
                inputs.emissionColor *= emissionSampler.rgb;
            #endif
        #endif
    }

    void main()
    {
        PixelParams pixel;
        getPixelParams(pixel);

        SurfaceInputs inputs;
        initSurfaceInputs(inputs, pixel);

        vec4 surfaceColor = PBR_Metallic_Flow(inputs, pixel);
        
        // 亮度校正：Laya PBR 整体偏亮，适当降低以匹配 Cocos
        surfaceColor.rgb *= 0.85;
        
        // 对比度增强：提高对比度使画面更有层次感
        float contrast = 1.3; // 对比度系数，大于1增加对比度
        surfaceColor.rgb = (surfaceColor.rgb - 0.5) * contrast + 0.5;
        
        #ifdef FOG
            surfaceColor.rgb = sceneLitFog(surfaceColor.rgb);
        #endif

        gl_FragColor = surfaceColor;
        gl_FragColor = outputTransform(gl_FragColor);
    }
#endGLSL
GLSL End
