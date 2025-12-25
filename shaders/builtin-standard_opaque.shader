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
        occlusion: { type: Float, default: 0 },
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

    #include "Color.glsl";

    #include "Scene.glsl";
    #include "SceneFog.glsl";

    #include "Camera.glsl";
    #include "Sprite3DFrag.glsl";

    #include "ShadingFrag.glsl";
    #include "Lighting.glsl";
    #include "globalIllumination.glsl";

    // ========== Cocos PBR BRDF 实现 ==========
    #define CC_PI 3.14159265359
    #define CC_EPSILON 1e-6

    // GGXMobile - 与 Cocos 完全一致（没有 1/π）
    float CC_GGXMobile(float rough, float NoH, vec3 H, vec3 N) {
        vec3 NxH = cross(N, H);
        float OneMinusNoHSqr = dot(NxH, NxH);
        float a = rough * rough;
        float n = NoH * a;
        float p = a / max(CC_EPSILON, OneMinusNoHSqr + n * n);
        return p * p;
    }

    // CalcSpecular - 与 Cocos 完全一致（关键的增强因子）
    float CC_CalcSpecular(float rough, float NoH, vec3 H, vec3 N) {
        return (rough * 0.25 + 0.25) * CC_GGXMobile(rough, NoH, H, N);
    }

    // BRDFApprox - 与 Cocos 完全一致
    vec3 CC_BRDFApprox(vec3 spec, float rough, float NoV) {
        const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
        const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
        vec4 r = rough * c0 + c1;
        float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
        vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
        AB.y *= clamp(50.0 * spec.g, 0.0, 1.0);
        return max(vec3(0.0), spec * AB.x + AB.y);
    }

    // Cocos StandardSurface 结构体
    struct CCStandardSurface {
        vec4 albedo;
        vec3 position;
        vec3 normal;
        vec3 emissive;
        float roughnessVal;
        float metallicVal;
        float occlusionVal;
        float specularIntensityVal;
    };

    // CCStandardShadingBase - 完全按照 Cocos 的实现
    vec4 CCStandardShadingBase(CCStandardSurface s, vec3 V) {
        // 计算 diffuse & specular（与 Cocos 完全一致）
        vec3 diffuse = s.albedo.rgb * (1.0 - s.metallicVal);
        vec3 specular = mix(vec3(0.08 * s.specularIntensityVal), s.albedo.rgb, s.metallicVal);

        vec3 N = normalize(s.normal);
        float NV = max(abs(dot(N, V)), 0.001);

        // 应用 BRDF 近似到 specular（与 Cocos 完全一致）
        specular = CC_BRDFApprox(specular, s.roughnessVal, NV);

        vec3 finalColor = vec3(0.0);

        // 方向光
        #ifdef DIRECTIONLIGHT
        for (int i = 0; i < CalculateLightCount; i++) {
            if (i >= DirectionCount) break;
            DirectionLight dirLight = getDirectionLight(i, s.position);
            
            if (dirLight.lightMode == LightMode_Mix) continue;
            
            vec3 L = normalize(-dirLight.direction);
            float NL = max(dot(N, L), 0.0);

            if (NL > 0.0) {
                vec3 H = normalize(L + V);
                float NH = max(dot(N, H), 0.0);

                vec3 lightColor = dirLight.color * dirLight.attenuation;

                // 漫反射贡献（除以 PI，与 Cocos 一致）
                vec3 diffuseContrib = diffuse / CC_PI;

                // 高光贡献（使用 Cocos 的 CalcSpecular）
                vec3 specularContrib = specular * CC_CalcSpecular(s.roughnessVal, NH, H, N);

                finalColor += lightColor * NL * (diffuseContrib + specularContrib);
            }
        }
        #endif

        // 点光源
        #if defined(POINTLIGHT) || defined(SPOTLIGHT)
        ivec4 clusterInfo = getClusterInfo(u_View, u_Viewport, s.position, gl_FragCoord, u_ProjectionParams);
        #endif

        #ifdef POINTLIGHT
        for (int i = 0; i < CalculateLightCount; i++) {
            if (i >= clusterInfo.x) break;
            PointLight pointLight = getPointLight(i, clusterInfo, s.position);
            
            if (pointLight.lightMode == LightMode_Mix) continue;

            Light light = getLight(pointLight, N, s.position);
            vec3 L = normalize(-light.dir);
            float NL = max(dot(N, L), 0.0);

            if (NL > 0.0) {
                vec3 H = normalize(L + V);
                float NH = max(dot(N, H), 0.0);

                vec3 lightColor = light.color * light.attenuation;

                vec3 diffuseContrib = diffuse / CC_PI;
                vec3 specularContrib = specular * CC_CalcSpecular(s.roughnessVal, NH, H, N);

                finalColor += lightColor * NL * (diffuseContrib + specularContrib);
            }
        }
        #endif

        #ifdef SPOTLIGHT
        for (int i = 0; i < CalculateLightCount; i++) {
            if (i >= clusterInfo.y) break;
            SpotLight spotLight = getSpotLight(i, clusterInfo, s.position);
            
            if (spotLight.lightMode == LightMode_Mix) continue;

            Light light = getLight(spotLight, N, s.position);
            vec3 L = normalize(-light.dir);
            float NL = max(dot(N, L), 0.0);

            if (NL > 0.0) {
                vec3 H = normalize(L + V);
                float NH = max(dot(N, H), 0.0);

                vec3 lightColor = light.color * light.attenuation;

                vec3 diffuseContrib = diffuse / CC_PI;
                vec3 specularContrib = specular * CC_CalcSpecular(s.roughnessVal, NH, H, N);

                finalColor += lightColor * NL * (diffuseContrib + specularContrib);
            }
        }
        #endif

        // 环境光漫反射
        vec3 ambDiff = diffuseIrradiance(N);
        finalColor += ambDiff * diffuse * s.occlusionVal;
        
        // IBL 环境反射
        vec3 R = normalize(reflect(-V, N));
        vec3 env = specularRadiance(R, s.roughnessVal);
        finalColor += env * specular * s.occlusionVal;

        // 自发光
        finalColor += s.emissive;

        return vec4(finalColor, s.albedo.a);
    }

    // ========== Surface 初始化 ==========
    void initCCSurface(inout CCStandardSurface s, inout PixelParams pixel)
    {
        #ifdef UV
            vec2 uv = transformUV(pixel.uv0, tilingOffset);
        #else
            vec2 uv = vec2(0.0);
        #endif

        s.albedo = mainColor;

        #ifdef COLOR
            #ifdef ENABLEVERTEXCOLOR
                s.albedo.rgb *= pixel.vertexColor.xyz;
                s.albedo.a *= pixel.vertexColor.a;
            #endif
        #endif

        #ifdef ALBEDOTEXTURE
            vec4 albedoSampler = texture2D(mainTexture, uv);
            #ifdef Gamma_mainTexture
                albedoSampler = gammaToLinear(albedoSampler);
            #endif
            s.albedo *= albedoSampler;
        #endif

        s.position = pixel.positionWS;

        // 法线处理
        #ifdef TANGENT
            #ifdef NORMALTEXTURE
                vec3 normalSampler = texture2D(normalMap, uv).rgb;
                normalSampler = normalize(normalSampler * 2.0 - 1.0);
                normalSampler.y *= -1.0;
                normalSampler = normalScale(normalSampler, normalStrength);
                s.normal = normalize(pixel.TBN * normalSampler);
            #else
                s.normal = pixel.normalWS;
            #endif
        #else
            s.normal = pixel.normalWS;
        #endif

        // PBR 参数
        s.roughnessVal = roughness;
        s.metallicVal = metallic;
        s.specularIntensityVal = specularIntensity;

        #ifdef METALLICGLOSSTEXTURE
            vec4 pbrSampler = texture2D(pbrMap, uv);
            s.metallicVal = pbrSampler.b;
            s.roughnessVal = pbrSampler.g * roughness;
            s.specularIntensityVal = pbrSampler.a;
        #endif

        s.occlusionVal = 1.0;
        #ifdef OCCLUSIONTEXTURE
            vec4 occlusionSampler = texture2D(occlusionMap, uv);
            float occlusionTexVal = occlusionSampler.g;
            s.occlusionVal = (1.0 - occlusion) + occlusionTexVal * occlusion;
        #endif

        s.emissive = vec3(0.0);
        #ifdef EMISSION
            s.emissive = emissive.rgb * emissiveScale;
            #ifdef EMISSIONTEXTURE
                vec4 emissionSampler = texture2D(emissiveMap, uv);
                #ifdef Gamma_emissiveMap
                    emissionSampler = gammaToLinear(emissionSampler);
                #endif
                s.emissive *= emissionSampler.rgb;
            #endif
        #endif
    }

    void main()
    {
        PixelParams pixel;
        getPixelParams(pixel);

        CCStandardSurface surface;
        initCCSurface(surface, pixel);

        vec3 V = normalize(u_CameraPos - surface.position);

        #ifdef ALPHATEST
            if (surface.albedo.a < alphaThreshold) {
                discard;
            }
        #endif

        vec4 finalColor = CCStandardShadingBase(surface, V);
        
        #ifdef FOG
            finalColor.rgb = sceneLitFog(finalColor.rgb);
        #endif

        gl_FragColor = finalColor;
        gl_FragColor = outputTransform(gl_FragColor);
    }

#endGLSL

GLSL End