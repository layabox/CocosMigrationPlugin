import { registerComponentParser } from "../ComponentParserRegistry";
import { colorToLayaColor } from "../PrefabConversion";

/**
 * 转换颜色对象为 Laya Color 格式
 * 处理各种颜色格式：{r, g, b, a} 或 {x, y, z, w}
 * 支持 0-255 和 0-1 两种范围
 */
function convertColorToLaya(colorObj: any): any {
    if (!colorObj || typeof colorObj !== "object") {
        return {
            "_$type": "Color",
            r: 1,
            g: 1,
            b: 1,
            a: 1
        };
    }

    // 尝试获取 r, g, b, a
    let r = colorObj.r !== undefined && colorObj.r !== null ? colorObj.r : 
            (colorObj.x !== undefined && colorObj.x !== null ? colorObj.x : 1);
    let g = colorObj.g !== undefined && colorObj.g !== null ? colorObj.g : 
            (colorObj.y !== undefined && colorObj.y !== null ? colorObj.y : 1);
    let b = colorObj.b !== undefined && colorObj.b !== null ? colorObj.b : 
            (colorObj.z !== undefined && colorObj.z !== null ? colorObj.z : 1);
    let a = colorObj.a !== undefined && colorObj.a !== null ? colorObj.a : 
            (colorObj.w !== undefined && colorObj.w !== null ? colorObj.w : 1);

    // 如果值大于 1，说明是 0-255 范围，需要转换为 0-1
    if (r > 1 || g > 1 || b > 1) {
        r = typeof r === "number" && r > 1 ? r / 255 : (typeof r === "number" ? r : 1);
        g = typeof g === "number" && g > 1 ? g / 255 : (typeof g === "number" ? g : 1);
        b = typeof b === "number" && b > 1 ? b / 255 : (typeof b === "number" ? b : 1);
    }
    
    // a 值也需要检查，但通常 alpha 在 0-1 范围
    if (a > 1) {
        a = typeof a === "number" ? a / 255 : 1;
    }

    // 确保所有值都是有效的数字
    r = typeof r === "number" && !isNaN(r) ? r : 1;
    g = typeof g === "number" && !isNaN(g) ? g : 1;
    b = typeof b === "number" && !isNaN(b) ? b : 1;
    a = typeof a === "number" && !isNaN(a) ? a : 1;

    return {
        "_$type": "Color",
        r: r,
        g: g,
        b: b,
        a: a
    };
}

registerComponentParser("cc.Line", ({ owner, node, data, conversion }) => {
    if (!data)
        return;

    if (!Array.isArray(node._$comp))
        node._$comp = [];

    // 确保组件存在的辅助函数
    const ensureComp = (type: string) => {
        let comp = node._$comp.find((c: any) => c._$type === type);
        if (!comp) {
            comp = { "_$type": type };
            node._$comp.push(comp);
        }
        return comp;
    };

    const pixelLineRenderer = ensureComp("PixelLineRenderer");

    // 转换 positions 数组为 PixelLineData 数组
    // Cocos 的 positions 是点数组，需要转换为线段数组
    const positions = data._positions || data.positions || [];
    const pixelLinesDatas: any[] = [];

    if (Array.isArray(positions) && positions.length >= 2) {
        // 遍历 positions，每两个连续的点组成一条线段
        for (let i = 0; i < positions.length - 1; i++) {
            const startPos = positions[i];
            const endPos = positions[i + 1];

            const lineData: any = {
                "_$type": "PixelLineData"
            };

            // 转换起始位置
            if (startPos && typeof startPos === "object") {
                lineData.startPosition = {
                    "_$type": "Vector3",
                    x: typeof startPos.x === "number" ? startPos.x : 0,
                    y: typeof startPos.y === "number" ? startPos.y : 0,
                    z: typeof startPos.z === "number" ? startPos.z : 0
                };
            } else if (Array.isArray(startPos) && startPos.length >= 3) {
                lineData.startPosition = {
                    "_$type": "Vector3",
                    x: typeof startPos[0] === "number" ? startPos[0] : 0,
                    y: typeof startPos[1] === "number" ? startPos[1] : 0,
                    z: typeof startPos[2] === "number" ? startPos[2] : 0
                };
            } else {
                lineData.startPosition = {
                    "_$type": "Vector3",
                    x: 0,
                    y: 0,
                    z: 0
                };
            }

            // 转换结束位置
            if (endPos && typeof endPos === "object") {
                lineData.endPosition = {
                    "_$type": "Vector3",
                    x: typeof endPos.x === "number" ? endPos.x : 0,
                    y: typeof endPos.y === "number" ? endPos.y : 0,
                    z: typeof endPos.z === "number" ? endPos.z : 0
                };
            } else if (Array.isArray(endPos) && endPos.length >= 3) {
                lineData.endPosition = {
                    "_$type": "Vector3",
                    x: typeof endPos[0] === "number" ? endPos[0] : 0,
                    y: typeof endPos[1] === "number" ? endPos[1] : 0,
                    z: typeof endPos[2] === "number" ? endPos[2] : 0
                };
            } else {
                lineData.endPosition = {
                    "_$type": "Vector3",
                    x: 0,
                    y: 0,
                    z: 1
                };
            }

            // 转换颜色
            // Cocos 的 _color 可能是引用对象（通过 __id__），实际可能是 cc.GradientRange 或 cc.Color
            // 需要通过 conversion.elements 解析引用对象
            let colorObj: any = null;

            // 获取 _color 属性
            const colorRef = data._color || data.color;
            
            // 如果颜色是引用对象（有 __id__），需要通过 conversion.elements 解析
            if (colorRef && colorRef.__id__ && conversion && (conversion as any).elements) {
                const elements = (conversion as any).elements;
                const colorElement = elements[colorRef.__id__];
                if (colorElement) {
                    // 检查是否是 GradientRange（渐变范围）
                    if (colorElement.__type__ === "cc.GradientRange" || colorElement._mode !== undefined) {
                        // GradientRange 可能包含单个 color 或 colors 数组
                        // 如果有 colors 数组，使用它（渐变模式）
                        if (colorElement.colors && Array.isArray(colorElement.colors)) {
                            // 处理 colors 数组中的引用对象
                            const colors = colorElement.colors.map((c: any) => {
                                if (c && c.__id__ && elements) {
                                    const resolvedColor = elements[c.__id__];
                                    // 如果解析后是颜色对象，直接返回；否则返回原始引用
                                    return resolvedColor || c;
                                }
                                return c;
                            });
                            
                            // 使用对应索引的颜色
                            const startColorObj = colors[i] || colors[0];
                            const endColorObj = colors[i + 1] || colors[colors.length - 1] || colors[0];
                            
                            lineData.startColor = convertColorToLaya(startColorObj);
                            lineData.endColor = convertColorToLaya(endColorObj);
                            pixelLinesDatas.push(lineData);
                            continue; // 跳过后续处理
                        } else {
                            // GradientRange 中只有单个 color 属性
                            colorObj = colorElement.color || colorElement._color;
                        }
                    } else if (colorElement.__type__ === "cc.Color") {
                        // 直接是颜色对象
                        colorObj = colorElement;
                    } else {
                        // 其他类型，尝试直接使用
                        colorObj = colorElement;
                    }
                }
            } else if (colorRef && typeof colorRef === "object" && !colorRef.__id__) {
                // 直接是颜色对象，不是引用
                colorObj = colorRef;
            }

            // 如果获取到了颜色对象，使用它
            if (colorObj && typeof colorObj === "object") {
                // 使用单个颜色，起始和结束颜色相同
                const convertedColor = convertColorToLaya(colorObj);
                lineData.startColor = convertedColor;
                lineData.endColor = convertedColor;
            } else {
                // 默认颜色（白色）
                lineData.startColor = {
                    "_$type": "Color",
                    r: 1,
                    g: 1,
                    b: 1,
                    a: 1
                };
                lineData.endColor = {
                    "_$type": "Color",
                    r: 1,
                    g: 1,
                    b: 1,
                    a: 1
                };
            }

            pixelLinesDatas.push(lineData);
        }
    }

    // 设置 pixelLinesDatas
    if (pixelLinesDatas.length > 0) {
        pixelLineRenderer.pixelLinesDatas = pixelLinesDatas;
    }

    // 设置 maxLineCount（最大线条数量）
    const maxLineCount = data._maxLineCount ?? data.maxLineCount;
    if (typeof maxLineCount === "number" && maxLineCount > 0) {
        pixelLineRenderer.maxLineCount = maxLineCount;
    } else {
        // 默认值：使用实际线条数量，但至少为 20
        pixelLineRenderer.maxLineCount = Math.max(20, pixelLinesDatas.length);
    }

    // 注意：Cocos 的 width、texture、tile、offset 等属性在 Laya 的 PixelLineRenderer 中没有直接对应
    // 这些属性可能需要通过材质或其他方式处理
});

