type LogRecord = Record<string, unknown>;

type Transport<T extends LogRecord> = (logObj: T) => void;

type LoggerState<T extends LogRecord> = {
  transports: Set<Transport<T>>;
};

type LoggerOptions = {
  name?: string;
  minLevel?: number;
  type?: string;
};

type SubLoggerOptions = {
  name?: string;
  minLevel?: number;
  prefix?: string[];
};

const LEVEL_IDS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
} as const;

type LogMethodName = keyof typeof LEVEL_IDS;

function normalizeArg(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function joinPrefix(prefix: readonly string[]): string | undefined {
  const parts = prefix.filter((value) => typeof value === "string" && value.trim().length > 0);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export class Logger<T extends LogRecord = LogRecord> {
  private readonly state: LoggerState<T>;
  private readonly name?: string;
  private readonly minLevel: number;
  private readonly prefix: string[];

  constructor(options: LoggerOptions = {}, state?: LoggerState<T>, prefix: string[] = []) {
    this.state = state ?? { transports: new Set<Transport<T>>() };
    this.name = options.name;
    this.minLevel = Number.isFinite(options.minLevel) ? Number(options.minLevel) : LEVEL_IDS.info;
    this.prefix = prefix;
  }

  attachTransport(transport: Transport<T>): void {
    this.state.transports.add(transport);
  }

  getSubLogger(options: SubLoggerOptions = {}): Logger<T> {
    const nextPrefix = [...this.prefix, ...(options.prefix ?? [])].filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    return new Logger<T>(
      {
        name: options.name ?? this.name,
        minLevel: options.minLevel ?? this.minLevel,
      },
      this.state,
      nextPrefix,
    );
  }

  trace(...args: unknown[]): void {
    this.emit("trace", args);
  }

  debug(...args: unknown[]): void {
    this.emit("debug", args);
  }

  info(...args: unknown[]): void {
    this.emit("info", args);
  }

  warn(...args: unknown[]): void {
    this.emit("warn", args);
  }

  error(...args: unknown[]): void {
    this.emit("error", args);
  }

  fatal(...args: unknown[]): void {
    this.emit("fatal", args);
  }

  private emit(level: LogMethodName, args: unknown[]): void {
    const levelId = LEVEL_IDS[level];
    if (levelId > this.minLevel) {
      return;
    }

    const record = this.buildRecord(level, levelId, args);
    for (const transport of this.state.transports) {
      try {
        transport(record);
      } catch {
        // Logging must never break caller flow.
      }
    }
  }

  private buildRecord(level: LogMethodName, levelId: number, args: unknown[]): T {
    const date = new Date();
    const record: Record<string, unknown> = {
      date,
      _meta: {
        date: date.toISOString(),
        logLevelId: levelId,
        logLevelName: level.toUpperCase(),
        name: this.name,
        prefix: joinPrefix(this.prefix),
      },
    };

    args.forEach((arg, index) => {
      record[String(index)] = normalizeArg(arg);
    });

    return record as T;
  }
}
