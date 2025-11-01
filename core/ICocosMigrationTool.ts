export interface ICocosMigrationTool {
    /**
     * Ccocos的项目配置
     */
    readonly projectConfig: any;

    /**
     * 所有资源的信息
     */
    readonly allAssets: Map<string, {
        sourcePath: string,
        userData: any
    }>;
}

export interface ICocosAssetConversion {
    /**
     * 执行一个文件的转换
     * @param sourcePath 源文件完整路径
     * @param targetPath 目标文件完整路径
     * @param meta meta文件信息
     */
    run(sourcePath: string, targetPath: string, meta: any): Promise<void>;

    /**
     * 可选的实现。当所有同类型文件处理完后被调用。
     */
    complete?(): Promise<void>;
}