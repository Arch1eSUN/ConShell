/**
 * Structured JSON logger for web4-agent.
 *
 * All log output goes to stderr (stdout reserved for MCP stdio transport).
 * Each log line is a single JSON object with: level, message, timestamp, and optional fields.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};

export interface LogEntry {
    readonly level: LogLevel;
    readonly message: string;
    readonly timestamp: string;
    readonly module?: string;
    readonly [key: string]: unknown;
}

export interface Logger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
    fatal(message: string, fields?: Record<string, unknown>): void;
    child(module: string): Logger;
}

export class StructuredLogger implements Logger {
    private readonly minLevel: number;
    private readonly moduleName?: string;
    private readonly writer: (line: string) => void;

    constructor(
        level: LogLevel = 'info',
        moduleName?: string,
        writer?: (line: string) => void,
    ) {
        this.minLevel = LOG_LEVEL_PRIORITY[level];
        this.moduleName = moduleName;
        // Default writer: stderr to keep stdout clean for MCP stdio
        this.writer = writer ?? ((line: string) => process.stderr.write(line + '\n'));
    }

    debug(message: string, fields?: Record<string, unknown>): void {
        this.log('debug', message, fields);
    }

    info(message: string, fields?: Record<string, unknown>): void {
        this.log('info', message, fields);
    }

    warn(message: string, fields?: Record<string, unknown>): void {
        this.log('warn', message, fields);
    }

    error(message: string, fields?: Record<string, unknown>): void {
        this.log('error', message, fields);
    }

    fatal(message: string, fields?: Record<string, unknown>): void {
        this.log('fatal', message, fields);
    }

    child(module: string): Logger {
        const childModule = this.moduleName ? `${this.moduleName}.${module}` : module;
        return new StructuredLogger(
            this.levelName(),
            childModule,
            this.writer,
        );
    }

    private log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
        if (LOG_LEVEL_PRIORITY[level] < this.minLevel) {
            return;
        }

        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date().toISOString(),
            ...(this.moduleName !== undefined ? { module: this.moduleName } : {}),
            ...fields,
        };

        // Serialize errors specially — extract message and stack
        const serialized = JSON.stringify(entry, (_key, value: unknown) => {
            if (value instanceof Error) {
                const errorObj: Record<string, unknown> = {
                    name: value.name,
                    message: value.message,
                    stack: value.stack,
                };
                // Include any extra enumerable properties (e.g. code from Web4Error)
                for (const prop of Object.getOwnPropertyNames(value)) {
                    if (!(prop in errorObj)) {
                        errorObj[prop] = (value as unknown as Record<string, unknown>)[prop];
                    }
                }
                return errorObj;
            }
            return value;
        });

        this.writer(serialized);
    }

    private levelName(): LogLevel {
        const entries = Object.entries(LOG_LEVEL_PRIORITY) as Array<[LogLevel, number]>;
        const match = entries.find(([, priority]) => priority === this.minLevel);
        return match?.[0] ?? 'info';
    }
}

/**
 * Create a root logger instance.
 * The global default for the runtime — modules create children via logger.child('module-name').
 */
export function createLogger(level: LogLevel = 'info'): Logger {
    return new StructuredLogger(level);
}

/**
 * Create a logger that captures output for testing.
 */
export function createTestLogger(): { logger: Logger; lines: LogEntry[] } {
    const lines: LogEntry[] = [];
    const writer = (line: string): void => {
        lines.push(JSON.parse(line) as LogEntry);
    };
    const logger = new StructuredLogger('debug', undefined, writer);
    return { logger, lines };
}
