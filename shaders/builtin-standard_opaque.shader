Shader3D Start
{
    type:Shader3D,
    name:builtin-standard_opaque,
    enableInstancing:true,
    supportReflectionProbe:true,
    shaderType:D3, 
    uniformMap:{
        tilingOffset: { type: Vector4, default: [1.0, 1.0, 0.0, 0.0] },
        mainColor: { type: Color, default: [1.0, 1.0, 1.0, 1.0] },
        albedoScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        alphaThreshold: { type: Float, default: 0.5 },
        occlusion: { type: Float, default: 0.5 },
        roughness: { type: Float, default: 0.5 },
        metallic: { type: Float, default: 0.0 },
        specularIntensity: { type: Float, default: 0.5 },
        emissive: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },
        emissiveScale: { type: Vector3, default: [1.0, 1.0, 1.0] },
        normalStrength: { type: Float, default: 1.0 },
        anisotropyIntensity: { type: Float, default: 1.0 },
        anisotropyRotation: { type: Float, default: 0.0 },
        anisotropyMapResolutionHeight: { type: Float, default: 0.0 },
        addOnShadowBias: { type: Float, default: 0.0 },
        mainTexture: { type: Texture2D },
        normalMap: { type: Texture2D },
        pbrMap: { type: Texture2D },
        occlusionMap: { type: Texture2D },
        emissiveMap: { type: Texture2D },
        anisotropyMap: { type: Texture2D },
        anisotropyMapNearestFilter: { type: Texture2D },
    },
    defines: {
        ENABLEVERTEXCOLOR: { type: bool, default: false },
        ALBEDOTEXTURE: { type: bool, default: false },
        NORMALTEXTURE: { type: bool, default: false },
        METALLICGLOSSTEXTURE: { type: bool, default: false },
        OCCLUSIONTEXTURE: { type: bool, default: false },
        EMISSIONTEXTURE: { type: bool, default: false },
        ANISOTROPY: { type: bool, default: false },
        ANISOTROPYMAP: { type: bool, default: false },
        ALPHATEST: { type: bool, default: false },

        HAS_SECOND_UV: { type: bool, default: false },
        USE_TWOSIDE: { type: bool, default: false },
        FIX_ANISOTROPIC_ROTATION_MAP: { type: bool, default: false },
    },
    shaderPass:[
        {
            pipeline:Forward,
            VS:CCPBRVS,
            FS:CCPBRFS
        }
    ]
}
Shader3D End

GLSL Start
#defineGLSL CCPBRVS
    #define SHADER_NAME CCPBRShaderVS

    #include "Math.glsl";

    #include "Scene.glsl";
    #include "SceneFogInput.glsl"

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
    #endif // FOG 
    }
    
#endGLSL

#defineGLSL CCPBRFS
    #define SHADER_NAME CCPBRShaderFS

    // #include "./public/defineConvert.glsl";

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
        #else // UV
            vec2 uv = vec2(0.0);
        #endif // UV

            inputs.diffuseColor = mainColor.rgb;
            inputs.alpha = mainColor.a;

        #ifdef COLOR
            #ifdef ENABLEVERTEXCOLOR
                inputs.diffuseColor *= pixel.vertexColor.xyz;
                inputs.alpha *= pixel.vertexColor.a;
            #endif // ENABLEVERTEXCOLOR
        #endif // COLOR

            inputs.alphaTest = alphaThreshold;

        #ifdef ALBEDOTEXTURE
            vec4 albedoSampler = texture2D(mainTexture, uv);
            #ifdef Gamma_u_AlbedoTexture
                albedoSampler = gammaToLinear(albedoSampler);
            #endif // Gamma_u_AlbedoTexture
                inputs.diffuseColor *= albedoSampler.rgb;
                inputs.alpha *= albedoSampler.a;
        #endif // ALBEDOTEXTURE

        // Detail Albedo  细节反照率纹理，cocos中暂时没找到对应实现
        #ifdef DETAILTEXTURE
            vec3 detailSampler = texture2D(u_DetailAlbedoTexture, v_DetailUV).rgb;
            #ifdef Gamma_u_DetailAlbedoTexture
            detailSampler = gammaToLinear(detailSampler);
            #endif // Gamma_u_DetailAlbedoTexture
            detailSampler *= ColorSpaceDouble;
            inputs.diffuseColor *= detailSampler;
        #endif

            inputs.normalTS = vec3(0.0, 0.0, 1.0);
        #ifdef NORMALTEXTURE
            vec3 normalSampler = texture2D(normalMap, uv).rgb;
            normalSampler = normalize(normalSampler * 2.0 - 1.0);
            normalSampler.y *= -1.0;
            inputs.normalTS = normalScale(normalSampler, normalStrength);
        #endif

            inputs.metallic = metallic;
            inputs.smoothness = roughness;

        #ifdef METALLICGLOSSTEXTURE
            vec4 metallicSampler = texture2D(pbrMap, uv);
            inputs.metallic = metallicSampler.x;
            inputs.smoothness = (metallicSampler.a * roughness);
        #endif // METALLICGLOSSTEXTURE

            inputs.occlusion = 1.0;
        #ifdef OCCLUSIONTEXTURE
            vec4 occlusionSampler = texture2D(occlusionMap, uv);
            float occlusion1 = occlusionSampler.g; //原本是float occlusion，但和uniform中的occlusion重名了，所以改成occlusion1
            inputs.occlusion = (1.0 - occlusion) + occlusion1 * occlusion;
        #endif // OCCLUSIONTEXTURE

            inputs.emissionColor = vec3(0.0);
        #ifdef EMISSION
            inputs.emissionColor = emissive.rgb * emissiveScale;
            #ifdef EMISSIONTEXTURE
                vec4 emissionSampler = texture2D(emissiveMap, uv);
            #ifdef Gamma_u_EmissionTexture
                emissionSampler = gammaToLinear(emissionSampler);
            #endif // Gamma_u_EmissionTexture
                inputs.emissionColor *= emissionSampler.rgb;
            #endif // EMISSIONTEXTURE
        #endif // EMISSION

        #ifdef ANISOTROPIC
            inputs.anisotropy = anisotropyIntensity;
            vec2 direction = vec2(1.0, 0.0);

            #ifdef ANISOTROPYMAP
                vec3 anisotropySampler = texture2D(anisotropyMap, uv).rgb;

                inputs.anisotropy *= anisotropySampler.b;
                direction = anisotropySampler.xy * 2.0 - 1.0;
            #endif // ANISOTROPYMAP

            vec2 anisotropyRotation1 = vec2(cos(anisotropyRotation), sin(anisotropyRotation));
            mat2 rotationMatrix = mat2(anisotropyRotation1.x, anisotropyRotation1.y, -anisotropyRotation1.y, anisotropyRotation1.x);
            inputs.anisotropyDirection = rotationMatrix * direction;

        #endif // ANISOTROPIC
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
        #endif // FOG

        gl_FragColor = surfaceColor;

        gl_FragColor = outputTransform(gl_FragColor);
    }

#endGLSL

GLSL End