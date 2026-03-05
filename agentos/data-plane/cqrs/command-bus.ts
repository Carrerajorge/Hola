import { EventEmitter } from "events";
import { Command, CommandHandler, CommandMiddleware, CommandValidator } from "../types";

interface HandlerEntry {
  handler: CommandHandler;
  validator?: CommandValidator;
}

export class CommandBus extends EventEmitter {
  private handlers = new Map<string, HandlerEntry>();
  private middlewares: CommandMiddleware[] = [];
  private executing = new Set<string>();

  /** Register a command handler with an optional validator. */
  register<T = unknown>(
    commandType: string,
    handler: CommandHandler<T>,
    validator?: CommandValidator<T>
  ): void {
    if (this.handlers.has(commandType)) {
      throw new Error(`Handler already registered for command type: ${commandType}`);
    }
    this.handlers.set(commandType, {
      handler: handler as CommandHandler,
      validator: validator as CommandValidator | undefined,
    });
  }

  unregister(commandType: string): boolean {
    return this.handlers.delete(commandType);
  }

  /** Add middleware to the pipeline (executed in order). */
  use(middleware: CommandMiddleware): void {
    this.middlewares.push(middleware);
  }

  /** Dispatch a command through the middleware pipeline to its handler. */
  async dispatch<T = unknown>(command: Command<T>): Promise<void> {
    const entry = this.handlers.get(command.type);
    if (!entry) {
      throw new CommandNotFoundError(`No handler registered for command type: ${command.type}`);
    }

    // Validate
    if (entry.validator) {
      const errors = entry.validator(command.payload);
      if (errors && errors.length > 0) {
        throw new CommandValidationError(command.type, errors);
      }
    }

    // Prevent re-entrant execution of the same correlationId
    const corrId = command.metadata.correlationId;
    if (this.executing.has(corrId)) {
      throw new Error(`Command ${command.type} with correlationId ${corrId} is already executing`);
    }
    this.executing.add(corrId);

    try {
      this.emit("command:received", command);

      // Build the middleware chain
      const chain = this.buildChain(command, entry.handler);
      await chain();

      this.emit("command:completed", command);
    } catch (error) {
      this.emit("command:failed", { command, error });
      throw error;
    } finally {
      this.executing.delete(corrId);
    }
  }

  /** Dispatch and swallow errors, returning success boolean. */
  async tryDispatch<T = unknown>(command: Command<T>): Promise<boolean> {
    try {
      await this.dispatch(command);
      return true;
    } catch {
      return false;
    }
  }

  hasHandler(commandType: string): boolean {
    return this.handlers.has(commandType);
  }

  get registeredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  private buildChain(command: Command, handler: CommandHandler): () => Promise<void> {
    const mws = [...this.middlewares];

    const execute = async (): Promise<void> => {
      await handler(command);
    };

    // Wrap from last middleware to first
    let current = execute;
    for (let i = mws.length - 1; i >= 0; i--) {
      const mw = mws[i];
      const next = current;
      current = () => mw(command, next);
    }

    return current;
  }
}

// ── Built-in middleware ───────────────────────────────────────────────
export function loggingMiddleware(
  logger: (msg: string) => void = console.log
): CommandMiddleware {
  return async (command, next) => {
    const start = Date.now();
    logger(`[CMD] ${command.type} started (${command.metadata.correlationId})`);
    try {
      await next();
      logger(`[CMD] ${command.type} completed in ${Date.now() - start}ms`);
    } catch (err) {
      logger(`[CMD] ${command.type} failed after ${Date.now() - start}ms`);
      throw err;
    }
  };
}

export function retryMiddleware(maxRetries = 3, delayMs = 100): CommandMiddleware {
  return async (command, next) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        command.metadata.retryCount = attempt;
        await next();
        return;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  };
}

// ── Errors ────────────────────────────────────────────────────────────
export class CommandNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandNotFoundError";
  }
}

export class CommandValidationError extends Error {
  public readonly errors: string[];
  constructor(commandType: string, errors: string[]) {
    super(`Validation failed for ${commandType}: ${errors.join(", ")}`);
    this.name = "CommandValidationError";
    this.errors = errors;
  }
}
