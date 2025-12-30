## CocosMigrationPlugin

A **LayaAir plugin** for migrating **Cocos Creator project assets** to LayaAir.

The plugin scans assets and meta files in a Cocos project, converts supported asset types into Laya formats, and automatically handles common components (UI, mesh, light, camera, collider, rigid body, animation, etc.).

> 中文版说明请参见 [README.zh-CN.md](README.zh-CN.md)

---

## Requirements

- LayaAir: 3.3.6 or higher
- Cocos: Verified with Cocos Creator 3.x; 2.x is not tested, but should work in theory

---

## Usage

1. Download this plugin and place it anywhere under the `assets` directory of your Laya project.
2. In the main menu, find: `Migrate Cocos / Migrate Cocos Project Assets` (迁移Cocos / 迁移Cocos项目资源).
3. Follow the prompts:
	 - First dialog: select the **source Cocos asset folder** (usually the `assets` directory under the Cocos project, or any of its subfolders).
	 - Second dialog: select the **target Laya asset folder** (must be a subfolder inside the current Laya project's `assets` directory).
4. Wait for the conversion to finish and check the Laya console output for progress and possible warnings.

---

## Known Limitations & Notes

- File conversion support
	1. Conversion of `AnimationClip` files and animation state machine files.
	2. Conversion of model files: `fbx`, `gltf`, `glb`, and `obj`.
	3. Basic conversion of `effect` assets (only the rough structure is converted; you will still need to adjust details manually).
	4. Conversion of `mtl` material files.
	5. Conversion of prefab and scene files.

- Component conversion support
	1. UI components (`cc.Canvas`, `cc.Widget`, `cc.UITransform`, `cc.Button`, `cc.Label`, `cc.Sprite`, `cc.ScrollView`, etc.).
	2. Animation components: `cc.Animation`, `cc.SkeletalAnimation`, `cc.animation.AnimationController` (note: for FBX assets using "Promote Single Root Node" that generate a `RootNode`, animations may be offset and fail to play correctly).
	3. Physics components: `cc.BoxCollider`, `cc.CapsuleCollider`, `cc.ConeCollider`, `cc.CylinderCollider`, `cc.RigidBody`, `cc.SphereCollider`.
	4. `cc.Camera`.
	5. Lights: `cc.DirectionalLight`, `cc.PointLight`, `cc.SpotLight`.
	6. `cc.Line`.
	7. `cc.ReflectionProbe`.
	8. `cc.LODGroup`.
	9. `cc.MeshCollider`, `cc.MeshRenderer`.
	10. `cc.SkinnedMeshRenderer`.

- Shader conversion support
	1. `builtin-standard`
	2. `sky`
	3. `standard`
	4. `toon`

---

## Extension & Customization

If you want to support more asset types or customize the conversion logic, you can:

- Add new asset converters:
	- In `core/assets`, add a new class that implements the `ICocosAssetConversion` interface.
	- Register the file extension and converter mapping in `core/Registry.ts` via `ConversionRegistry`.
- Add/modify component converters:
	- Add or modify the corresponding component converter files under `core/components`.

---

## License

This plugin is released under the MIT License.

