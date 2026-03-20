import { ICocosAssetConversion, ICocosMigrationTool } from "../ICocosMigrationTool";
import * as fs from "fs";
import { PrefabConversion } from "../PrefabConversion";
import fpath from "path";
import { internalUUIDMap } from "../Utils";
import { logger } from "../Logger";

export class ModelConversion implements ICocosAssetConversion {
    constructor(private owner: ICocosMigrationTool) { }

    /**
     * 建立图片 UUID 到文件名的映射关系，并处理 texture 资源
     * 解析 userData.imageMetas 建立映射表，然后在 subMetas 中查找 texture 资源，
     * 通过 imageUuidOrDatabaseUri 找到对应的图片文件名并记录
     */
    private processTextureImageMapping(meta: any, targetPath: string): void {
        targetPath = fpath.relative(EditorEnv.assetsPath, targetPath);
        //去掉targetPath的最后一层目录
        targetPath = targetPath.substring(0, targetPath.lastIndexOf(fpath.sep));
        // 建立图片 UUID 到文件名的映射关系
        // 解析 userData.imageMetas，建立映射表
        if (meta.userData && meta.userData.imageMetas && Array.isArray(meta.userData.imageMetas)) {
            for (let imageMeta of meta.userData.imageMetas) {
                if (imageMeta.uri && imageMeta.name) {
                    let uri = imageMeta.uri;
                    let name = imageMeta.name;
                    if (null != imageMeta.remap) {
                        uri = imageMeta.remap;
                        name = fpath.basename(imageMeta.uri);
                    }
                    internalUUIDMap[uri] = fpath.join(targetPath, name)
                }
            }
        }

        // 处理 subMetas 中的 texture 资源，建立 texture UUID 到图片文件名的映射
        if (meta.subMetas) {
            for (let subId in meta.subMetas) {
                let subMeta = meta.subMetas[subId];

                // 处理 texture 资源
                if (subMeta.importer === "texture" && subMeta.userData) {
                    let textureUuid = subMeta.uuid;
                    let imageUuidOrDatabaseUri = subMeta.userData.imageUuidOrDatabaseUri;
                    const path = internalUUIDMap[imageUuidOrDatabaseUri];
                    if (path && textureUuid) {
                        internalUUIDMap[textureUuid] = path;
                    }
                }
            }
        }
    }

    /**
     * 收集 FBX 内嵌材质信息，用于后续设置 remappedMaterials
     * @param meta Cocos FBX 的 meta 数据
     * @returns 材质名称到材质 UUID 的映射
     */
    private collectEmbeddedMaterials(meta: any): Map<string, string> {
        const materialMap = new Map<string, string>();
        
        if (!meta.subMetas) return materialMap;
        
        for (let subId in meta.subMetas) {
            let subMeta = meta.subMetas[subId];
            
            // 查找 gltf-material 类型的子资源
            if (subMeta.importer === "gltf-material" && subMeta.name) {
                // 材质名称格式：Material #205.material -> Material _205
                // LayaAir 的命名规则：只替换 # 为 _，保留空格
                let materialName = subMeta.name;
                // 去掉 .material 后缀
                if (materialName.endsWith(".material")) {
                    materialName = materialName.substring(0, materialName.length - 9);
                }
                // 只替换 # 为下划线（LayaAir 的命名规则，保留空格）
                materialName = materialName.replace(/#/g, "_");
                
                materialMap.set(materialName, subMeta.uuid);
                console.log(`[ModelConversion] Found embedded material: "${materialName}" -> ${subMeta.uuid}`);
            }
        }
        
        return materialMap;
    }

    /**
     * 从 FBX 二进制文件中读取 UnitScaleFactor 值
     * 不同 DCC 工具导出的 FBX 单位不同：cm=1, inch=2.54, m=100 等
     */
    private readUnitScaleFactor(fbxPath: string): number {
        try {
            const data = fs.readFileSync(fbxPath);
            const marker = Buffer.from("UnitScaleFactor");
            const idx = data.indexOf(marker);
            if (idx < 0) return 1;

            // FBX binary: UnitScaleFactor S\x06\x00\x00\x00double S\x06\x00\x00\x00Number S\x00\x00\x00\x00 D <8 bytes double LE>
            // 找到 'D' 标记（double 类型标识），然后读取 8 字节
            const searchStart = idx + marker.length;
            const searchEnd = Math.min(searchStart + 60, data.length - 8);
            for (let i = searchStart; i < searchEnd; i++) {
                if (data[i] === 0x44 && data[i - 1] === 0x00) { // 'D' preceded by null
                    return data.readDoubleLE(i + 1);
                }
            }
        } catch (e) {
            logger.warn("ModelConversion", `Failed to read UnitScaleFactor from ${fbxPath}: ${e}`);
        }
        return 1;
    }

    async run(sourcePath: string, targetPath: string, meta: any) {
        let subAssets = meta.userData.assetFinder;

        // 收集内嵌材质信息（在注册子资源之前）
        const embeddedMaterials = this.collectEmbeddedMaterials(meta);

        let registerSubAssets = (catalog: string, layaType: string) => {
            if (!subAssets[catalog])
                return;

            let i = 0;
            for (let uuid of subAssets[catalog]) {
                let subId = uuid.split("@")[1];
                if (!subId) {
                    console.warn(`Invalid sub-asset uuid format: ${uuid}, missing "@" separator`);
                    continue;
                }
                if (!meta.subMetas || !meta.subMetas[subId]) {
                    console.warn(`Sub-asset metadata not found for subId: ${subId} in uuid: ${uuid}`);
                    continue;
                }
                let newSubId = layaType + i++;
                this.owner.allAssets.set(uuid, {
                    sourcePath,
                    userData: Object.assign(meta.subMetas[subId].userData, { __layaId: meta.uuid + "@" + newSubId })
                });
            }
        };

        registerSubAssets("meshes", "lm");
        registerSubAssets("materials", "lmat");
        registerSubAssets("textures", "img");
        registerSubAssets("skeletons", "lani");

        // 建立图片 UUID 到文件名的映射关系，并处理 texture 资源
        this.processTextureImageMapping(meta, targetPath);

        await fs.promises.copyFile(sourcePath, targetPath);

        // 为 FBX 文件设置正确的导入参数，确保自动应用单位转换
        // Cocos 的模型单位是厘米（cm），Laya 默认是米（m）
        // 设置 convertUnits: 1 (厘米) 和 normalizeMesh: true，让 Laya 自动应用 0.01 缩放
        const fileExt = sourcePath.toLowerCase().substring(sourcePath.lastIndexOf("."));
        const isModelFile = [".fbx", ".gltf", ".glb", ".obj"].includes(fileExt);

        // 读取 FBX 的 UnitScaleFactor（不同 DCC 工具导出单位不同：cm=1, inch=2.54）
        const unitScaleFactor = (isModelFile && fileExt === ".fbx")
            ? this.readUnitScaleFactor(sourcePath)
            : 1;

        if (unitScaleFactor !== 1) {
            logger.info("ModelConversion", `FBX UnitScaleFactor=${unitScaleFactor} for ${fpath.basename(sourcePath)}`);
        }

        let metaContent: any = { uuid: meta.uuid, unitScaleFactor };
        if (isModelFile) {
            metaContent.importer = {
                convertUnits: 1, // 1 = 厘米，0 = 米
                normalizeMesh: true, // 自动归一化：如果单位是 cm，会自动应用 0.01 缩放
                scaleFactor: 1
            };
            
            // 设置 remappedMaterials，将内嵌材质映射到转换后的独立材质文件
            // 注意：这里先设置为 null，等材质转换完成后再更新
            if (embeddedMaterials.size > 0) {
                metaContent.importer.remappedMaterials = {};
                for (const [materialName, materialUuid] of embeddedMaterials) {
                    // 先设置为 null，后续会在 complete 阶段更新
                    metaContent.importer.remappedMaterials[materialName] = null;
                }
                
                // 保存材质映射信息，供后续更新使用
                if (!this.owner._pendingMaterialRemaps) {
                    this.owner._pendingMaterialRemaps = [];
                }
                this.owner._pendingMaterialRemaps.push({
                    fbxMetaPath: targetPath + ".meta",
                    embeddedMaterials: embeddedMaterials,
                    targetDir: fpath.dirname(targetPath)
                });
            }
        }
        this.owner.allAssets.set(meta.uuid, {
            sourcePath,
            userData: metaContent
        });
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", metaContent);

        const relativePath = EditorEnv.assetMgr.toRelativePath(targetPath);
        await EditorEnv.assetMgr.waitForAssetsReady([relativePath]);

        // FBX 导入后，修复引擎生成的 .lh 中 MeshRenderer 的 castShadow 默认值
        // LayaAir 默认 castShadow=true，但 Cocos 默认是 OFF，需要改为 false
        if (isModelFile) {
            const prefabLibPath = fpath.join(EditorEnv.projectPath, "library", meta.uuid.substring(0, 2), `${meta.uuid}@0.lh`);
            if (fs.existsSync(prefabLibPath)) {
                try {
                    const prefabData = await IEditorEnv.utils.readJsonAsync(prefabLibPath);
                    if (prefabData && this.fixMeshRendererCastShadow(prefabData)) {
                        await IEditorEnv.utils.writeJsonAsync(prefabLibPath, prefabData);
                        logger.debug("ModelConversion", `Fixed MeshRenderer castShadow defaults in ${fpath.basename(prefabLibPath)}`);
                    }
                } catch (e) {
                    logger.warn("ModelConversion", `Failed to fix castShadow in .lh: ${e}`);
                }
            }
        }

        if (subAssets.scenes?.length > 0) {
            let sceneAssetId: string = subAssets["scenes"][0];
            this.owner.allAssets.set(sceneAssetId, {
                sourcePath,
                userData: { __layaId: meta.uuid + "@0" }
            });

            if (this.owner.cocosProjectRoot) {
                let scenePath = fpath.join(this.owner.cocosProjectRoot, "library", sceneAssetId.substring(0, 2), `${sceneAssetId}.json`);
                let elements = await IEditorEnv.utils.readJsonAsync(scenePath);
                if (elements) {
                    (this.owner.getAssetConversion("prefab") as PrefabConversion).parseElements(elements);
                } else {
                    console.warn(`Scene asset not found: ${scenePath}`);
                }
            }
        }
    }

    /**
     * 在所有模型和材质转换完成后，更新 FBX 的 remappedMaterials
     * 将内嵌材质映射到转换后的独立材质文件
     */
    async complete() {
        if (!this.owner._pendingMaterialRemaps || this.owner._pendingMaterialRemaps.length === 0) {
            return;
        }

        logger.info("ModelConversion", `Updating ${this.owner._pendingMaterialRemaps.length} FBX material remaps...`);

        // 收集所有需要等待的材质文件路径
        const allLmatPaths: string[] = [];
        for (const remap of this.owner._pendingMaterialRemaps) {
            const lmatFiles = await this.findLmatFiles(remap.targetDir);
            allLmatPaths.push(...lmatFiles);
        }

        // 等待所有材质文件被资产管理器索引
        if (allLmatPaths.length > 0) {
            const relativePaths = allLmatPaths.map(p => EditorEnv.assetMgr.toRelativePath(p));
            logger.debug("ModelConversion", `Waiting for ${relativePaths.length} .lmat files to be indexed...`);
            await EditorEnv.assetMgr.waitForAssetsReady(relativePaths);
            logger.debug("ModelConversion", `All .lmat files indexed.`);
        }

        for (const remap of this.owner._pendingMaterialRemaps) {
            try {
                logger.info("ModelConversion", `Processing FBX: ${remap.fbxMetaPath}`);
                logger.debug("ModelConversion", `Target dir: ${remap.targetDir}`);
                logger.debug("ModelConversion", `Embedded materials: ${JSON.stringify(Array.from(remap.embeddedMaterials.entries()))}`);
                
                // 读取当前的 FBX meta 文件
                const metaContent = await IEditorEnv.utils.readJsonAsync(remap.fbxMetaPath);
                if (!metaContent?.importer?.remappedMaterials) {
                    logger.warn("ModelConversion", `No remappedMaterials found in ${remap.fbxMetaPath}`);
                    continue;
                }

                let updated = false;

                // 在目标目录中查找所有 .lmat 文件
                const lmatFiles = await this.findLmatFiles(remap.targetDir);
                logger.debug("ModelConversion", `Found ${lmatFiles.length} .lmat files in ${remap.targetDir}: ${lmatFiles.join(", ")}`);

                // 遍历内嵌材质，查找对应的转换后材质文件
                for (const [materialName, cocosMaterialUuid] of remap.embeddedMaterials) {
                    let matchedLmatPath: string | null = null;
                    let matchedAssetId: string | null = null;
                    
                    // 策略1：尝试通过 UUID 匹配（内嵌材质 UUID）
                    for (const lmatPath of lmatFiles) {
                        const lmatMetaPath = lmatPath + ".meta";
                        if (await IEditorEnv.utils.fileExists(lmatMetaPath)) {
                            const lmatMeta = await IEditorEnv.utils.readJsonAsync(lmatMetaPath);
                            // 检查 UUID 是否匹配（去掉 @ 后缀）
                            const baseUuid = cocosMaterialUuid.split("@")[0];
                            if (lmatMeta.uuid === cocosMaterialUuid || lmatMeta.uuid === baseUuid) {
                                matchedLmatPath = lmatPath;
                                matchedAssetId = lmatMeta.uuid;
                                logger.debug("ModelConversion", `Matched by UUID: ${lmatPath}`);
                                break;
                            }
                        }
                    }
                    
                    // 策略2：如果 UUID 匹配失败，不自动设置 remappedMaterials
                    // FBX 嵌入材质名称（如 Material _25）和外部材质文件名（如 mat_tree.mtl）之间没有直接关联
                    // 错误的自动匹配会导致材质错乱
                    // 正确的材质应该通过场景/预制体中的 MeshRenderer.sharedMaterials 覆盖来设置
                    if (!matchedLmatPath && lmatFiles.length > 0) {
                        logger.info("ModelConversion", `UUID match failed for "${materialName}". Not setting remappedMaterials to avoid incorrect material assignment.`);
                        logger.debug("ModelConversion", `Available .lmat files in directory: ${lmatFiles.map(f => fpath.basename(f)).join(", ")}`);
                        logger.debug("ModelConversion", `Material should be set via MeshRenderer.sharedMaterials override in scene/prefab.`);
                    }

                    if (matchedLmatPath) {
                        // 从 meta 文件读取 UUID
                        const lmatMetaPath = matchedLmatPath + ".meta";
                        if (await IEditorEnv.utils.fileExists(lmatMetaPath)) {
                            const lmatMeta = await IEditorEnv.utils.readJsonAsync(lmatMetaPath);
                            matchedAssetId = lmatMeta.uuid;
                        }
                        
                        if (matchedAssetId) {
                            // LayaAir IDE 的 remappedMaterials 需要使用 res://UUID 格式
                            const resPath = `res://${matchedAssetId}`;
                            metaContent.importer.remappedMaterials[materialName] = resPath;
                            updated = true;
                            logger.info("ModelConversion", `Mapped material "${materialName}" -> ${resPath}`);
                        } else {
                            logger.warn("ModelConversion", `Could not get asset ID for ${matchedLmatPath}`);
                        }
                    } else {
                        logger.warn("ModelConversion", `No matching .lmat file found for material "${materialName}" (UUID: ${cocosMaterialUuid})`);
                    }
                }

                // 如果有更新，写回 meta 文件
                if (updated) {
                    await IEditorEnv.utils.writeJsonAsync(remap.fbxMetaPath, metaContent);
                    logger.debug("ModelConversion", `Updated FBX meta: ${remap.fbxMetaPath}`);
                    
                    // 通知资产管理器重新导入 FBX
                    const fbxRelativePath = EditorEnv.assetMgr.toRelativePath(remap.fbxMetaPath.replace(".meta", ""));
                    await EditorEnv.assetMgr.waitForAssetsReady([fbxRelativePath]);

                    // 重新导入后 .lh 会被引擎重新生成，需要再次修复 castShadow 默认值
                    const fbxMetaData = await IEditorEnv.utils.readJsonAsync(remap.fbxMetaPath);
                    if (fbxMetaData?.uuid) {
                        const prefabLibPath = fpath.join(EditorEnv.projectPath, "library", fbxMetaData.uuid.substring(0, 2), `${fbxMetaData.uuid}@0.lh`);
                        if (fs.existsSync(prefabLibPath)) {
                            try {
                                const prefabData = await IEditorEnv.utils.readJsonAsync(prefabLibPath);
                                if (prefabData && this.fixMeshRendererCastShadow(prefabData)) {
                                    await IEditorEnv.utils.writeJsonAsync(prefabLibPath, prefabData);
                                    logger.debug("ModelConversion", `Re-fixed castShadow after material remap for ${fpath.basename(prefabLibPath)}`);
                                }
                            } catch (e) {
                                logger.warn("ModelConversion", `Failed to re-fix castShadow: ${e}`);
                            }
                        }
                    }
                }
            } catch (error) {
                logger.error("ModelConversion", `Failed to update material remap for ${remap.fbxMetaPath}:`, error);
            }
        }

        // 清空待处理列表
        this.owner._pendingMaterialRemaps = [];
    }

    /**
     * 查找目录中的所有 .lmat 文件
     */
    /**
     * 递归修复节点树中所有 MeshRenderer/SkinnedMeshRenderer 的 castShadow 为 false
     * Cocos 默认不投射阴影，LayaAir 默认投射阴影，需要对齐
     */
    private fixMeshRendererCastShadow(node: any): boolean {
        let modified = false;

        if (node._$comp && Array.isArray(node._$comp)) {
            for (const comp of node._$comp) {
                if (comp._$type === "MeshRenderer" || comp._$type === "SkinnedMeshRenderer") {
                    if (comp.castShadow === undefined || comp.castShadow === true) {
                        comp.castShadow = false;
                        modified = true;
                    }
                }
            }
        }

        if (node._$child && Array.isArray(node._$child)) {
            for (const child of node._$child) {
                if (this.fixMeshRendererCastShadow(child)) {
                    modified = true;
                }
            }
        }

        return modified;
    }

    private async findLmatFiles(dir: string): Promise<string[]> {
        const lmatFiles: string[] = [];
        
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith(".lmat")) {
                    lmatFiles.push(fpath.join(dir, entry.name));
                }
            }
        } catch (error) {
            console.warn(`[ModelConversion] Failed to read directory ${dir}:`, error);
        }
        
        return lmatFiles;
    }
}