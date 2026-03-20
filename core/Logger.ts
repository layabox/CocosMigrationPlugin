import fs from "fs";
import fpath from "path";

/**
 * 转换日志管理器
 * 将所有转换过程中的日志写入临时文件，方便查看和分析
 */
export class ConversionLogger {
    private static _instance: ConversionLogger;
    private _logFile: string;
    private _logs: string[] = [];
    private _startTime: number = 0;

    private constructor() {
        // 日志文件放在项目根目录的 temp 文件夹下
        const tempDir = fpath.join(EditorEnv.projectPath, "temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        this._logFile = fpath.join(tempDir, "cocos_migration_log.txt");
    }

    static get instance(): ConversionLogger {
        if (!ConversionLogger._instance) {
            ConversionLogger._instance = new ConversionLogger();
        }
        return ConversionLogger._instance;
    }

    /**
     * 获取日志文件路径
     */
    get logFilePath(): string {
        return this._logFile;
    }

    /**
     * 开始新的转换会话
     */
    startSession() {
        this._logs = [];
        this._startTime = Date.now();
        const header = `
================================================================================
Cocos Migration Log
Started: ${new Date().toISOString()}
================================================================================
`;
        this._logs.push(header);
        this.flush();
        console.log(`[ConversionLogger] 日志文件: ${this._logFile}`);
    }

    /**
     * 结束转换会话
     */
    endSession() {
        const duration = Date.now() - this._startTime;
        const footer = `
================================================================================
Conversion Completed
Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)
Ended: ${new Date().toISOString()}
================================================================================
`;
        this._logs.push(footer);
        this.flush();
        console.log(`[ConversionLogger] 转换完成，日志已保存到: ${this._logFile}`);
    }

    /**
     * 记录调试信息
     */
    debug(tag: string, message: string, ...args: any[]) {
        this.log("DEBUG", tag, message, ...args);
    }

    /**
     * 记录普通信息
     */
    info(tag: string, message: string, ...args: any[]) {
        this.log("INFO", tag, message, ...args);
        console.log(`[${tag}] ${message}`, ...args);
    }

    /**
     * 记录警告信息
     */
    warn(tag: string, message: string, ...args: any[]) {
        this.log("WARN", tag, message, ...args);
        console.warn(`[${tag}] ${message}`, ...args);
    }

    /**
     * 记录错误信息
     */
    error(tag: string, message: string, ...args: any[]) {
        this.log("ERROR", tag, message, ...args);
        console.error(`[${tag}] ${message}`, ...args);
    }

    /**
     * 记录日志
     */
    private log(level: string, tag: string, message: string, ...args: any[]) {
        const timestamp = new Date().toISOString();
        let logLine = `[${timestamp}] [${level}] [${tag}] ${message}`;
        
        // 处理额外参数
        if (args.length > 0) {
            for (const arg of args) {
                if (typeof arg === "object") {
                    try {
                        logLine += " " + JSON.stringify(arg, null, 2);
                    } catch (e) {
                        logLine += " [Object]";
                    }
                } else {
                    logLine += " " + String(arg);
                }
            }
        }
        
        this._logs.push(logLine);
        
        // 每 50 条日志自动刷新一次
        if (this._logs.length % 50 === 0) {
            this.flush();
        }
    }

    /**
     * 将日志写入文件
     */
    flush() {
        try {
            fs.writeFileSync(this._logFile, this._logs.join("\n"), "utf-8");
        } catch (e) {
            console.error("[ConversionLogger] 写入日志文件失败:", e);
        }
    }

    /**
     * 添加分隔线
     */
    separator(title?: string) {
        if (title) {
            this._logs.push(`\n--- ${title} ---`);
        } else {
            this._logs.push("\n" + "-".repeat(80));
        }
    }
}

// 导出单例
export const logger = ConversionLogger.instance;

