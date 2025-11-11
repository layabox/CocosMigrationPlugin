export interface ComponentParserContext {
    /**
     * 当前的 Prefab 转换实例。
     * 由于避免循环引用，这里使用 any 类型，调用方可自行断言。
     */
    conversion: any;

    /** 正在处理的目标节点（Laya 结构）。 */
    node: any;

    /** Cocos 组件的原始数据。 */
    data: any;

    /** 是否处于 override（Prefab 覆盖）模式。 */
    isOverride: boolean;
}

export type ComponentParser = (context: ComponentParserContext) => boolean | void;

const registry = new Map<string, ComponentParser>();

/**
 * 注册组件解析器，允许外部模块扩展 Prefab 转换流程。
 * @param componentType Cocos 组件的 __type__ 名称。
 * @param parser 解析函数，返回 false 时将继续执行内置解析逻辑。
 */
export function registerComponentParser(componentType: string, parser: ComponentParser): void {
    if (!componentType || typeof parser !== "function")
        return;
    registry.set(componentType, parser);
}

/**
 * 注销组件解析器。
 */
export function unregisterComponentParser(componentType: string): void {
    if (!componentType)
        return;
    registry.delete(componentType);
}

/**
 * 获取指定组件类型的解析器。
 */
export function getComponentParser(componentType: string): ComponentParser | undefined {
    if (!componentType)
        return undefined;
    return registry.get(componentType);
}

/**
 * 清空所有组件解析器。
 */
export function clearComponentParsers(): void {
    registry.clear();
}

