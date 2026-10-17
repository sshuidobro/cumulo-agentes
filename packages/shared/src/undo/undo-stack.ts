import type { Command, UndoListener, UndoState, UndoStackOptions } from './types';

const DEFAULT_MAX_DEPTH = 100;
const DEFAULT_GROUP_DELAY_MS = 500;
const REENTRY_MESSAGE = 'UndoStack: reentrada no permitida';
const GROUP_MESSAGE = 'UndoStack: operación no permitida dentro de group()';

interface Step<D> {
  readonly forward: Command<D>;
  readonly inverse: Command<D>;
}

interface Entry<D> {
  readonly id: number;
  label: string;
  mergeKey: string | undefined;
  readonly steps: Step<D>[];
  lastTime: number;
}

/**
 * Pila de deshacer/rehacer genérica sobre un documento inmutable `D`.
 * Cada `execute` crea una entrada (o añade un paso a la superior si agrupa); cada entrada es una
 * lista de pasos `{forward, inverse}`.
 * Guardado: cada entrada tiene un id creciente que nunca se reutiliza. `markSaved` guarda el id
 * de la entrada superior; `isDirty` compara ese id con el de la entrada superior actual. Al recortar
 * el límite, el id de la última entrada eliminada pasa a ser el id base.
 * Agrupación: los cambios con el mismo `mergeKey` y separados como mucho `groupDelayMs` se agrupan
 * en una entrada; `group()` agrupa todo lo que ocurre dentro de `fn`; `closeGroup()` corta la
 * agrupación automática.
 */
export class UndoStack<D> {
  #doc: D;
  #undo: Entry<D>[] = [];
  #redo: Entry<D>[] = [];
  #nextId = 1;
  #baseId = 0;
  #savedId = 0;
  #maxDepth: number;
  readonly #groupDelayMs: number;
  readonly #now: () => number;
  #busy = false;
  #closed = true;
  #groupDepth = 0;
  #groupLabel = '';
  #groupEntry: Entry<D> | null = null;
  #groupDocBefore: D;
  #groupRedoBefore: Entry<D>[] = [];
  readonly #listeners = new Set<UndoListener>();

  constructor(initial: D, options: UndoStackOptions = {}) {
    this.#doc = initial;
    this.#groupDocBefore = initial;
    this.#maxDepth = validateMaxDepth(options.maxDepth ?? DEFAULT_MAX_DEPTH);
    this.#groupDelayMs = validateGroupDelay(options.groupDelayMs ?? DEFAULT_GROUP_DELAY_MS);
    this.#now = options.now ?? Date.now;
  }

  get doc(): D {
    return this.#doc;
  }

  execute(cmd: Command<D>): D {
    const { inverse, next } = this.#run(() => {
      const before = this.#doc;
      return { inverse: cmd.invert(before), next: cmd.apply(before) };
    });
    this.#doc = next;
    const step: Step<D> = { forward: cmd, inverse };

    if (this.#groupDepth > 0) {
      // Dentro de group(): todo cae en una única entrada; no se recorta ni se notifica aquí.
      if (this.#groupEntry === null) {
        this.#groupEntry = {
          id: this.#nextId++,
          label: this.#groupLabel,
          mergeKey: undefined,
          steps: [step],
          lastTime: this.#now(),
        };
        this.#redo = [];
        this.#undo.push(this.#groupEntry);
      } else {
        this.#groupEntry.steps.push(step);
      }
      return this.#doc;
    }

    const top = this.#undo.at(-1);
    const now = this.#now();
    this.#redo = [];
    if (
      !this.#closed &&
      cmd.mergeKey !== undefined &&
      top !== undefined &&
      top.mergeKey === cmd.mergeKey &&
      now - top.lastTime <= this.#groupDelayMs
    ) {
      top.steps.push(step);
      top.lastTime = now;
    } else {
      this.#undo.push({
        id: this.#nextId++,
        label: cmd.label,
        mergeKey: cmd.mergeKey,
        steps: [step],
        lastTime: now,
      });
    }
    this.#closed = false;
    this.#trim();
    this.#notify();
    return this.#doc;
  }

  undo(): boolean {
    this.#assertIdle();
    this.#assertNotGrouping();
    const entry = this.#undo.at(-1);
    if (entry === undefined) return false;
    const next = this.#run(() => {
      let doc = this.#doc;
      for (const step of entry.steps.toReversed()) {
        doc = step.inverse.apply(doc);
      }
      return doc;
    });
    this.#undo.pop();
    this.#redo.push(entry);
    this.#doc = next;
    this.#closed = true;
    this.#notify();
    return true;
  }

  redo(): boolean {
    this.#assertIdle();
    this.#assertNotGrouping();
    const entry = this.#redo.at(-1);
    if (entry === undefined) return false;
    const next = this.#run(() => {
      let doc = this.#doc;
      for (const step of entry.steps) {
        doc = step.forward.apply(doc);
      }
      return doc;
    });
    this.#redo.pop();
    this.#undo.push(entry);
    this.#doc = next;
    this.#closed = true;
    this.#notify();
    return true;
  }

  setMaxDepth(n: number): void {
    this.#assertIdle();
    this.#assertNotGrouping();
    this.#maxDepth = validateMaxDepth(n);
    this.#trim();
    this.#notify();
  }

  markSaved(): void {
    this.#assertIdle();
    this.#assertNotGrouping();
    this.#savedId = this.#topId();
    this.#closed = true;
    this.#notify();
  }

  isDirty(): boolean {
    return this.#topId() !== this.#savedId;
  }

  clear(): void {
    this.#assertIdle();
    this.#assertNotGrouping();
    this.#baseId = this.#topId();
    this.#undo = [];
    this.#redo = [];
    this.#closed = true;
    this.#notify();
  }

  /** Corta la agrupación automática: el siguiente cambio abre entrada nueva (p. ej. al cambiar la selección). */
  closeGroup(): void {
    this.#closed = true;
  }

  /**
   * Ejecuta `fn` agrupando todos sus cambios en una única entrada llamada `label`.
   * Si `fn` lanza, se deshacen los cambios del grupo y se relanza el error.
   * Los grupos anidados solo ejecutan `fn`: todo cae en la entrada del grupo exterior.
   */
  group<T>(label: string, fn: () => T): T {
    this.#assertIdle();
    const outer = this.#groupDepth === 0;
    if (outer) {
      this.#groupLabel = label;
      this.#groupEntry = null;
      this.#groupDocBefore = this.#doc;
      this.#groupRedoBefore = [...this.#redo];
    }
    this.#groupDepth++;
    let result: T;
    try {
      result = fn();
    } catch (error) {
      this.#groupDepth--;
      if (outer) this.#rollbackGroup();
      throw error;
    }
    this.#groupDepth--;
    if (outer) this.#commitGroup();
    return result;
  }

  getState(): UndoState {
    const undoTop = this.#undo.at(-1);
    const redoTop = this.#redo.at(-1);
    return {
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undoLabel: undoTop?.label ?? null,
      redoLabel: redoTop?.label ?? null,
      undoDepth: this.#undo.length,
      redoDepth: this.#redo.length,
      isDirty: this.isDirty(),
    };
  }

  subscribe(listener: UndoListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #assertIdle(): void {
    if (this.#busy) throw new Error(REENTRY_MESSAGE);
  }

  #assertNotGrouping(): void {
    if (this.#groupDepth > 0) throw new Error(GROUP_MESSAGE);
  }

  /** Ejecuta `fn` marcando la pila como ocupada; cualquier reentrada lanza error. */
  #run<T>(fn: () => T): T {
    this.#assertIdle();
    this.#busy = true;
    try {
      return fn();
    } finally {
      this.#busy = false;
    }
  }

  #commitGroup(): void {
    if (this.#groupEntry === null) return;
    this.#groupEntry = null;
    this.#closed = true;
    this.#trim();
    this.#notify();
  }

  #rollbackGroup(): void {
    const entry = this.#groupEntry;
    if (entry !== null && this.#undo.at(-1) === entry) {
      this.#undo.pop();
    }
    this.#doc = this.#groupDocBefore;
    this.#redo = this.#groupRedoBefore;
    this.#groupEntry = null;
  }

  #topId(): number {
    return this.#undo.at(-1)?.id ?? this.#baseId;
  }

  #trim(): void {
    while (this.#undo.length > this.#maxDepth) {
      const removed = this.#undo.shift();
      if (removed === undefined) break;
      this.#baseId = removed.id;
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener(this.getState());
    }
  }
}

function validateMaxDepth(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('maxDepth debe ser un entero >= 0');
  }
  return n;
}

function validateGroupDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError('groupDelayMs debe ser un número >= 0');
  }
  return ms;
}
