import { CocosMigrationTool } from "./core/CocosMigrationTool";
import "./core/components/MeshRendererConversion";
import "./core/components/DirectionLightConversion";
import "./core/components/CameraConversion";
import "./core/components/SkinnedMeshRendererConversion";
import "./core/components/AnimationConversion";

@IEditorEnv.regClass()
export class CocosImportMain {

    static async doImport(sourceFolder: string, targetFolder: string) {
        let importer = new CocosMigrationTool();
        await importer.run([{ sourceFolder, targetFolder }]);
    }
}