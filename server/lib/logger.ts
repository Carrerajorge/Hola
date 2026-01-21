
// Replaces the basic console.log in server/index.ts
// Uses a structured JSON format suitable for production logging stacks (ELK, Datadog, etc.)

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'authorization', 'cookie'];

const redact = (obj: any): any => {
    if (!obj) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redact);

    const newObj: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
                newObj[key] = '***REDACTED***';
            } else {
                newObj[key] = redact(obj[key]);
            }
        }
    }
    return newObj;
};

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'security';

export class Logger {
    static info(message: string, context?: any) {
        this.log('info', message, context);
    }

    static warn(message: string, context?: any) {
        this.log('warn', message, context);
    }

    static error(message: string, error?: any) {
        this.log('error', message, {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined
        });
    }

    static security(message: string, context?: any) {
        this.log('security', message, context);
    }

    private static log(level: LogLevel, message: string, context?: any) {
        const timestamp = new Date().toISOString();
        const payload = {
            timestamp,
            level,
            message,
            context: context ? redact(context) : undefined,
            env: process.env.NODE_ENV || 'development'
        };

        console.log(JSON.stringify(payload));
    }
}

// Backwards compatibility wrapper for existing code
export const log = (message: string, source = "express") => {
    Logger.info(`[${source}] ${message}`);
};
