export interface ICocosMigrationTool {
    /**
     * Ccocos的项目配置
     */
    readonly projectConfig: any;

    /**
     * Cocos项目根目录
     */
    readonly cocosProjectRoot: string;

    /**
     * 所有资源的信息
     */
    readonly allAssets: Map<string, {
        sourcePath: string,
        userData: any
    }>;

    /**
     * 待处理的天空盒材质列表
     */
    _pendingSkyboxMaterials?: Array<{
        path: string;
        data: any;
        uuid: string;
    }>;

    /**
     * 执行迁移
     * @param tasks 任务列表
     * - sourceFolder 源文件夹路径
     * - targetFolder 目标文件夹路径，如果不指定，则源文件只参与分析，不进行实际输出
     * @param options 
     * - cocosInternalAssetsFolder Cocos内部资源文件夹路径，如果源文件夹不在cocos项目内，则需要指定此参数以便正确处理内部资源
     * - cocosProjectConfig Cocos项目配置，如果不指定则尝试从项目文件夹所在项目读取
     * - copyUnknownAssets 是否复制无法识别的资源文件，默认为false
     */
    run(tasks: ReadonlyArray<{
        sourceFolder: string,
        targetFolder?: string,
    }>, options?: {
        cocosInternalAssetsFolder?: string,
        cocosProjectConfig?: any,
        copyUnknownAssets?: boolean
    }): Promise<void>;

    /**
     * 获得指定扩展名的资源转换器实例
     * @param ext 文件扩展名
     * @returns 资源转换器实例，找不到时返回null 
     */
    getAssetConversion(ext: string): ICocosAssetConversion | null;
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