import { createLogger } from '@suite/shared';

const log = createLogger('render');

const DEFAULT_CONCURRENCY = 2;

/** Trabajo de render. `key` identifica la página o el lienzo; menor `priority` = más urgente. */
export interface RenderJob {
  readonly key: string;
  readonly priority: number;
  run(signal: AbortSignal): Promise<void>;
}

interface PendingEntry {
  readonly job: RenderJob;
  priority: number;
  /** Orden de llegada, para desempatar prioridades iguales. */
  readonly seq: number;
}

interface RunningEntry {
  readonly controller: AbortController;
}

/**
 * Cola de trabajos de render con prioridad, cancelación y concurrencia limitada.
 * Un trabajo abortado cuenta como «en curso» hasta que su `run` termina, así que la
 * concurrencia real nunca se supera.
 */
export class RenderQueue {
  readonly #concurrency: number;
  readonly #pending = new Map<string, PendingEntry>();
  readonly #running = new Map<string, RunningEntry>();
  readonly #idleWaiters: Array<() => void> = [];
  #nextSeq = 0;
  #pumpScheduled = false;

  constructor(concurrency: number = DEFAULT_CONCURRENCY) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError(`La concurrencia debe ser un entero >= 1: ${concurrency}`);
    }
    this.#concurrency = concurrency;
  }

  /** Encola `job`. Si ya hay una pendiente con la misma clave, la reemplaza; si hay una en curso, la aborta. */
  request(job: RenderJob): void {
    this.#running.get(job.key)?.controller.abort();
    this.#pending.set(job.key, {
      job,
      priority: job.priority,
      seq: this.#nextSeq++,
    });
    this.#schedulePump();
  }

  /** Quita la pendiente con esa clave o aborta la que está en curso. */
  cancel(key: string): void {
    this.#pending.delete(key);
    this.#running.get(key)?.controller.abort();
    this.#notifyIdle();
  }

  cancelAll(): void {
    this.#pending.clear();
    for (const entry of this.#running.values()) entry.controller.abort();
    this.#notifyIdle();
  }

  /** Cambia la prioridad de un trabajo pendiente. No afecta a los que ya están en curso. */
  setPriority(key: string, priority: number): void {
    const entry = this.#pending.get(key);
    if (entry !== undefined) entry.priority = priority;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  get runningCount(): number {
    return this.#running.size;
  }

  /** Resuelve cuando no queda nada pendiente ni en curso. */
  onIdle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  #isIdle(): boolean {
    return this.#pending.size === 0 && this.#running.size === 0;
  }

  #notifyIdle(): void {
    if (!this.#isIdle()) return;
    for (const resolve of this.#idleWaiters.splice(0)) resolve();
  }

  /** Arranca trabajos en una microtarea, para que varias `request` seguidas se ordenen por prioridad. */
  #schedulePump(): void {
    if (this.#pumpScheduled) return;
    this.#pumpScheduled = true;
    queueMicrotask(() => {
      this.#pumpScheduled = false;
      this.#pump();
    });
  }

  #pump(): void {
    while (this.#running.size < this.#concurrency) {
      const next = this.#nextPending();
      if (next === undefined) break;
      this.#pending.delete(next.job.key);
      this.#start(next.job);
    }
    this.#notifyIdle();
  }

  /** Mejor pendiente: menor prioridad y, a igualdad, el que llegó antes. Se salta las claves en curso. */
  #nextPending(): PendingEntry | undefined {
    let best: PendingEntry | undefined;
    for (const entry of this.#pending.values()) {
      if (this.#running.has(entry.job.key)) continue;
      if (
        best === undefined ||
        entry.priority < best.priority ||
        (entry.priority === best.priority && entry.seq < best.seq)
      ) {
        best = entry;
      }
    }
    return best;
  }

  #start(job: RenderJob): void {
    const controller = new AbortController();
    const running: RunningEntry = { controller };
    this.#running.set(job.key, running);

    // El wrapper async convierte un throw síncrono de `run` en un rechazo.
    const execution = (async (): Promise<void> => job.run(controller.signal))();
    void execution
      .then(
        () => undefined,
        (error: unknown) => {
          if (!controller.signal.aborted) log.warn('trabajo de render fallido', { key: job.key, error });
        },
      )
      .finally(() => {
        if (this.#running.get(job.key) === running) this.#running.delete(job.key);
        this.#pump();
      });
  }
}
