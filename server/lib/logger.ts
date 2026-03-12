// Replaces the basic console.log in server/index.ts
// Uses a structured JSON format suitable for production logging stacks (ELK, Datadog, etc.)
import { logger } from "../utils/logger";

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'security';

export class Logger {
    private readonly scope?: string;

    constructor(scope?: string) {
        this.scope = typeof scope === "string" && scope.trim().length > 0
            ? scope.trim()
            : undefined;
    }

    private format(message: string): string {
        return this.scope ? `[${this.scope}] ${message}` : message;
    }

    static info(message: string, context?: any) {
        logger.info(message, context);
    }

    static warn(message: string, context?: any) {
        logger.warn(message, context);
    }

    static error(message: string, error?: any) {
        if (error instanceof Error) {
            logger.error(message, {
                error: error.message,
                stack: error.stack,
                ...error
            });
        } else {
            logger.error(message, { error });
        }
    }

    static security(message: string, context?: any) {
        logger.warn(message, { ...context, category: 'security' });
    }

    // debug method missing in original but good to have compliant with standard
    static debug(message: string, context?: any) {
        logger.debug(message, context);
    }

    info(message: string, context?: any) {
        Logger.info(this.format(message), context);
    }

    warn(message: string, context?: any) {
        Logger.warn(this.format(message), context);
    }

    error(message: string, error?: any) {
        Logger.error(this.format(message), error);
    }

    security(message: string, context?: any) {
        Logger.security(this.format(message), context);
    }

    debug(message: string, context?: any) {
        Logger.debug(this.format(message), context);
    }
}

// Backwards compatibility wrapper for existing code
export const log = (message: string, source = "express") => {
    Logger.info(`[${source}] ${message}`);
};
