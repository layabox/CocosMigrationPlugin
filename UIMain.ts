export class UIMain {
    @IEditor.menu("App/迁移Cocos/迁移Cocos项目资源")
    static async importAssets() {
        let ret = await Editor.showOpenFolderDialog("选择源Cocos资源目录");
        if (ret.canceled)
            return;

        let sourceFolder = ret.filePaths[0];

        ret = await Editor.showOpenAssetsFolderDialog("选择目标Laya资源目录");
        if (ret.canceled)
            return;

        let targetFolder = Editor.assetsPath + "/" + ret.filePaths[0];
        Editor.scene.runScript("CocosImportMain.doImport", sourceFolder, targetFolder);
    }
}