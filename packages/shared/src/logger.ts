export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (level: LogLevel, scope: string, message: string, data?: unknown) => void;
export interface Logger { debug(m: string, data?: unknown): void; info(m: string, data?: unknown): void; warn(m: string, data?: unknown): void; error(m: string, data?: unknown): void; }

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

// tsconfig no incluye los tipos de DOM ni de Node (types: []), así que la consola
// se tipa aquí de forma mínima. Se busca en cada llamada para que los tests puedan espiarla.
type ConsoleApi = Readonly<Record<LogLevel, (...args: unknown[]) => void>>;

export const consoleSink: LogSink = (level, scope, message, data) => {
  const line = `[${scope}] ${message}`;
  const consoleApi = (globalThis as unknown as { readonly console: ConsoleApi }).console;
  const write = consoleApi[level];
  if (data === undefined) {
    write(line);
  } else {
    write(line, data);
  }
};

interface LoggingConfig {
  sink: LogSink | null;
  minLevel: LogLevel;
}

const config: LoggingConfig = { sink: consoleSink, minLevel: 'warn' };

export function configureLogging(opts: { readonly sink?: LogSink | null; readonly minLevel?: LogLevel }): void {
  if (opts.sink !== undefined) config.sink = opts.sink;
  if (opts.minLevel !== undefined) config.minLevel = opts.minLevel;
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, message: string, data?: unknown): void => {
    const { sink, minLevel } = config;
    if (sink === null || LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    if (data === undefined) {
      sink(level, scope, message);
    } else {
      sink(level, scope, message, data);
    }
  };
  return {
    debug: (m, data) => emit('debug', m, data),
    info: (m, data) => emit('info', m, data),
    warn: (m, data) => emit('warn', m, data),
    error: (m, data) => emit('error', m, data),
  };
}
