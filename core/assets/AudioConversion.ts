import fs from "fs";
import { ICocosAssetConversion } from "../ICocosMigrationTool";

/**
 * 音频资源转换器
 * 音频文件不需要转换，直接复制到目标目录即可
 */
export class AudioConversion implements ICocosAssetConversion {

    async run(sourcePath: string, targetPath: string, meta: any) {
        // 直接复制音频文件
        await fs.promises.copyFile(sourcePath, targetPath);

        // 创建 LayaAir 的 meta 文件
        let newMeta = {
            uuid: meta.uuid,
            importer: {}
        };

        await IEditorEnv.utils.writeJsonAsync(targetPath + ".meta", newMeta);
    }
}

