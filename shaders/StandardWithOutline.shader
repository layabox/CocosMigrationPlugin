Shader3D Start
{
    type:Shader3D,
    name:StandardWithOutline,
    enableInstancing:true,
    supportReflectionProbe:true,
    shaderType:D3,
    uniformMap:{
        // Outline Parameters
        lineWidth: { type: Float, default: 10.0 },
        depthBias: { type: Float, default: -1.0 },
        outlineColor: { type: Color, default: [0.0, 0.0, 0.0, 1.0] },
        
        // PBR Parameters
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
        addOnShadowBias: { type: Float, default: 0.0 },
        mainTexture: { type: Texture2D, options: { define: "ALBEDOTEXTURE" } },
        normalMap: { type: Texture2D, options: { define: "NORMALTEXTURE" } },
        pbrMap: { type: Texture2D, options: { define: "METALLICGLOSSTEXTURE" } },
        occlusionMap: { type: Texture2D, options: { define: "OCCLUSIONTEXTURE" } },
        emissiveMap: { type: Texture2D, options: { define: "EMISSIONTEXTURE" } },
    },
    defines: {
        USE_OUTLINE_PASS: { type: bool, default: true },
        USE_POSITION_SCALING: { type: bool, default: false },
        ENABLEVERTEXCOLOR: { type: bool, default: false },
        ALPHATEST: { type: bool, default: false },
        HAS_SECOND_UV: { type: bool, default: false },
        USE_TWOSIDE: { type: bool, default: false },
    },
    shaderPass:[
        // Pass 0: Outline Pass (render back faces expanded along normals)
        {
            pipeline:Forward,
            VS:OutlineVS,
            FS:OutlineFS,
            statefirst:true,
            renderState:{
                cull:"Front"
            }
        },
        // Pass 1: PBR Main Pass
        {
            pipeline:Forward,
            VS:PBRVS,
            FS:PBRFS
        }
    ]
}
Shader3D End

GLSL Start
// ============================================
// OUTLINE VERTEX SHADER (Pass 0)
// ============================================
#defineGLSL OutlineVS
#define SHADER_NAME StandardWithOutline_Outline

#include "Math.glsl";
#include "Scene.glsl";
#include "Camera.glsl";
#include "Sprite3DVertex.glsl";
#include "VertexCommon.glsl";

out vec2 v_UV;

void main()
{
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();
    
    // lineWidth scaled for appropriate visual size
    // Cocos uses: outlineParams.x * 0.001
    float width = lineWidth * 0.001;
    
    // Compensate for world scale so outline width is consistent regardless of object scale.
    // Cocos models typically have scale=1, but LayaAir FBX import may use scale=100 (unit conversion).
    // Extract average scale from world matrix to normalize outline width.
    float scaleX = length(vec3(worldMat[0][0], worldMat[0][1], worldMat[0][2]));
    float scaleY = length(vec3(worldMat[1][0], worldMat[1][1], worldMat[1][2]));
    float scaleZ = length(vec3(worldMat[2][0], worldMat[2][1], worldMat[2][2]));
    float avgScale = (scaleX + scaleY + scaleZ) / 3.0;
    if (avgScale > 0.0) {
        width /= avgScale;
    }
    
    vec3 positionOS = vertex.positionOS;
    
    #ifdef USE_POSITION_SCALING
        // Position scaling mode: expand along position direction
        vec3 dir = normalize(positionOS);
        float flip = dot(dir, normalize(vertex.normalOS)) < 0.0 ? -1.0 : 1.0;
        positionOS += flip * dir * width * 2.0;
    #else
        // Normal mode: expand along normal direction
        positionOS += normalize(vertex.normalOS) * width;
    #endif
    
    vec4 positionWS = worldMat * vec4(positionOS, 1.0);
    vec4 pos = u_Projection * u_View * positionWS;
    
    // Depth bias
    pos.z -= depthBias * 0.002;
    
    #ifdef UV
        v_UV = vertex.texCoord0;
    #else
        v_UV = vec2(0.0);
    #endif
    
    gl_Position = pos;
    gl_Position = remapPositionZ(gl_Position);
}
#endGLSL

// ============================================
// OUTLINE FRAGMENT SHADER (Pass 0)
// ============================================
#defineGLSL OutlineFS
#define SHADER_NAME StandardWithOutline_Outline

#include "Color.glsl";
#include "Lighting.glsl";

in vec2 v_UV;

void main()
{
    // Outline color (default: black)
    vec4 color = vec4(linearToGamma(outlineColor.rgb), outlineColor.a);
    
    // Get main light color for outline
    #ifdef DIRECTIONLIGHT
        DirectionLight dirLight = getDirectionLight(0, vec3(0.0));
        color.rgb *= dirLight.color;
    #endif
    
    // Convert to linear before outputTransform
    #ifdef GAMMACORRECT
        color.rgb = gammaToLinear(color.rgb);
    #endif
    
    gl_FragColor = vec4(color.rgb, 1.0);
    gl_FragColor = outputTransform(gl_FragColor);
}
#endGLSL

// ============================================
// PBR VERTEX SHADER (Pass 1)
// ============================================
#defineGLSL PBRVS
#define SHADER_NAME StandardWithOutline_PBR

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

// ============================================
// PBR FRAGMENT SHADER (Pass 1)
// ============================================
#defineGLSL PBRFS
#define SHADER_NAME StandardWithOutline_PBR

#include "Color.glsl";
#include "Scene.glsl";
#include "SceneFog.glsl";
#include "Camera.glsl";
#include "Sprite3DFrag.glsl";
#include "PBRMetallicFrag.glsl";

// Save original diffuseColor before 1/PI scaling (needed for GI compensation)
vec3 g_originalDiffuseColor;

void initSurfaceInputs(inout SurfaceInputs inputs, inout PixelParams pixel)
{
    #ifdef UV
        // Use Cocos-style UV transform (no V-flip like LayaAir's transformUV)
        vec2 uv = pixel.uv0 * tilingOffset.xy + tilingOffset.zw;
    #else
        vec2 uv = vec2(0.0);
    #endif

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

    // Save original diffuseColor before 1/PI scaling
    g_originalDiffuseColor = inputs.diffuseColor;

    // === Fd_Lambert correction ===
    // LayaAir's Fd_Lambert() returns 1.0, Cocos uses 1/PI.
    // By dividing diffuseColor by PI here, the PBR pipeline's
    // diffuseLobe = diffuseColor * Fd_Lambert() = (baseColor/PI) * 1.0 = baseColor/PI
    // which matches Cocos's behavior exactly.
    inputs.diffuseColor *= 0.31830988618; // 1.0 / PI

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

// ACES Filmic Tone Mapping (matches Cocos Creator HDR pipeline)
vec3 ACESToneMap(vec3 color) {
    color = max(color, vec3(0.0));
    color = min(color, vec3(8.0));
    const float A = 2.51;
    const float B = 0.03;
    const float C = 2.43;
    const float D = 0.59;
    const float E = 0.14;
    return (color * (A * color + B)) / (color * (C * color + D) + E);
}

void main()
{
    PixelParams pixel;
    getPixelParams(pixel);

    SurfaceInputs inputs;
    initSurfaceInputs(inputs, pixel);

    vec4 surfaceColor = PBR_Metallic_Flow(inputs, pixel);

    // --- Compute corrected normal for lighting corrections ---
    vec3 corrNormal = pixel.normalWS;
    #ifdef TANGENT
        corrNormal = normalize(pixel.TBN * inputs.normalTS);
    #endif

    // === GI Diffuse Compensation ===
    // Because we divided inputs.diffuseColor by PI, the GI diffuse component
    // in PBR_Metallic_Flow was also reduced by PI. But Cocos's GI does NOT
    // divide by PI. So we need to add back the missing (PI-1)/PI portion.
    // LayaAir GI: Fd += diffuseColor * irradiance * (1-E) * occlusion
    // With our fix: diffuseColor = baseColor/PI, so GI = baseColor/PI * irradiance * (1-E) * occlusion
    // Cocos GI: ambDiff * skyIllum * diffuse * occlusion (no 1/PI)
    // Compensation = baseColor * (1 - 1/PI) * irradiance * (1-E) * occlusion
    // Approximate (1-E) ≈ 1.0 for non-metals with roughness=1
    {
        vec3 origDiffColor = g_originalDiffuseColor * (1.0 - inputs.metallic);
        vec3 irradiance = u_AmbientColor.rgb * u_AmbientIntensity;
        // (1 - 1/PI) * (1-E) ≈ 0.68169 * 0.95 ≈ 0.648
        // Account for (1-E) Fresnel energy conservation factor
        vec3 giCompensation = origDiffColor * 0.648 * irradiance * inputs.occlusion;
        surfaceColor.rgb += giCompensation;
    }

    // === Hemisphere Ambient Correction ===
    // Cocos: fAmb = max(EPSILON, 0.5 - N.y * 0.5)
    //        ambDiff = mix(skyColor, groundColor, fAmb)
    // LayaAir: uniform ambient = u_AmbientColor * u_AmbientIntensity
    // We set u_AmbientColor to white and u_AmbientIntensity to match skyIllum.
    // Add the hemisphere blend correction.
    {
        vec3 origDiffColor = g_originalDiffuseColor * (1.0 - inputs.metallic);
        vec3 ccGroundColor = vec3(0.522, 0.529, 0.592);
        float fAmb = max(0.001, 0.5 - corrNormal.y * 0.5);
        // Cocos ambient = mix(skyColor, groundColor, fAmb) * skyIllum
        // LayaAir ambient = u_AmbientColor * u_AmbientIntensity (= white * 0.469)
        // Correction = (cocosAmbient - layaAmbient) * diffuse * occlusion
        vec3 cocosAmbient = mix(vec3(1.0), ccGroundColor, fAmb) * u_AmbientIntensity;
        vec3 layaAmbient = u_AmbientColor.rgb * u_AmbientIntensity;
        vec3 hemiCorrection = (cocosAmbient - layaAmbient) * origDiffColor * inputs.occlusion;
        surfaceColor.rgb += hemiCorrection;
    }

    #ifdef FOG
        surfaceColor.rgb = sceneLitFog(surfaceColor.rgb);
    #endif

    // === ACES Tone Mapping ===
    // Cocos Creator uses ACES tone mapping in HDR mode.
    surfaceColor.rgb = ACESToneMap(surfaceColor.rgb);

    gl_FragColor = surfaceColor;
    gl_FragColor = outputTransform(gl_FragColor);
}
#endGLSL

GLSL End
