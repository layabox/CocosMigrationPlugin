# Cocos Creator 3.8.6 → LayaAir 3.3.8 Shader 转换对照表

本文档是 Cocos Shader 转 LayaAir Shader 的完整参考手册，包含 Built-In 对照表、写法映射表、已支持 Shader 清单和转换模板。

---

## 一、已支持的 Shader 清单

### 内置 Shader 映射 (builtinShaderMap)

| Cocos Effect | LayaAir Shader | 转换方式 | 文件 |
|-------------|---------------|---------|------|
| `builtin-standard` | `PBR` | 使用 LayaAir 内置 PBR | 无需预置 shader |

### 自定义 Shader 映射 (customShaderMap)

| Cocos Effect | LayaAir Shader | 文件 |
|-------------|---------------|------|
| `builtin-toon` / `toon` | `toon_default` | `toon_default.shader` |
| `standardwithoutline` | `StandardWithOutline` | `StandardWithOutline.shader` |

### 预置 Shader 文件清单

| 文件名 | 用途 | Pass 数量 |
|--------|------|----------|
| `toon_default.shader` | 卡通渲染（阴影投射+接收） | 3 (Forward + ShadowCaster + Outline) |
| `StandardWithOutline.shader` | PBR + 描边效果 | 2 (Forward + Outline) |
| `builtin-standard_opaque.shader` | PBR 不透明（含 defineConvert） | 1 |
| `standard_default.shader` | PBR 默认 | 1 |
| `standard_opaque.shader` | PBR 不透明 | 1 |
| `builtin-unlit_opaque.shader` | 无光照不透明 | 1 |
| `builtin-camera-texture_*.shader` | 相机纹理（4 种混合模式） | 1 |
| `sky_opaque.shader` | 天空盒 | 1 |

---

## 二、Built-In 对照表（内置变量/函数）

### 2.1 矩阵和变换

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `cc_matWorld` | `getWorldMatrix()` | 世界矩阵（函数调用，内部处理骨骼动画） |
| `cc_matWorldIT` | `transpose(inverse(worldMat))` | 世界逆转置矩阵（需手动计算） |
| `cc_matView` | `u_View` | 视图矩阵 |
| `cc_matProj` | `u_Projection` | 投影矩阵 |
| `cc_matViewProj` | `u_ViewProjection` | 视图投影矩阵 |
| `cc_matViewInv` | 无直接对应 | 视图逆矩阵 |
| `cc_matViewProjInv` | 无直接对应 | VP 逆矩阵 |

### 2.2 相机参数

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `cc_cameraPos.xyz` | `u_CameraPos` | 相机世界位置 |
| `cc_nearFar.x` | `u_ProjectionParams.x` | 近裁剪面 |
| `cc_nearFar.y` | `u_ProjectionParams.y` | 远裁剪面 |
| `cc_screenSize` | `u_Viewport` | 屏幕/视口尺寸 |

### 2.3 灯光参数

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `cc_mainLitDir.xyz` | `light.dir`（通过 `getDirectionLight()`） | 主方向光方向 |
| `cc_mainLitColor.xyz` | `light.color`（通过 `getDirectionLight()`） | 主方向光颜色 |
| `cc_mainLitColor.w` | `light.color` 已乘 intensity | 主方向光强度（LayaAir 合并到颜色中） |
| `cc_ambientSky` | `u_AmbientColor` | 天空环境光 |
| `cc_ambientGround` | 无直接对应 | 地面环境光 |
| `cc_lightPos[i]` | 通过 `getPointLight()` / `getSpotLight()` | 附加灯光位置 |
| `cc_lightColor[i]` | 通过 `getPointLight()` / `getSpotLight()` | 附加灯光颜色 |

### 2.4 阴影参数

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `cc_matLightViewProj` | `u_ShadowMatrices[4]` | 阴影矩阵（LayaAir 支持 4 级联） |
| `cc_shadowColor` | 无直接对应 | 阴影颜色（LayaAir 使用 `ShadowStrength`） |
| `cc_shadowWHPBInfo` | `u_ShadowMapSize` | 阴影贴图尺寸 |
| `cc_shadowNFLSInfo` | `u_ShadowParams` | 阴影参数 |
| `CCCSMFactorBase()` | `light.attenuation`（自动计算） | 阴影采样结果 |
| `cc_shadowSplitSpheres` | `u_ShadowSplitSpheres[4]` | CSM 级联球体 |

### 2.5 时间和场景

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `cc_time.x` | `u_Time` | 运行时间（秒） |
| `cc_fogColor` | `u_FogColor` | 雾颜色 |
| `cc_fogBase` | `u_FogParams` | 雾参数 |

### 2.6 纹理采样

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `texture(sampler2D, uv)` | `texture2D(sampler2D, uv)` | 2D 纹理采样 |
| `textureLod(sampler2D, uv, lod)` | `texture2DLod(sampler2D, uv, lod)` | LOD 采样 |
| `texture(samplerCube, dir)` | `textureCube(samplerCube, dir)` | Cube 贴图采样 |
| `textureLod(samplerCube, dir, lod)` | `textureCubeLod(samplerCube, dir, lod)` | Cube LOD 采样 |

### 2.7 常用数学宏

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `saturate(v)` | `clamp(v, 0.0, 1.0)` | 钳制到 [0,1]（LayaAir 无内置宏） |
| `lerp(a, b, t)` | `mix(a, b, t)` | 线性插值（标准 GLSL） |
| `PI` | `3.14159265359` | 需自行定义或用 Math.glsl |
| `INV_PI` | `0.31830988618` | 同上 |
| `EPSILON` | `1e-6` | 同上 |
| `EPSILON_LOWP` | `1e-4` | 同上 |

---

## 三、写法映射表（Map）

### 3.1 .shader 文件结构映射

**Cocos .effect 格式：**
```yaml
CCEffect %{
  techniques:
    - name: opaque
      passes:
        - vert: standard-vs
          frag: standard-fs
          properties: ...
}%
CCProgram standard-vs %{ ... }%
CCProgram standard-fs %{ ... }%
```

**LayaAir .shader 格式：**
```
Shader3D Start
{
    type:Shader3D,
    name:shader_name,
    enableInstancing:true,
    shaderType:D3,
    supportReflectionProbe:true,
    uniformMap:{ ... },
    defines:{ ... },
    shaderPass:[ { pipeline:Forward, VS:MyVS, FS:MyFS } ]
}
Shader3D End

GLSL Start
#defineGLSL MyVS
    // vertex shader code
#endGLSL

#defineGLSL MyFS
    // fragment shader code
#endGLSL
GLSL End
```

### 3.2 Uniform 声明映射

**Cocos properties:**
```yaml
mainTexture: { value: white, editor: { displayName: MainTexture } }
mainColor: { value: [1, 1, 1, 1], editor: { type: color } }
roughness: { value: 0.8, editor: { slide: true, range: [0, 1] } }
```

**LayaAir uniformMap:**
```
mainTexture: { type: Texture2D, options: { define: "MAINTEXTURE" } },
mainColor: { type: Color, default: [1.0, 1.0, 1.0, 1.0] },
roughness: { type: Float, default: 0.8 },
```

**类型对照：**

| Cocos 类型 | LayaAir 类型 | 注意事项 |
|-----------|-------------|---------|
| `color` | `Color` | RGBA [0,1] |
| `float / number` | `Float` | - |
| `vec2` | `Vector2` | - |
| `vec3` | `Vector3` | - |
| `vec4` | `Vector4` | - |
| `Texture2D` | `Texture2D` | 需加 `options: { define: "XXX" }` |
| `TextureCube` | `TextureCube` | 需加 `options: { define: "XXX" }` |

### 3.3 Define 声明映射

**Cocos macro:**
```yaml
- &USE_NORMAL_MAP { name: USE_NORMAL_MAP, type: boolean }
```

**LayaAir defines:**
```
USE_NORMAL_MAP: { type: bool, default: false },
```

### 3.4 ShaderPass / Pipeline 映射

| Cocos Pass | LayaAir Pipeline | 说明 |
|-----------|-----------------|------|
| `phase: default` / 主 pass | `pipeline:Forward` | 前向渲染主通道 |
| `phase: shadow-caster` | `pipeline:ShadowCaster` | 阴影投射通道 |
| `phase: deferred-forward` | 无直接对应 | 延迟渲染 |
| `phase: forward-add` | 无直接对应（引擎自动处理多光源） | 附加光照 |

### 3.5 RenderState 映射

| Cocos | LayaAir | 说明 |
|-------|---------|------|
| `cullMode: front` | `renderState:{ cull:"Front" }` | 正面剔除（描边 pass 常用） |
| `cullMode: back` | `renderState:{ cull:"Back" }` | 背面剔除（默认） |
| `cullMode: none` | `renderState:{ cull:"Off" }` | 不剔除 |
| `blendState` | `renderState:{ blend:... }` | 混合状态 |
| `depthStencilState` | `renderState:{ depth:... }` | 深度/模板状态 |

### 3.6 顶点着色器模板

**Cocos VS 典型写法：**
```glsl
in vec3 a_position;
in vec3 a_normal;
in vec2 a_texCoord;

void main() {
    vec4 position = cc_matWorld * vec4(a_position, 1.0);
    v_normal = normalize((cc_matWorldIT * vec4(a_normal, 0.0)).xyz);
    gl_Position = cc_matViewProj * position;
}
```

**LayaAir VS 转换后：**
```glsl
#include "Math.glsl";
#include "Scene.glsl";
#include "SceneFogInput.glsl";
#include "Camera.glsl";
#include "Sprite3DVertex.glsl";
#include "VertexCommon.glsl";

void main() {
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();
    mat4 worldMatIT = transpose(inverse(worldMat));

    vec4 positionWS = worldMat * vec4(vertex.positionOS, 1.0);
    v_NormalWS = normalize((worldMatIT * vec4(vertex.normalOS, 0.0)).xyz);

    gl_Position = u_Projection * u_View * positionWS;
    gl_Position = remapPositionZ(gl_Position);

    #ifdef FOG
        FogHandle(gl_Position.z);
    #endif
}
```

### 3.7 片段着色器模板

**Cocos FS 典型写法：**
```glsl
#include <legacy/output>

void main() {
    vec4 color = mainColor;
    color = CCFragOutput(color);  // 包含 LinearToSRGB
    gl_FragColor = color;
}
```

**LayaAir FS 转换后：**
```glsl
#include "Color.glsl";
#include "Scene.glsl";
#include "SceneFog.glsl";
#include "Camera.glsl";
#include "Sprite3DFrag.glsl";

void main() {
    vec4 color = mainColor;

    #ifdef FOG
        color.rgb = sceneLitFog(color.rgb);
    #endif

    gl_FragColor = color;
    gl_FragColor = outputTransform(gl_FragColor);  // 对应 LinearToSRGB
}
```

---

## 四、色彩空间转换规则

这是 Cocos→LayaAir 转换中最关键也最容易出错的部分。

### 4.1 管线差异对比

| 环节 | Cocos | LayaAir |
|------|-------|---------|
| 颜色贴图采样 | 手动 `SRGBToLinear(texel²)` | 硬件 sRGB（texel^2.2，自动转换） |
| 非颜色贴图 | 直接采样（线性） | sRGB=false，直接采样 |
| 灯光颜色 | sRGB 颜色 × intensity | `gammaToLinear(color) × intensity` 合并为 uniform |
| 最终输出 | `LinearToSRGB(sqrt)` | `outputTransform(result^(1/2.2))` |

### 4.2 贴图 sRGB 设置（ImageConversion.ts）

| 贴图类型 | Cocos userData.type | sRGB 设置 |
|---------|-------------------|----------|
| 颜色贴图 | `texture` / `sprite-frame` / `cube` | `sRGB=true` |
| 法线贴图 | `normal` | `sRGB=false` |
| 数据贴图 | `raw` | `sRGB=false` |

### 4.3 灯光颜色补偿（DirectionLightConversion.ts）

**问题：** LayaAir 引擎对灯光颜色做 `gammaToLinear(color) * intensity`，但 Cocos 直接使用 sRGB 颜色。

**方案：** 在转换时存储 `linearToGammaSpace(sRGBColor)`，经引擎 `gammaToLinearSpace` 后还原为 sRGB。

```typescript
// 预补偿公式（DirectionLightConversion.ts）
baseColor.r = linearToGammaSpace(baseColor.r);
baseColor.g = linearToGammaSpace(baseColor.g);
baseColor.b = linearToGammaSpace(baseColor.b);
```

### 4.4 Shader 中的色彩空间处理

```glsl
// ✅ 正确：使用引擎的硬件 sRGB + outputTransform
vec4 texColor = texture2D(mainTexture, uv);  // 硬件 sRGB 自动线性化
// ... 线性空间光照计算 ...
gl_FragColor = outputTransform(result);       // gamma 校正输出

// ❌ 错误：不要手动做 SRGBToLinear
// vec4 texColor = SRGBToLinear(texture2D(mainTexture, uv));  // 重复转换！
```

---

## 五、光照和阴影集成规则

### 5.1 光照获取模板

```glsl
#include "Lighting.glsl";  // 自动包含 ShadowSampler.glsl

// 方向光
vec3 lightColor = vec3(1.0);
vec3 lightDir = normalize(vec3(0.5, -1.0, 0.2));  // 默认值
float shadowAtten = 1.0;

#ifdef DIRECTIONLIGHT
    DirectionLight dirLight = getDirectionLight(0, v_PositionWS);
    Light light = getLight(dirLight);
    lightColor = light.color;      // 已包含 intensity
    lightDir = light.dir;
    shadowAtten = light.attenuation; // 阴影衰减 0~1
#endif
```

### 5.2 CSM 级联边界修复（必须添加！）

LayaAir 引擎的 `computeCascadeIndex()` 对超出所有级联球体的片元返回 index=4，导致 `u_ShadowMatrices[4]` 越界访问。**自定义 shader 必须自行处理：**

```glsl
#ifdef SHADOW_CASCADE
{
    vec3 fc0 = v_PositionWS - u_ShadowSplitSpheres[0].xyz;
    vec3 fc1 = v_PositionWS - u_ShadowSplitSpheres[1].xyz;
    vec3 fc2 = v_PositionWS - u_ShadowSplitSpheres[2].xyz;
    vec3 fc3 = v_PositionWS - u_ShadowSplitSpheres[3].xyz;
    bool inCascade =
        dot(fc0, fc0) < u_ShadowSplitSpheres[0].w ||
        dot(fc1, fc1) < u_ShadowSplitSpheres[1].w ||
        dot(fc2, fc2) < u_ShadowSplitSpheres[2].w ||
        dot(fc3, fc3) < u_ShadowSplitSpheres[3].w;
    if (!inCascade) shadowAtten = 1.0;
}
#endif
```

### 5.3 ShadowCaster Pass 模板

```glsl
// Shader3D 中添加 pass：
// { pipeline:ShadowCaster, VS:MyShadowCasterVS, FS:MyShadowCasterFS }

#defineGLSL MyShadowCasterVS
#include "DepthVertex.glsl";

void main() {
    Vertex vertex;
    getVertexParams(vertex);

    mat4 worldMat = getWorldMatrix();
    vec4 pos = worldMat * vec4(vertex.positionOS, 1.0);
    vec3 positionWS = pos.xyz / pos.w;

    mat4 normalMat = transpose(inverse(worldMat));
    vec3 normalWS = normalize((normalMat * vec4(vertex.normalOS, 0.0)).xyz);

    vec4 positionCS = DepthPositionCS(positionWS, normalWS);
    gl_Position = remapPositionZ(positionCS);
}
#endGLSL

#defineGLSL MyShadowCasterFS
#include "DepthFrag.glsl";

void main() {
    // 可选：Alpha Test
    #ifdef USE_ALPHA_TEST
        // discard 逻辑
    #endif
    gl_FragColor = getDepthColor();
}
#endGLSL
```

### 5.4 阴影应用方式

**PBR Shader：** 引擎自动通过 `PBRLighting()` 处理，无需手动操作。

**自定义 Shader（如 Toon）：** 需手动应用阴影。注意区分 PRE-STEP 和 POST-STEP：

```glsl
// ✅ POST-STEP（推荐，匹配 Cocos）：先算色阶再乘阴影
float NL = 0.5 * dot(N, L) + 0.5;
// ... 阶梯色阶计算 ...
diffuse = mix(baseColor.rgb, shadedColor, blend);
float shadow = mix(1.0, shadowAtten, shadowCover);
diffuse *= shadow;  // 阴影乘在最终颜色上

// ❌ PRE-STEP（错误）：阴影修改 NdotL，会导致色阶跳变
// float NL = 0.5 * dot(N, L) + 0.5;
// NL *= mix(1.0, shadowAtten, shadowCover);  // 可能跌破 step 阈值！
```

---

## 六、VS Include 模板速查

### 6.1 最小 VS Include 集（所有 shader 必需）

```glsl
#include "Math.glsl";
#include "Scene.glsl";
#include "Camera.glsl";
#include "Sprite3DVertex.glsl";
#include "VertexCommon.glsl";
```

### 6.2 扩展 Include

| 需求 | 额外 Include |
|------|-------------|
| 雾效 | `#include "SceneFogInput.glsl";`（VS）+ `#include "SceneFog.glsl";`（FS） |
| PBR | `#include "PBRVertex.glsl";`（VS）+ `#include "PBRMetallicFrag.glsl";`（FS） |
| 光照 | `#include "Lighting.glsl";`（FS，自动包含阴影采样） |
| 阴影投射 | `#include "DepthVertex.glsl";`（VS）+ `#include "DepthFrag.glsl";`（FS） |
| 天空盒 | `#include "SkyCommon.glsl";` |

### 6.3 FS 基础 Include

```glsl
#include "Color.glsl";
#include "Scene.glsl";
#include "Camera.glsl";
#include "Sprite3DFrag.glsl";
```

---

## 七、Cocos 光照函数 → LayaAir 映射

| Cocos 函数 | LayaAir 等效 | 说明 |
|-----------|-------------|------|
| `CCSurfacesLightingCalculateDirect()` | `getDirectionLight()` + 手动计算 | Cocos 是 Surface Shader 模式 |
| `CCSurfacesLightingCalculateEnvironment()` | `diffuseIrradiance()` + `specularRadiance()` | IBL |
| `CCStandardShading()` | `PBR_Metallic_Flow()` | PBR 完整光照 |
| `CCToonShading()` | 手动实现 step 色阶 | 无内置 toon 函数 |
| `CCFragOutput(color)` | `outputTransform(color)` | gamma 校正输出 |
| `SurfacesMaterialData` | `SurfaceInputs` | 材质输入结构体 |

---

## 八、踩坑记录

### 8.1 CSM 级联边界黑点
- **症状：** 地面出现黑色斑点，移动相机消失，有圆形阴影区域
- **原因：** `computeCascadeIndex()` 返回 4 越界
- **修复：** 每个自定义 shader 都需要添加级联球体边界检查

### 8.2 Toon 阴影色阶跳变
- **症状：** 阴影区域突然变为最暗色阶
- **原因：** PRE-STEP 模式下 `NL *= shadow` 使 NdotL 跌破 step 阈值
- **修复：** 使用 POST-STEP，先算色阶再乘阴影

### 8.3 PBR 透明材质 IDE 刷新黑屏
- **症状：** IDE 刷新后透明材质变黑
- **原因：** .lmat 中冗余 blend 属性与 materialRenderMode 冲突
- **修复：** 只用 materialRenderMode 控制渲染状态，不同时设置显式 blend 属性

### 8.4 灯光颜色偏差
- **症状：** 转换后颜色与 Cocos 不一致
- **原因：** LayaAir 引擎对灯光颜色做 `gammaToLinear`，Cocos 不做
- **修复：** 存储 `linearToGammaSpace(color)`，经引擎转换后还原

### 8.5 法线贴图 Y 轴翻转
- **症状：** 法线效果方向相反
- **原因：** Cocos 和 LayaAir 的法线贴图 Y 轴方向约定不同
- **修复：** PBR shader 中添加 `normalSampler.y *= -1.0;`

### 8.6 贴图 sRGB 重复转换
- **症状：** 贴图颜色偏暗或偏亮
- **原因：** 硬件 sRGB 已自动线性化，shader 中再手动转换导致双重转换
- **修复：** sRGB=true 的贴图不要在 shader 中再做 `SRGBToLinear`

---

## 九、新 Shader 转换检查清单

添加新的 Cocos Shader 支持时，按此清单逐项检查：

- [ ] **分析 Cocos Effect 源码**：确认所有 properties、macros、passes
- [ ] **创建 .shader 文件**：按 LayaAir 格式编写 Shader3D Start/End + GLSL Start/End
- [ ] **uniformMap**：逐个映射 Cocos properties → LayaAir uniform 类型
- [ ] **defines**：映射 Cocos macros → LayaAir bool defines
- [ ] **VS include**：至少包含 Math + Scene + Camera + Sprite3DVertex + VertexCommon
- [ ] **VS 顶点处理**：`getVertexParams()` → `getWorldMatrix()` → `remapPositionZ()`
- [ ] **FS include**：至少包含 Color + Scene + Camera + Sprite3DFrag
- [ ] **FS 输出**：`gl_FragColor = outputTransform(color);`
- [ ] **光照获取**：使用 `getDirectionLight()` + `getLight()` 获取灯光数据
- [ ] **CSM 边界检查**：如果使用阴影，添加 `#ifdef SHADOW_CASCADE` 边界检查
- [ ] **ShadowCaster Pass**：如果需要投射阴影，添加 `pipeline:ShadowCaster` pass
- [ ] **色彩空间**：确认贴图 sRGB 设置、不重复手动转换、使用 outputTransform
- [ ] **雾效支持**：VS 添加 `SceneFogInput.glsl` + `FogHandle()`，FS 添加 `SceneFog.glsl` + `sceneLitFog()`
- [ ] **MaterialConversion.ts**：在 `customShaderMap` 中添加 effect → shader 名称映射
- [ ] **ShaderConversion.ts**：如有必要，在 `skippedBuiltinEffects` 中添加跳过规则
- [ ] **测试验证**：转换后对比 Cocos 渲染效果，检查光照/阴影/颜色/透明度
