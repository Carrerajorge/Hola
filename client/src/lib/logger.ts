const isDev = import.meta.env.DEV;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
}

function createLogger(prefix: string): Logger {
  const formatArgs = (args: unknown[]) => [`[${prefix}]`, ...args];
  
  return {
    debug: (...args: unknown[]) => {
      if (isDev) console.debug(...formatArgs(args));
    },
    info: (...args: unknown[]) => {
      if (isDev) console.info(...formatArgs(args));
    },
    warn: (...args: unknown[]) => {
      console.warn(...formatArgs(args));
    },
    error: (...args: unknown[]) => {
      console.error(...formatArgs(args));
    },
    log: (...args: unknown[]) => {
      if (isDev) console.log(...formatArgs(args));
    },
  };
}

export const chatLogger = createLogger('ChatInterface');
export const messageLogger = createLogger('MessageList');
export const agentLogger = createLogger('Agent');
export const uploadLogger = createLogger('Upload');

export default createLogger;
