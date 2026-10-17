import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureLogging, consoleSink, createLogger } from '../src/index';
import type { LogLevel, LogSink } from '../src/index';

interface Call {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly extra: readonly unknown[];
}

// Sink de prueba: guarda también cuántos argumentos llegaron después de `message`.
function fakeSink(): { sink: LogSink; calls: Call[] } {
  const calls: Call[] = [];
  const sink = (level: LogLevel, scope: string, message: string, ...extra: unknown[]): void => {
    calls.push({ level, scope, message, extra });
  };
  return { sink, calls };
}

// tsconfig sin tipos de DOM/Node: se accede a la consola vía globalThis.
type ConsoleApi = Readonly<Record<LogLevel, (...args: unknown[]) => void>>;
const consoleApi = (globalThis as unknown as { readonly console: ConsoleApi }).console;

describe('logger', () => {
  beforeEach(() => {
    configureLogging({ sink: consoleSink, minLevel: 'warn' });
  });

  afterEach(() => {
    configureLogging({ sink: consoleSink, minLevel: 'warn' });
    vi.restoreAllMocks();
  });

  it('con minLevel info, debug no llega al sink e info/warn/error sí, con (level, scope, message, data)', () => {
    const { sink, calls } = fakeSink();
    configureLogging({ sink, minLevel: 'info' });
    const log = createLogger('pdf');

    log.debug('d');
    log.info('i', { n: 1 });
    log.warn('w');
    log.error('e', 'causa');

    expect(calls).toEqual([
      { level: 'info', scope: 'pdf', message: 'i', extra: [{ n: 1 }] },
      { level: 'warn', scope: 'pdf', message: 'w', extra: [] },
      { level: 'error', scope: 'pdf', message: 'e', extra: ['causa'] },
    ]);
  });

  it('no pasa data al sink cuando es undefined', () => {
    const { sink, calls } = fakeSink();
    configureLogging({ sink, minLevel: 'debug' });
    createLogger('core').debug('solo mensaje');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.extra).toEqual([]);
  });

  it('con sink null no se llama a nada', () => {
    const spy = vi.spyOn(consoleApi, 'error').mockImplementation(() => undefined);
    configureLogging({ sink: null, minLevel: 'debug' });
    const log = createLogger('x');
    log.debug('a');
    log.error('b', 1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('un logger creado antes de configureLogging respeta la configuración nueva', () => {
    const log = createLogger('antes');
    const { sink, calls } = fakeSink();

    configureLogging({ sink, minLevel: 'error' });
    log.warn('no debe salir');
    log.error('sí debe salir');

    expect(calls.map((c) => [c.level, c.message])).toEqual([['error', 'sí debe salir']]);
  });

  it('por defecto consoleSink escribe con console[level] y prefijo [scope]', () => {
    const spy = vi.spyOn(consoleApi, 'warn').mockImplementation(() => undefined);
    createLogger('lector').warn('cuidado', { p: 2 });
    createLogger('lector').debug('oculto por defecto');
    createLogger('core').warn('sin datos');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, '[lector] cuidado', { p: 2 });
    expect(spy).toHaveBeenNthCalledWith(2, '[core] sin datos');
  });
});
