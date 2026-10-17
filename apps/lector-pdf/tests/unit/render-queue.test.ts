import { afterEach, describe, expect, it } from 'vitest';
import { type LogLevel, configureLogging, consoleSink } from '@suite/shared';
import { type RenderJob, RenderQueue } from '../../src/core/render-queue';

/** Cede el control hasta que se hayan procesado las microtareas y los setImmediate pendientes. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

interface Controllable {
  readonly job: RenderJob;
  starts(): number;
  signal(): AbortSignal;
  release(): void;
}

/** Trabajo que sigue en curso hasta que el test lo libera o se aborta. */
function controllable(key: string, priority: number, log: string[] = []): Controllable {
  let starts = 0;
  let current: AbortSignal | undefined;
  let finish: () => void = () => undefined;
  const job: RenderJob = {
    key,
    priority,
    run(signal) {
      starts += 1;
      current = signal;
      log.push(`start:${key}`);
      return new Promise<void>((resolve) => {
        finish = resolve;
        signal.addEventListener('abort', () => {
          log.push(`abort:${key}`);
          resolve();
        });
      });
    },
  };
  return {
    job,
    starts: () => starts,
    signal: () => {
      if (current === undefined) throw new Error(`«${key}» aún no ha empezado`);
      return current;
    },
    release: () => finish(),
  };
}

interface Tracker {
  running: number;
  maxRunning: number;
  order: string[];
}

/** Trabajo que dura un setImmediate y registra cuántos se solapan. */
function timedJob(key: string, priority: number, tracker: Tracker): RenderJob {
  return {
    key,
    priority,
    async run(): Promise<void> {
      tracker.running += 1;
      tracker.maxRunning = Math.max(tracker.maxRunning, tracker.running);
      tracker.order.push(key);
      await tick();
      tracker.running -= 1;
    },
  };
}

describe('RenderQueue', () => {
  afterEach(() => {
    configureLogging({ sink: consoleSink, minLevel: 'warn' });
  });

  it('con concurrencia 2 ordena por prioridad y nunca tiene más de 2 en curso', async () => {
    const queue = new RenderQueue(2);
    const tracker: Tracker = { running: 0, maxRunning: 0, order: [] };
    // Las claves llevan la prioridad; «1b» llegó después que «1».
    const specs: ReadonlyArray<readonly [string, number]> = [
      ['3', 3],
      ['1', 1],
      ['2', 2],
      ['0', 0],
      ['1b', 1],
    ];
    for (const [key, priority] of specs) queue.request(timedJob(key, priority, tracker));

    await queue.onIdle();

    expect(tracker.order).toEqual(['0', '1', '1b', '2', '3']);
    expect(tracker.maxRunning).toBe(2);
    expect(queue.pendingCount).toBe(0);
    expect(queue.runningCount).toBe(0);
  });

  it('por defecto la concurrencia es 2', async () => {
    const queue = new RenderQueue();
    const tracker: Tracker = { running: 0, maxRunning: 0, order: [] };
    for (let i = 0; i < 5; i += 1) queue.request(timedJob(`p${i}`, i, tracker));
    await queue.onIdle();
    expect(tracker.maxRunning).toBe(2);
    expect(tracker.order).toHaveLength(5);
  });

  it('rechaza una concurrencia que no sea un entero positivo', () => {
    expect(() => new RenderQueue(0)).toThrow(RangeError);
    expect(() => new RenderQueue(1.5)).toThrow(RangeError);
  });

  it('request de una clave en curso aborta su señal y la vuelve a ejecutar', async () => {
    const queue = new RenderQueue(2);
    const log: string[] = [];
    const first = controllable('a', 0, log);
    queue.request(first.job);
    await tick();
    expect(first.starts()).toBe(1);

    const second = controllable('a', 0, log);
    queue.request(second.job);
    expect(first.signal().aborted).toBe(true);

    await tick();
    expect(second.starts()).toBe(1);
    expect(second.signal().aborted).toBe(false);
    expect(log).toEqual(['start:a', 'abort:a', 'start:a']);

    second.release();
    await queue.onIdle();
  });

  it('request de una clave pendiente la reemplaza sin ejecutar la anterior', async () => {
    const queue = new RenderQueue(1);
    const blocker = controllable('x', 0);
    queue.request(blocker.job);
    await tick();

    const old = controllable('a', 5);
    const replacement = controllable('a', 1);
    queue.request(old.job);
    queue.request(replacement.job);
    expect(queue.pendingCount).toBe(1);

    blocker.release();
    await tick();
    expect(old.starts()).toBe(0);
    expect(replacement.starts()).toBe(1);

    replacement.release();
    await queue.onIdle();
  });

  it('cancel de una pendiente impide que empiece', async () => {
    const queue = new RenderQueue(1);
    const blocker = controllable('x', 0);
    const pending = controllable('a', 0);
    queue.request(blocker.job);
    queue.request(pending.job);
    await tick();

    queue.cancel('a');
    expect(queue.pendingCount).toBe(0);

    blocker.release();
    await queue.onIdle();
    expect(pending.starts()).toBe(0);
  });

  it('cancel de una clave en curso aborta su señal', async () => {
    const queue = new RenderQueue(2);
    const running = controllable('a', 0);
    queue.request(running.job);
    await tick();

    queue.cancel('a');
    expect(running.signal().aborted).toBe(true);
    await queue.onIdle();
    expect(queue.runningCount).toBe(0);
  });

  it('cancel de una clave desconocida no hace nada', async () => {
    const queue = new RenderQueue(2);
    queue.cancel('nada');
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });

  it('cancelAll deja pendingCount a 0, aborta las que están en curso y onIdle resuelve al final', async () => {
    const queue = new RenderQueue(1);
    const running = controllable('a', 0);
    const pending = controllable('b', 0);
    queue.request(running.job);
    queue.request(pending.job);
    await tick();

    queue.cancelAll();
    expect(queue.pendingCount).toBe(0);
    expect(running.signal().aborted).toBe(true);

    await queue.onIdle();
    expect(queue.runningCount).toBe(0);
    expect(pending.starts()).toBe(0);
  });

  it('setPriority reordena los pendientes; no afecta a los que están en curso', async () => {
    const queue = new RenderQueue(1);
    const tracker: Tracker = { running: 0, maxRunning: 0, order: [] };
    const blocker = controllable('x', 0);
    queue.request(blocker.job);
    await tick();

    queue.request(timedJob('a', 5, tracker));
    queue.request(timedJob('b', 1, tracker));
    queue.setPriority('a', 0);
    queue.setPriority('no-existe', 0);

    blocker.release();
    await queue.onIdle();
    expect(tracker.order).toEqual(['a', 'b']);
  });

  it('onIdle resuelve de inmediato si no hay nada', async () => {
    const queue = new RenderQueue(2);
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });

  it('un trabajo que rechaza sin abortar no detiene la cola y registra un aviso', async () => {
    const entries: Array<{
      level: LogLevel;
      scope: string;
      message: string;
      data: unknown;
    }> = [];
    configureLogging({
      sink: (level, scope, message, data) => entries.push({ level, scope, message, data }),
      minLevel: 'warn',
    });
    const queue = new RenderQueue(1);
    const tracker: Tracker = { running: 0, maxRunning: 0, order: [] };
    const failing: RenderJob = {
      key: 'roto',
      priority: 0,
      run() {
        tracker.order.push('roto');
        return Promise.reject(new Error('fallo de prueba'));
      },
    };
    queue.request(failing);
    queue.request(timedJob('despues', 1, tracker));

    await queue.onIdle();

    expect(tracker.order).toEqual(['roto', 'despues']);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'warn',
      scope: 'render',
      message: 'trabajo de render fallido',
    });
    expect(entries[0]?.data).toMatchObject({ key: 'roto' });
  });

  it('un run que lanza de forma síncrona también se registra y no detiene la cola', async () => {
    const entries: string[] = [];
    configureLogging({
      sink: (_level, _scope, message) => entries.push(message),
      minLevel: 'warn',
    });
    const queue = new RenderQueue(1);
    const tracker: Tracker = { running: 0, maxRunning: 0, order: [] };
    queue.request({
      key: 'lanza',
      priority: 0,
      run() {
        throw new Error('lanza');
      },
    });
    queue.request(timedJob('despues', 1, tracker));

    await queue.onIdle();

    expect(entries).toEqual(['trabajo de render fallido']);
    expect(tracker.order).toEqual(['despues']);
  });

  it('un fallo tras abortar no se registra: es una cancelación esperada', async () => {
    const entries: string[] = [];
    configureLogging({
      sink: (_level, _scope, message) => entries.push(message),
      minLevel: 'warn',
    });
    const queue = new RenderQueue(2);
    const job: RenderJob = {
      key: 'cancelable',
      priority: 0,
      run(signal) {
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abortado')));
        });
      },
    };
    queue.request(job);
    await tick();

    queue.cancel('cancelable');
    await queue.onIdle();

    expect(entries).toEqual([]);
  });
});
