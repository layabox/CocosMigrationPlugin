import { CocosMigrationTool } from "./core/CocosMigrationTool";
import "./core/components/MeshRendererConversion";
import "./core/components/DirectionLightConversion";
import "./core/components/CameraConversion";
import "./core/components/SkinnedMeshRendererConversion";
import "./core/components/AnimationConversion";
import "./core/components/BoxColliderConversion";
import "./core/components/CapsuleColliderConversion";
import "./core/components/ConeColliderConversion";
import "./core/components/CylinderColliderConversion";
import "./core/components/MeshColliderConversion";
import "./core/components/SphereColliderConversion";
import "./core/components/RigidBodyConversion";

@IEditorEnv.regClass()
export class CocosImportMain {

    static async doImport(sourceFolder: string, targetFolder: string) {
        let importer = new CocosMigrationTool();
        await importer.run([{ sourceFolder, targetFolder }]);
    }
}