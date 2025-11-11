import { CocosMigrationTool } from "./core/CocosMigrationTool";
import "./core/components/ConvertMeshRenderer";
import "./core/components/ConvertDirectionLight";
import "./core/components/ConvertCamera";

@IEditorEnv.regClass()
export class CocosImportMain {

    static async doImport(sourceFolder: string, targetFolder: string) {
        let importer = new CocosMigrationTool();
        await importer.run([{ sourceFolder, targetFolder }]);
    }
}