import fs from "fs";
import { ICocosAssetConversion } from "../ICocosMigrationTool";

export class ImageConversion implements ICocosAssetConversion {
    private _targetPaths: string[] = [];

    async run(sourcePath: string, targetPath: string, meta: any) {
        let type = meta.userData.type;
        let subMetas: Array<any> = Object.values(meta.subMetas || {});
        let newMeta = { uuid: meta.uuid, importer: {} };
        let importerData: any = newMeta.importer;

        // Cocos 没有显式的贴图 sRGB 设置，而是在 shader 中手动做 SRGBToLinear(texel²)
        // LayaAir 需要在贴图导入设置中标记 sRGB，让 GPU 硬件做线性化
        // 颜色贴图（texture、sprite-frame）→ sRGB=true
        // 非颜色贴图（normal map、raw）→ sRGB=false
        switch (type) {
            case "texture":
            case "sprite-frame": {
                importerData.textureType = type == "texture" ? 0 : 2;
                importerData.sRGB = true;
                break;
            }

            case "texture cube":
                importerData.textureType = 0;
                importerData.shape = 1;
                importerData.sRGB = true;
                break;

            case "raw":
                importerData.textureType = 0;
                importerData.sRGB = false;
                break;

            case "normal map":
                importerData.textureType = 0;
                importerData.sRGB = false;
                break;
        }

        // Cocos 的 "Fix Alpha Transparency Artifacts" 对应 LayaAir 的预乘 Alpha (pma)
        // 该设置在 Cocos 顶层 userData 中，用于修复透明纹理边缘瑕疵
        if (meta.userData.fixAlphaTransparencyArtifacts) {
            importerData.pma = true;
        }

        for (let subMeta of subMetas) {
            let userData = subMeta.userData;
            if (subMeta.importer == "sprite-frame") {
                if (userData.borderTop !== 0 || userData.borderBottom !== 0 || userData.borderLeft !== 0 || userData.borderRight !== 0) {
                    importerData.sizeGrid = [userData.borderTop, userData.borderRight, userData.borderBottom, userData.borderLeft,];
                }
            }
            else if (subMeta.importer == "texture") {
                importerData.generateMipmap = userData.mipfilter !== "none";
                if (userData.minfilter == "nearest")
                    importerData.filterMode = 0;
                else
                    importerData.filterMode = 1;

                // Convert wrapMode from Cocos to LayaAir
                // Cocos: "repeat" | "clamp-to-edge" | "mirrored-repeat"
                // LayaAir: 0 = repeat, 1 = clamp, 2 = mirrored
                const wrapModeS = userData.wrapModeS;
                const wrapModeT = userData.wrapModeT;
                const mapWrap = (mode: string | undefined): number => {
                    if (mode === "clamp-to-edge") return 1;
                    if (mode === "mirrored-repeat") return 2;
                    return 0; // "repeat" or default → Repeat (Cocos default is repeat)
                };
                importerData.wrapMode = mapWrap(wrapModeS);
                // Note: LayaAir's importer only has a single wrapMode that applies to both U and V.
                // If S and T differ, we use S as the primary. This is a limitation.
                // For per-axis control, the material's propertyParams (wrapModeU/V) can override.
            }
        }

        // 必须先写 meta 再复制图片文件
        // 否则 IDE 检测到新图片后会用默认设置导入到 library 缓存，
        // 导致后续刷新 IDE 时读到错误的缓存（如 sRGB、textureType 丢失）
        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", newMeta);
        await fs.promises.copyFile(sourcePath, targetPath);
        this._targetPaths.push(targetPath);
    }

    async complete(): Promise<void> {
        if (this._targetPaths.length === 0) return;

        // 等待 IDE 完成所有图片资源的导入，刷新内存中的纹理缓存
        // 否则 IDE 编辑器视图会显示旧的/错误的纹理，需要手动刷新才能恢复
        const relativePaths = this._targetPaths.map(p => EditorEnv.assetMgr.toRelativePath(p));
        await EditorEnv.assetMgr.waitForAssetsReady(relativePaths);
        this._targetPaths.length = 0;
    }
}