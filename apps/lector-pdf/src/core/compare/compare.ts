import { createLogger } from '@suite/shared';
import type { PageTextSource } from '../search/session';
import { diffSequences } from './diff';
import { pageWords, type Word } from './words';

const log = createLogger('compare');

/** Tope de ediciones (D de Myers) por página; por encima la página se marca «muy distinta» sin detalle. */
export const MAX_EDITS_PER_PAGE = 2000;

/** Longitud máxima de cada lado en la descripción de un cambio (incluido «…»). */
const MAX_SIDE_CHARS = 80;
const DEFAULT_TIME_SLICE_MS = 8;
const PROGRESS_INTERVAL_MS = 100;

export type PageChange =
  | { readonly kind: 'replace' | 'delete' | 'insert'; readonly removed: readonly Word[]; readonly added: readonly Word[] }; // delete: added vacío; insert: removed vacío

export type PageComparison =
  | { readonly kind: 'same'; readonly page: number }
  | { readonly kind: 'changed'; readonly page: number; readonly changes: readonly PageChange[] }
  | { readonly kind: 'too-different'; readonly page: number }
  | { readonly kind: 'only-in-a' | 'only-in-b'; readonly page: number };

/** Compara las palabras de una página. Una secuencia de ediciones sin tramos iguales intermedios es un único cambio. */
export function comparePageWords(page: number, a: readonly Word[], b: readonly Word[]): PageComparison {
  if (a.length === 0 && b.length === 0) return { kind: 'same', page };

  const ops = diffSequences(
    a.map((word) => word.text),
    b.map((word) => word.text),
    MAX_EDITS_PER_PAGE,
  );
  if (ops === null) return { kind: 'too-different', page };

  const changes: PageChange[] = [];
  let group: { aStart: number; aEnd: number; bStart: number; bEnd: number } | undefined;
  const flush = (): void => {
    if (group === undefined) return;
    const removed = a.slice(group.aStart, group.aEnd);
    const added = b.slice(group.bStart, group.bEnd);
    const kind = removed.length > 0 && added.length > 0 ? 'replace' : removed.length > 0 ? 'delete' : 'insert';
    changes.push({ kind, removed, added });
    group = undefined;
  };

  for (const op of ops) {
    if (op.kind === 'equal') {
      flush();
      continue;
    }
    if (group === undefined) {
      group = { aStart: op.aStart, aEnd: op.aEnd, bStart: op.bStart, bEnd: op.bEnd };
    } else {
      group.aEnd = op.aEnd;
      group.bEnd = op.bEnd;
    }
  }
  flush();

  if (changes.length === 0) return { kind: 'same', page };
  return { kind: 'changed', page, changes };
}

export interface CompareProgress {
  readonly pagesDone: number;
  readonly totalPages: number;
  readonly changedPages: number;
}

export interface CompareCallbacks {
  onPage(r: PageComparison): void;
  onProgress(p: CompareProgress): void;
  onDone(p: CompareProgress & { readonly cancelled: boolean }): void;
}

export interface CompareSide {
  readonly numPages: number;
  readonly source: PageTextSource;
}

/**
 * Recorre max(numA, numB) páginas en orden. Cede el hilo cada `timeSliceMs` de trabajo; progreso como máximo cada 100 ms.
 * Un fallo al leer una página → se informa como 'too-different' y se sigue. `cancel()` no lee más páginas.
 */
export class CompareSession {
  readonly #a: CompareSide;
  readonly #b: CompareSide;
  readonly #callbacks: CompareCallbacks;
  readonly #timeSliceMs: number;
  readonly #now: () => number;
  readonly #totalPages: number;
  readonly #controller = new AbortController();

  #started = false;
  #finished = false;
  #pagesDone = 0;
  #changedPages = 0;
  #lastProgressAt = Number.NEGATIVE_INFINITY;

  constructor(
    a: CompareSide,
    b: CompareSide,
    callbacks: CompareCallbacks,
    opts: { readonly timeSliceMs?: number; readonly now?: () => number } = {},
  ) {
    this.#a = a;
    this.#b = b;
    this.#callbacks = callbacks;
    this.#timeSliceMs = opts.timeSliceMs ?? DEFAULT_TIME_SLICE_MS;
    this.#now = opts.now ?? (() => performance.now());
    this.#totalPages = Math.max(a.numPages, b.numPages);
  }

  /** Inicia la comparación en segundo plano. No lanza: los errores de página se registran y cuentan como 'too-different'. */
  start(): void {
    if (this.#started || this.#finished) return;
    this.#started = true;

    if (this.#totalPages === 0) {
      this.#finish(false);
      return;
    }

    this.#run().catch((error: unknown) => {
      log.error('la comparación se ha interrumpido por un error inesperado', error);
      this.#finish(false);
    });
  }

  /** Detiene la comparación. `onDone({ cancelled: true })` se llama una sola vez. */
  cancel(): void {
    if (this.#finished) return;
    this.#controller.abort();
    this.#finish(true);
  }

  async #run(): Promise<void> {
    let sliceStart = this.#now();
    for (let page = 0; page < this.#totalPages; page++) {
      if (this.#finished) return;

      const result = await this.#comparePage(page);
      if (this.#finished) return;

      this.#pagesDone += 1;
      if (result.kind !== 'same') {
        this.#changedPages += 1;
        this.#callbacks.onPage(result);
        if (this.#finished) return;
      }
      this.#maybeReportProgress();

      if (this.#now() - sliceStart >= this.#timeSliceMs) {
        await yieldToEventLoop();
        if (this.#finished) return;
        sliceStart = this.#now();
      }
    }

    this.#finish(false);
  }

  async #comparePage(page: number): Promise<PageComparison> {
    if (page >= this.#a.numPages) return { kind: 'only-in-b', page };
    if (page >= this.#b.numPages) return { kind: 'only-in-a', page };

    const wordsA = await this.#readWords(this.#a.source, page);
    const wordsB = wordsA === undefined ? undefined : await this.#readWords(this.#b.source, page);
    if (wordsA === undefined || wordsB === undefined) return { kind: 'too-different', page };
    return comparePageWords(page, wordsA, wordsB);
  }

  /** Palabras de una página. `undefined` si no se pudo leer (o se ha cancelado). */
  async #readWords(source: PageTextSource, page: number): Promise<readonly Word[] | undefined> {
    if (this.#controller.signal.aborted) return undefined;
    try {
      const items = await source.getPageItems(page, this.#controller.signal);
      return pageWords(items);
    } catch (error: unknown) {
      if (!this.#controller.signal.aborted) {
        log.warn(`no se ha podido leer el texto de la página ${String(page + 1)}; se marca como muy distinta`, error);
      }
      return undefined;
    }
  }

  #maybeReportProgress(): void {
    const now = this.#now();
    if (now - this.#lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.#lastProgressAt = now;
    this.#callbacks.onProgress(this.#snapshot());
  }

  #snapshot(): CompareProgress {
    return { pagesDone: this.#pagesDone, totalPages: this.#totalPages, changedPages: this.#changedPages };
  }

  #finish(cancelled: boolean): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#callbacks.onDone({ ...this.#snapshot(), cancelled });
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Texto legible de un cambio. Cada lado se recorta a `MAX_SIDE_CHARS` caracteres con «…». */
export function describeChange(c: PageChange): string {
  if (c.kind === 'replace') {
    return `Se ha cambiado “${side(c.removed)}” por “${side(c.added)}”.`;
  }
  if (c.kind === 'delete') {
    return `Se ha eliminado “${side(c.removed)}”.`;
  }
  return `Se ha añadido “${side(c.added)}”.`;
}

function side(words: readonly Word[]): string {
  const chars = Array.from(words.map((word) => word.text).join(' '));
  return chars.length > MAX_SIDE_CHARS ? `${chars.slice(0, MAX_SIDE_CHARS - 1).join('')}…` : chars.join('');
}
