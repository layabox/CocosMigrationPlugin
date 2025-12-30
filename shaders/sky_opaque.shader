Shader3D Start
{
    type:Shader3D,
    name:sky_opaque,
    enableInstancing:false,
    shaderType:Sky,
    supportReflectionProbe:false,
    uniformMap:{
        u_Texture: { type: Texture2D },
        u_TintColor: { type: Color, default: [1.0, 1.0, 1.0, 1.0] },
        u_Rotation: { type: Float, default: 0.0,step:1 },
        u_Exposure: { type: Float, default: 1.0 }
    },
    attributeMap:{
        a_Position: Vector4
    },
    shaderPass:[
        {
            pipeline:Forward,
            VS:skyOpaqueVS,
            FS:skyOpaquePS,
            renderState:{
                depthTest: "LessEqual",
                cull: "Back",
                depthWrite: false,
                stencilWrite: false
            },
            statefirst: true
        }
    ]
}
Shader3D End


GLSL Start
#defineGLSL skyOpaqueVS
   #define SHADER_NAME SkyPanoramicVS

#include "SkyCommon.glsl";


varying vec3 v_Texcoord;
varying vec2 v_Image180ScaleAndCutoff;
varying vec4 v_Layout3DScaleAndOffset;

void main()
{
	vec4 position = rotateAroundYInDegrees(a_Position, u_Rotation);
	

	v_Texcoord=vec3(a_Position.x,-a_Position.y,-a_Position.z);// NOTE: Rotate 180 degrees to match Cocos default orientation

	// Calculate constant horizontal scale and cutoff for 180 (vs 360) image type
	v_Image180ScaleAndCutoff = vec2(1.0, 1.0);// 360 degree mode

	// Calculate constant scale and offset for 3D layouts
	v_Layout3DScaleAndOffset = vec4(0,0,1,1);
	gl_Position = u_SkyProjectionViewMat*position;
	gl_Position=remapSkyPositionZ(gl_Position);

}

#endGLSL

#defineGLSL skyOpaquePS
    #define SHADER_NAME sky_opaque

#include "Color.glsl";

varying vec3 v_Texcoord;
varying vec2 v_Image180ScaleAndCutoff;
varying vec4 v_Layout3DScaleAndOffset;

#ifndef PI
#define PI 3.14159265359
#endif

// SRGBToLinear function (matching Cocos implementation)
// Cocos uses: return gamma * gamma; (which is pow(gamma, 2.0))
vec3 SRGBToLinear(vec3 gamma)
{
    return gamma * gamma;
}

// LinearToSRGB function (matching Cocos implementation)
// Cocos uses: return sqrt(linear); (which is pow(linear, 0.5))
vec3 LinearToSRGB(vec3 linear)
{
    return sqrt(linear);
}

// Simple HDR to LDR tone mapping (similar to Cocos HDRToLDR)
// Cocos uses ACES tone mapping when enabled, but for simplicity we use a basic version
vec3 HDRToLDR(vec3 hdr)
{
    // Simple Reinhard tone mapping
    return hdr / (hdr + vec3(1.0));
}

vec2 ToRadialCoords(vec3 coords)
{
    vec3 normalizedCoords = normalize(coords);
    float latitude = acos(normalizedCoords.y);
    float longitude = atan(normalizedCoords.z, normalizedCoords.x);
    vec2 sphereCoords = vec2(longitude, latitude) * vec2(0.5 / PI, 1.0 / PI);
    return vec2(0.5, 1.0) - sphereCoords;
}

void main()
{
    vec2 tc = ToRadialCoords(v_Texcoord);
    if (tc.x > v_Image180ScaleAndCutoff.y)
	gl_FragColor = vec4(0, 0, 0, 1);
    tc.x = mod(tc.x * v_Image180ScaleAndCutoff.x, 1.0);
    tc = (tc + v_Layout3DScaleAndOffset.xy) * v_Layout3DScaleAndOffset.zw;

    // Sample texture
    mediump vec4 tex = texture2D(u_Texture, tc);
    
    // Convert SRGB to Linear (similar to Cocos SRGBToLinear)
    // Cocos: vec3 c = SRGBToLinear(fragTextureLod(environmentMap, rotationDir.xyz, 0.0).rgb);
    mediump vec3 c = SRGBToLinear(tex.rgb);
    
    // Note: Cocos uses cc_ambientSky.w (ambient intensity) here, but in Laya this is a scene-level property
    // For now, we skip applying ambient intensity directly in shader (it's typically 1.0 in Cocos)
    // Cocos: vec4 color = vec4(c * cc_ambientSky.w, 1.0);
    // If needed, ambient intensity can be applied via u_TintColor or u_Exposure
    
    // Apply tint color (can be used to adjust brightness/intensity)
    c = c * u_TintColor.rgb;
    
    // Apply exposure (can be used to adjust brightness/intensity)
    if (u_Exposure != 1.0) {
        c = c * u_Exposure;
    }
    
    // HDR to LDR tone mapping (similar to Cocos HDRToLDR)
    // Cocos: color.rgb = HDRToLDR(color.rgb);
    c = HDRToLDR(c);
    
    // Linear to SRGB conversion (similar to Cocos LinearToSRGB)
    // Cocos: color.rgb = LinearToSRGB(color.rgb);
    c = LinearToSRGB(c);
    
    vec4 color = vec4(c, 1.0);
    
    // Output transform (Laya's final output conversion)
    gl_FragColor = outputTransform(color);
}
#endGLSL


GLSL End
