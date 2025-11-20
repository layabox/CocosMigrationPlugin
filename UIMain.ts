export class UIMain {
    // @IEditor.menu("App/迁移Cocos/迁移Cocos内部资源")
    // static async importInternals() {
    //     //修改对应编辑器的路径
    //     let sourceFolder = "/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/resources/3d/engine/editor/assets";

    //     let targetFolder = Editor.assetsPath + "/cc-internal";
    //     Editor.scene.runScript("CocosImportMain.doImport", sourceFolder, targetFolder);
    // }

    @IEditor.menu("App/迁移Cocos/迁移Cocos项目资源（测试）")
    static async importAssetsTest() {
        let sourceFolder = "C:/Users/WIN11/CocosEmpty3D/assets";
        //let sourceFolder = "C:/Users/WIN11/CocosEmpty3D2/assets";

        //let sourceFolder = "C:/Users/WIN11/CocosHelloWorld/assets";
        let targetFolder = Editor.assetsPath + "/cc-assets/";

        Editor.scene.runScript("CocosImportMain.doImport", sourceFolder, targetFolder);
    }

    // @IEditor.menu("App/迁移Cocos/迁移Cocos项目资源")
    // static async importAssets() {
    //     let ret = await Editor.showOpenFolderDialog("选择Cocos资源目录");
    //     if (ret.canceled)
    //         return;

    //     let sourceFolder = ret.filePaths[0];

    //     ret = await Editor.showOpenAssetsFolderDialog("选择Laya项目资源目录");
    //     if (ret.canceled)
    //         return;

    //     let targetFolder = Editor.assetsPath + "/" + ret.filePaths[0];
    //     Editor.scene.runScript("CocosImportMain.doImport", sourceFolder, targetFolder);
    // }
}