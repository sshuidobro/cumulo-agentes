import { createLogger } from '@suite/shared';
import { DEFAULT_MAX_MATCHES_PER_PAGE, findInPage, type SearchMatch } from './find';
import { normalizeQuery, normalizeText, type SearchOptions } from './normalize';
import { buildPageText, type PageText, type TextItemLike } from './page-text';

const log = createLogger('search');

/** Fuente abstracta de texto por página (en la app, pdf.js vía `engine/search-source.ts`). `core/` no importa pdf.js. */
export interface PageTextSource {
  getPageItems(pageIndex: number, signal: AbortSignal): Promise<readonly TextItemLike[]>;
}

export interface SearchProgress {
  readonly pagesSearched: number;
  readonly totalPages: number;
  readonly matchCount: number;
  readonly truncated: boolean;
}

export interface SearchCallbacks {
  /** Solo páginas con al menos una coincidencia, en orden de recorrido. */
  onPageMatches(pageIndex: number, matches: readonly SearchMatch[]): void;
  /** Como mucho una vez cada 100 ms. */
  onProgress(p: SearchProgress): void;
  onDone(p: SearchProgress & { readonly cancelled: boolean }): void;
}

const DEFAULT_CACHE_PAGES = 20_000;

/** Caché de texto por página (FIFO: al superar el máximo borra la entrada más antigua). */
export class PageTextCache {
  readonly #maxPages: number;
  readonly #pages = new Map<number, PageText>();

  constructor(maxPages: number = DEFAULT_CACHE_PAGES) {
    this.#maxPages = maxPages;
  }

  get(i: number): PageText | undefined {
    return this.#pages.get(i);
  }

  set(i: number, pt: PageText): void {
    this.#pages.delete(i);
    this.#pages.set(i, pt);
    while (this.#pages.size > this.#maxPages) {
      const oldest = this.#pages.keys().next().value;
      if (oldest === undefined) break;
      this.#pages.delete(oldest);
    }
  }

  get size(): number {
    return this.#pages.size;
  }
}

/** Tope de coincidencias de una sesión; al alcanzarlo la búsqueda termina con `truncated: true`. */
export const MAX_TOTAL_MATCHES = 100_000;

const DEFAULT_TIME_SLICE_MS = 8;
const DEFAULT_CONCURRENCY = 4;
const PROGRESS_INTERVAL_MS = 100;

/**
 * Recorre todas las páginas empezando por `startPage`, con lecturas en paralelo pero procesadas en orden.
 * Cede el hilo cada `timeSliceMs` de trabajo, emite progreso con cadencia limitada y se puede cancelar.
 */
export class SearchSession {
  readonly #numPages: number;
  readonly #source: PageTextSource;
  readonly #options: SearchOptions;
  readonly #startPage: number;
  readonly #callbacks: SearchCallbacks;
  readonly #timeSliceMs: number;
  readonly #concurrency: number;
  readonly #cache: PageTextCache;
  readonly #now: () => number;
  readonly #controller = new AbortController();

  #started = false;
  #finished = false;
  #pagesSearched = 0;
  #matchCount = 0;
  #truncated = false;
  #lastProgressAt = Number.NEGATIVE_INFINITY;

  constructor(
    numPages: number,
    source: PageTextSource,
    options: SearchOptions,
    startPage: number,
    callbacks: SearchCallbacks,
    opts: {
      readonly timeSliceMs?: number;
      readonly concurrency?: number;
      readonly cache?: PageTextCache;
      readonly now?: () => number;
    } = {},
  ) {
    this.#numPages = numPages;
    this.#source = source;
    this.#options = options;
    this.#startPage = startPage;
    this.#callbacks = callbacks;
    this.#timeSliceMs = opts.timeSliceMs ?? DEFAULT_TIME_SLICE_MS;
    this.#concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    this.#cache = opts.cache ?? new PageTextCache();
    this.#now = opts.now ?? (() => performance.now());
  }

  /** Inicia la búsqueda en segundo plano. No lanza: los errores de página se registran y se cuentan como buscadas. */
  start(): void {
    if (this.#started || this.#finished) return;
    this.#started = true;

    const query = normalizeQuery(this.#options.query, this.#options);
    if (query.length === 0 || this.#numPages === 0) {
      this.#finish(false);
      return;
    }

    this.#run(query).catch((error: unknown) => {
      log.error('la búsqueda se ha interrumpido por un error inesperado', error);
      this.#finish(false);
    });
  }

  /** Aborta las lecturas en curso. `onDone({ cancelled: true })` se llama una sola vez. */
  cancel(): void {
    if (this.#finished) return;
    this.#controller.abort();
    this.#finish(true);
  }

  async #run(query: string): Promise<void> {
    const order = this.#pageOrder();
    const inflight: Array<Promise<PageText | undefined>> = [];
    let nextToLaunch = 0;
    const launch = (): void => {
      while (inflight.length < this.#concurrency && nextToLaunch < order.length) {
        const pageIndex = order[nextToLaunch] ?? 0;
        nextToLaunch += 1;
        inflight.push(this.#read(pageIndex));
      }
    };

    let sliceStart = this.#now();
    launch();
    for (const pageIndex of order) {
      const read = inflight.shift();
      if (read === undefined) break;
      launch();

      const pt = await read;
      if (this.#finished) return;

      const remaining = MAX_TOTAL_MATCHES - this.#matchCount;
      if (pt !== undefined) {
        const matches = findInPage(
          pageIndex,
          pt,
          normalizeText(pt.raw, this.#options),
          query,
          this.#options.wholeWord,
          Math.min(DEFAULT_MAX_MATCHES_PER_PAGE, remaining),
        );
        if (matches.length > 0) {
          this.#matchCount += matches.length;
          this.#callbacks.onPageMatches(pageIndex, matches);
          if (this.#finished) return;
        }
      }
      this.#pagesSearched += 1;

      if (this.#matchCount >= MAX_TOTAL_MATCHES) {
        this.#truncated = true;
        this.#finish(false);
        return;
      }
      this.#maybeReportProgress();
      if (this.#finished) return;

      if (this.#now() - sliceStart >= this.#timeSliceMs) {
        await yieldToEventLoop();
        if (this.#finished) return;
        sliceStart = this.#now();
      }
    }

    this.#finish(false);
  }

  /** Texto de una página (caché o fuente). `undefined` si la página no se pudo leer. */
  async #read(pageIndex: number): Promise<PageText | undefined> {
    const cached = this.#cache.get(pageIndex);
    if (cached !== undefined) return cached;
    try {
      const items = await this.#source.getPageItems(pageIndex, this.#controller.signal);
      const pt = buildPageText(items);
      this.#cache.set(pageIndex, pt);
      return pt;
    } catch (error: unknown) {
      if (!this.#controller.signal.aborted) {
        log.warn(`no se ha podido leer el texto de la página ${String(pageIndex + 1)}; se omite`, error);
      }
      return undefined;
    }
  }

  /** Páginas en orden: desde `startPage` hasta el final y luego desde el principio. */
  #pageOrder(): number[] {
    const start = Math.min(Math.max(0, Math.trunc(this.#startPage)), this.#numPages - 1);
    const order: number[] = [];
    for (let i = start; i < this.#numPages; i++) order.push(i);
    for (let i = 0; i < start; i++) order.push(i);
    return order;
  }

  #maybeReportProgress(): void {
    const now = this.#now();
    if (now - this.#lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.#lastProgressAt = now;
    this.#callbacks.onProgress(this.#snapshot());
  }

  #snapshot(): SearchProgress {
    return {
      pagesSearched: this.#pagesSearched,
      totalPages: this.#numPages,
      matchCount: this.#matchCount,
      truncated: this.#truncated,
    };
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
