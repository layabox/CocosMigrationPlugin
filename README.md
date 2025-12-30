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

- 仅转换已在 `core/Registry.ts` 中注册的扩展名，其它类型会被忽略或仅打印警告
- 某些 Cocos 特有的组件/材质参数在 Laya 中可能没有一一对应映射，需手动调整
- 不支持转换自定义的Effect
- 物理参数（质量、摩擦、弹性等）与引擎实现差异可能导致运行效果与原项目不完全一致

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

本插件使用 MIT License，详情见仓库根目录下的 `LICENSE`（如有）。
