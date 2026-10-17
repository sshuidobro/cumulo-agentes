import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureLogging, type LogLevel, type LogSink } from '@suite/shared';
import type { SearchMatch } from '../../src/core/search/find';
import {
  MAX_TOTAL_MATCHES,
  PageTextCache,
  SearchSession,
  type PageTextSource,
  type SearchCallbacks,
  type SearchProgress,
} from '../../src/core/search/session';
import type { SearchOptions } from '../../src/core/search/normalize';
import type { TextItemLike } from '../../src/core/search/page-text';

const OPTIONS: SearchOptions = { query: 'aguja', matchCase: false, wholeWord: false, matchDiacritics: false };

/** Fuente falsa: cada página tiene una «aguja» salvo las indicadas. Registra las lecturas. */
function fakeSource(pages: number, opts: { readonly withoutNeedle?: ReadonlySet<number>; readonly failing?: ReadonlySet<number> } = {}) {
  const reads: number[] = [];
  const source: PageTextSource = {
    getPageItems(pageIndex: number): Promise<readonly TextItemLike[]> {
      reads.push(pageIndex);
      if (opts.failing?.has(pageIndex)) return Promise.reject(new Error(`página ${String(pageIndex)} rota`));
      const text = opts.withoutNeedle?.has(pageIndex) ? `página ${String(pageIndex)}` : `página ${String(pageIndex)} con Aguja`;
      if (pageIndex >= pages) return Promise.resolve([]);
      return Promise.resolve([{ str: text, hasEOL: false }]);
    },
  };
  return { source, reads };
}

/** Callbacks que registran todo y una promesa que se resuelve al terminar. */
function recorder() {
  const pageOrder: number[] = [];
  const progress: SearchProgress[] = [];
  const matches = new Map<number, readonly SearchMatch[]>();
  const done: Array<SearchProgress & { readonly cancelled: boolean }> = [];
  let resolveDone: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { resolveDone = resolve; });
  const callbacks: SearchCallbacks = {
    onPageMatches(pageIndex, found) {
      pageOrder.push(pageIndex);
      matches.set(pageIndex, found);
    },
    onProgress(p) {
      progress.push(p);
    },
    onDone(p) {
      done.push(p);
      resolveDone();
    },
  };
  return { callbacks, pageOrder, progress, matches, done, finished };
}

/** Deja correr las tareas pendientes del bucle de eventos (cesiones con setTimeout). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('SearchSession', () => {
  let logged: Array<{ readonly level: LogLevel; readonly scope: string; readonly message: string }>;
  const sink: LogSink = (level, scope, message) => { logged.push({ level, scope, message }); };

  beforeEach(() => {
    logged = [];
    configureLogging({ sink, minLevel: 'debug' });
  });

  afterEach(() => {
    configureLogging({ sink: null });
  });

  it('recorre las páginas desde startPage hasta el final y luego desde el principio', async () => {
    const { source } = fakeSource(10);
    const rec = recorder();
    const session = new SearchSession(10, source, OPTIONS, 7, rec.callbacks, { timeSliceMs: 0, now: () => 0 });
    session.start();
    await rec.finished;
    expect(rec.pageOrder).toEqual([7, 8, 9, 0, 1, 2, 3, 4, 5, 6]);
    expect(rec.done).toEqual([{ pagesSearched: 10, totalPages: 10, matchCount: 10, truncated: false, cancelled: false }]);
  });

  it('cancelar a mitad llama a onDone con cancelled una sola vez y no vuelve a llamar nada', async () => {
    const { source } = fakeSource(10);
    const rec = recorder();
    // Los callbacks se ejecutan después de construir la sesión, así que pueden cancelarla.
    const callbacks: SearchCallbacks = {
      onPageMatches(pageIndex, found) {
        rec.callbacks.onPageMatches(pageIndex, found);
        if (pageIndex === 8) session.cancel();
      },
      onProgress: rec.callbacks.onProgress,
      onDone(p) {
        rec.callbacks.onDone(p);
      },
    };
    const session = new SearchSession(10, source, OPTIONS, 7, callbacks, { timeSliceMs: 0, now: () => 0 });
    session.start();
    await settle();
    expect(rec.pageOrder).toEqual([7, 8]);
    expect(rec.done).toHaveLength(1);
    // La página 8 se cancela dentro de su callback, antes de contarla como buscada.
    expect(rec.done[0]).toMatchObject({ cancelled: true, pagesSearched: 1 });
    session.cancel();
    await settle();
    expect(rec.done).toHaveLength(1);
    expect(rec.pageOrder).toEqual([7, 8]);
  });

  it('cancelar desde onProgress tampoco deja llamadas posteriores', async () => {
    const { source } = fakeSource(5);
    const rec = recorder();
    const session: SearchSession = new SearchSession(5, source, OPTIONS, 0, {
      ...rec.callbacks,
      onProgress(p) {
        rec.callbacks.onProgress(p);
        session.cancel();
      },
    }, { timeSliceMs: 0, now: () => 0 });
    session.start();
    await settle();
    expect(rec.done).toEqual([expect.objectContaining({ cancelled: true })]);
    expect(rec.pageOrder).toEqual([0]);
  });

  it('una consulta solo de espacios termina al instante con 0 y no lee páginas', () => {
    const { source, reads } = fakeSource(10);
    const rec = recorder();
    const session = new SearchSession(10, source, { ...OPTIONS, query: '   ' }, 0, rec.callbacks, { now: () => 0 });
    session.start();
    expect(rec.done).toEqual([{ pagesSearched: 0, totalPages: 10, matchCount: 0, truncated: false, cancelled: false }]);
    expect(reads).toEqual([]);
  });

  it('una página que rechaza no detiene la búsqueda y se registra', async () => {
    const { source } = fakeSource(5, { failing: new Set([2]) });
    const rec = recorder();
    new SearchSession(5, source, OPTIONS, 0, rec.callbacks, { timeSliceMs: 0, now: () => 0 }).start();
    await rec.finished;
    expect(rec.pageOrder).toEqual([0, 1, 3, 4]);
    expect(rec.done[0]).toMatchObject({ pagesSearched: 5, matchCount: 4, cancelled: false });
    expect(logged.some((entry) => entry.level === 'warn' && entry.scope === 'search')).toBe(true);
  });

  it('solo avisa de las páginas con coincidencias', async () => {
    const { source } = fakeSource(4, { withoutNeedle: new Set([1, 2]) });
    const rec = recorder();
    new SearchSession(4, source, OPTIONS, 0, rec.callbacks, { timeSliceMs: 0, now: () => 0 }).start();
    await rec.finished;
    expect(rec.pageOrder).toEqual([0, 3]);
    expect(rec.matches.get(3)?.[0]?.pageIndex).toBe(3);
  });

  it('termina con truncated al llegar al tope de coincidencias', async () => {
    const pages = 12;
    const dense: PageTextSource = {
      getPageItems: () => Promise.resolve([{ str: 'x '.repeat(10_000), hasEOL: false }]),
    };
    const rec = recorder();
    new SearchSession(pages, dense, { ...OPTIONS, query: 'x' }, 0, rec.callbacks, { timeSliceMs: 0, now: () => 0 }).start();
    await rec.finished;
    expect(rec.done[0]).toMatchObject({ matchCount: MAX_TOTAL_MATCHES, truncated: true, cancelled: false, pagesSearched: 10 });
  });

  it('el progreso se emite como mucho una vez cada 100 ms del reloj inyectado', async () => {
    const { source } = fakeSource(30);
    const rec = recorder();
    let clock = 0;
    const emittedAt: number[] = [];
    const callbacks: SearchCallbacks = {
      ...rec.callbacks,
      onProgress(p) {
        emittedAt.push(clock);
        rec.callbacks.onProgress(p);
      },
    };
    // Cada lectura del reloj avanza 15 ms: en 30 páginas pasan varios cientos de ms simulados.
    new SearchSession(30, source, OPTIONS, 0, callbacks, {
      timeSliceMs: 1_000_000,
      now: () => {
        clock += 15;
        return clock;
      },
    }).start();
    await rec.finished;
    expect(emittedAt.length).toBeGreaterThan(1);
    for (let i = 1; i < emittedAt.length; i++) {
      expect((emittedAt[i] ?? 0) - (emittedAt[i - 1] ?? 0)).toBeGreaterThanOrEqual(100);
    }
    expect(rec.done[0]?.pagesSearched).toBe(30);
  });

  it('cede el hilo cuando lleva timeSliceMs trabajando', async () => {
    const { source } = fakeSource(3);
    const rec = recorder();
    let clock = 0;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      new SearchSession(3, source, OPTIONS, 0, rec.callbacks, {
        timeSliceMs: 8,
        now: () => {
          clock += 5;
          return clock;
        },
      }).start();
      await rec.finished;
      expect(timeoutSpy).toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
    }
    expect(rec.done[0]).toMatchObject({ pagesSearched: 3, cancelled: false });
    expect(rec.pageOrder).toEqual([0, 1, 2]);
  });

  it('con un número de páginas 0 o una consulta sin texto termina sin leer', () => {
    const { source, reads } = fakeSource(0);
    const rec = recorder();
    new SearchSession(0, source, OPTIONS, 0, rec.callbacks, { now: () => 0 }).start();
    expect(rec.done).toEqual([{ pagesSearched: 0, totalPages: 0, matchCount: 0, truncated: false, cancelled: false }]);
    expect(reads).toEqual([]);
  });

  it('start y cancel son idempotentes y cancelar antes de empezar impide la búsqueda', () => {
    const { source, reads } = fakeSource(3);
    const rec = recorder();
    const session = new SearchSession(3, source, OPTIONS, 0, rec.callbacks, { now: () => 0 });
    session.cancel();
    session.cancel();
    session.start();
    expect(rec.done).toEqual([expect.objectContaining({ cancelled: true, pagesSearched: 0 })]);
    expect(reads).toEqual([]);
  });

  it('start dos veces no duplica la búsqueda', async () => {
    const { source, reads } = fakeSource(3);
    const rec = recorder();
    const session = new SearchSession(3, source, OPTIONS, 0, rec.callbacks, { timeSliceMs: 0, now: () => 0 });
    session.start();
    session.start();
    await rec.finished;
    expect(reads).toEqual([0, 1, 2]);
    expect(rec.done).toHaveLength(1);
  });

  it('con caché compartida, una segunda sesión no vuelve a leer las páginas', async () => {
    const { source, reads } = fakeSource(5);
    const cache = new PageTextCache();
    const first = recorder();
    new SearchSession(5, source, OPTIONS, 0, first.callbacks, { timeSliceMs: 0, now: () => 0, cache }).start();
    await first.finished;
    expect(reads).toHaveLength(5);
    expect(cache.size).toBe(5);

    const second = recorder();
    new SearchSession(5, source, OPTIONS, 2, second.callbacks, { timeSliceMs: 0, now: () => 0, cache }).start();
    await second.finished;
    expect(reads).toHaveLength(5);
    expect(second.pageOrder).toEqual([2, 3, 4, 0, 1]);
  });

  it('lee con concurrencia pero procesa en orden aunque las lecturas terminen desordenadas', async () => {
    const delays = [30, 0, 20, 5, 1];
    const source: PageTextSource = {
      getPageItems(pageIndex: number): Promise<readonly TextItemLike[]> {
        return new Promise((resolve) => {
          setTimeout(() => { resolve([{ str: 'aguja', hasEOL: false }]); }, delays[pageIndex] ?? 0);
        });
      },
    };
    const rec = recorder();
    new SearchSession(5, source, OPTIONS, 0, rec.callbacks, { timeSliceMs: 0, concurrency: 4, now: () => 0 }).start();
    await rec.finished;
    expect(rec.pageOrder).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('PageTextCache', () => {
  it('borra la entrada más antigua al superar el máximo', () => {
    const cache = new PageTextCache(2);
    const pt = { raw: '', itemStarts: new Int32Array([0]) };
    cache.set(0, pt);
    cache.set(1, pt);
    cache.set(2, pt);
    expect(cache.size).toBe(2);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(1)).toBe(pt);
    expect(cache.get(2)).toBe(pt);
  });

  it('volver a guardar una página la mueve al final y no duplica', () => {
    const cache = new PageTextCache(2);
    const pt = { raw: '', itemStarts: new Int32Array([0]) };
    cache.set(0, pt);
    cache.set(1, pt);
    cache.set(0, pt);
    cache.set(2, pt);
    expect(cache.size).toBe(2);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(0)).toBe(pt);
  });

  it('usa 20 000 páginas por defecto', () => {
    const cache = new PageTextCache();
    const pt = { raw: '', itemStarts: new Int32Array([0]) };
    for (let i = 0; i < 20_001; i++) cache.set(i, pt);
    expect(cache.size).toBe(20_000);
    expect(cache.get(0)).toBeUndefined();
  });
});

describe('sesión con temporizadores falsos', () => {
  it('termina al avanzar los temporizadores falsos', async () => {
    vi.useFakeTimers();
    try {
      const { source } = fakeSource(2);
      const rec = recorder();
      new SearchSession(2, source, OPTIONS, 0, rec.callbacks, { timeSliceMs: 0, now: () => 0 }).start();
      await vi.runAllTimersAsync();
      expect(rec.done).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
