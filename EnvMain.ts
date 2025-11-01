import { CocosMigrationTool } from "./core/CocosMigrationTool";

@IEditorEnv.regClass()
export class CocosImportMain {

    static async doImport(sourceFolder: string, targetFolder: string) {
        let importer = new CocosMigrationTool();
        await importer.run({ sourceFolder, targetFolder });
    }
}