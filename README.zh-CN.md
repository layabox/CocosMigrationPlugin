## CocosMigrationPlugin

一个用于将 **Cocos Creator 项目资源** 迁移到 LayaAir 的**LayaAir插件**。

插件通过扫描 Cocos 工程中的资源与 meta 文件，把支持的资源类型转换为 Laya 的资源格式，并自动处理常见组件（UI、网格、灯光、相机、碰撞体、刚体、动画等）。

---

## 环境要求

- LayaAir 版本：3.3.6或以上版本
- Cocos 版本：已知支持 Cocos Creator 3.x 系列，2.x 系列未测试，但理论上也能支持

---

## 使用方法

1. 下载本插件后，放置到Laya项目的assets目录下任意位置即可
2. 在主菜单中找到：`迁移Cocos / 迁移Cocos项目资源`
3. 按提示完成迁移：
	 - 第一个对话框：选择 **源 Cocos 资源目录**（通常是 Cocos 工程下的 `assets` 目录，也可以是其子目录）
	 - 第二个对话框：选择 **目标 Laya 资源目录**（必须是当前 Laya 工程 `assets` 目录中的某个子目录）
4. 等待转换完成，查看 Laya 控制台输出以了解迁移进度及可能的警告

---

## 已知局限与注意事项

- 文件转换支持
1. AnimationClip动画以及动画状态机文件的转换
2. 模型fbx、gltf、glb和obj文件的转换
3. effect的简单转换（需要用户自己手动进行调整，只转换大致框架）
4. mtl材质文件的转换
5. 预制体以及场景文件的转换

- 组件转换支持
1. UI组件（cc.Canvas、cc.Widget、cc.UITransform、cc.Button、cc.Label、cc.Sprite、cc.ScrollView等）
2. cc.Animation、cc.SkeletalAnimation、cc.animation.AnimationController，这些动画组件的转换（需要注意，目前针对fbx的Promote Single Root Node生成的RootNode节点会出现动画错位而无法播放的问题）
3. cc.BoxCollider、cc.CapsuleCollider、cc.ConeCollider、cc.CylinderCollider、cc.RigidBody、cc.SphereCollider
4. cc.Camera的转换
5. cc.DirectionalLight、cc.PointLight、cc.SpotLight
6. cc.Line
7. cc.ReflectionProbe
8. cc.LODGroup
9.  cc.MeshCollider、cc.MeshRenderer
10. cc.SkinnedMeshRenderer

- Shader转换支持
1. builtin-standard
2. sky
3. standard
4. toon

---

## 扩展与二次开发

如果你希望支持更多资源类型或自定义转换逻辑，可以参考：

- 新增资源转换：
	- 在 `core/assets` 中新增一个实现 `ICocosAssetConversion` 接口的转换类
	- 在 `core/Registry.ts` 的 `ConversionRegistry` 中注册扩展名与转换类映射
- 新增/修改组件转换：
	- 在 `core/components` 下新增或修改对应组件转换文件

---

## 许可协议

本插件使用 MIT License
