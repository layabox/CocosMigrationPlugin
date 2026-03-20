Shader3D Start
{
    type:Shader3D,
    name:standard_default,
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
            VS:StdDefaultVS,
            FS:StdDefaultFS
        }
    ]
}
Shader3D End

GLSL Start
#defineGLSL StdDefaultVS
    #define SHADER_NAME StdDefaultVS

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

#defineGLSL StdDefaultFS
    #define SHADER_NAME StdDefaultFS

    #include "Color.glsl";
    #include "Scene.glsl";
    #include "SceneFog.glsl";
    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";
    #include "PBRMetallicFrag.glsl";

    void initSurfaceInputs(inout SurfaceInputs inputs, inout PixelParams pixel)
    {
        #ifdef UV
            // Use Cocos-style UV transform (no V-flip like LayaAir's transformUV)
            vec2 uv = pixel.uv0 * tilingOffset.xy + tilingOffset.zw;
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
            // Always convert sRGB to linear for Cocos-migrated textures
            albedoSampler = gammaToLinear(albedoSampler);
            inputs.diffuseColor *= albedoSampler.rgb;
            inputs.alpha *= albedoSampler.a;
        #endif

        inputs.diffuseColor *= albedoScale;

        // Normal
        inputs.normalTS = vec3(0.0, 0.0, 1.0);
        #ifdef NORMALTEXTURE
            vec3 normalSampler = texture2D(normalMap, uv).rgb;
            normalSampler = normalize(normalSampler * 2.0 - 1.0);
            normalSampler.y *= -1.0;
            inputs.normalTS = normalScale(normalSampler, normalStrength);
        #endif

        inputs.metallic = metallic;
        inputs.smoothness = 1.0 - roughness;
        inputs.occlusion = 1.0;

        #ifdef METALLICGLOSSTEXTURE
            vec4 pbrSampler = texture2D(pbrMap, uv);
            // Cocos channel mapping: .r=occlusion, .g=roughness, .b=metallic, .a=specularIntensity
            inputs.occlusion = mix(1.0, pbrSampler.r, occlusion);
            inputs.smoothness = 1.0 - (pbrSampler.g * roughness);
            inputs.metallic = pbrSampler.b * metallic;
        #else
            #ifdef OCCLUSIONTEXTURE
                vec4 occlusionSampler = texture2D(occlusionMap, uv);
                float occTex = occlusionSampler.g;
                inputs.occlusion = (1.0 - occlusion) + occTex * occlusion;
            #endif
        #endif

        // Emission
        inputs.emissionColor = vec3(0.0);
        #ifdef EMISSION
            inputs.emissionColor = emissive.rgb * emissiveScale;
            #ifdef EMISSIONTEXTURE
                vec4 emissionSampler = texture2D(emissiveMap, uv);
                // Always convert sRGB to linear for Cocos-migrated textures
                emissionSampler = gammaToLinear(emissionSampler);
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
        
        #ifdef FOG
            surfaceColor.rgb = sceneLitFog(surfaceColor.rgb);
        #endif

        gl_FragColor = surfaceColor;
        gl_FragColor = outputTransform(gl_FragColor);
    }
#endGLSL
GLSL End
