export class UIMain {
    @IEditor.menu("App/迁移Cocos/迁移Cocos项目资源（测试）")
    static async importAssetsTest() {
let sourceFolder = "C:/Users/WIN11/CocosHelloWorld/assets";
        //let sourceFolder = "C:/Users/WIN11/CocosEmpty3D/assets";
        let targetFolder = Editor.assetsPath + "/cc-assets/";

        Editor.scene.runScript("CocosImportMain.doImport", sourceFolder, targetFolder);
    }

    @IEditor.menu("App/迁移Cocos/迁移Cocos项目资源")
    static async importAssets() {
        let ret = await Editor.showOpenFolderDialog("选择Cocos资源目录");
        if (ret.canceled)
            return;

        let sourceFolder = ret.filePaths[0];

        ret = await Editor.showOpenAssetsFolderDialog("选择Laya项目资源目录");
        if (ret.canceled)
            return;

        let targetFolder = Editor.assetsPath + "/" + ret.filePaths[0];
        Editor.scene.runScript("CocosImportMain.doImport", sourceFolder, targetFolder);
    }
}