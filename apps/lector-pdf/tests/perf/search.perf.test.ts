import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import { createPageTextSource } from '../../src/engine/search-source';
import { PageTextCache, SearchSession, type SearchCallbacks, type SearchProgress } from '../../src/core/search/session';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Presupuestos del Plan: recorrido completo de 5 000 páginas < 15 s (aquí 10 s), la UI responde durante la búsqueda.

const assetBaseUrl = nodeAssetBase();
const OPTIONS = { query: 'aguja', matchCase: false, matchDiacritics: false, wholeWord: false } as const;

interface Run {
  readonly pages: number[];
  readonly done: SearchProgress & { readonly cancelled: boolean };
  readonly firstMatchMs: number;
  readonly totalMs: number;
}

/** Lanza una búsqueda con el reloj real y espera a onDone. */
function runSearch(loaded: LoadedPdf, cache: PageTextCache | undefined): Promise<Run> {
  return new Promise((resolve) => {
    const pages: number[] = [];
    const start = performance.now();
    let firstMatchMs = -1;
    const callbacks: SearchCallbacks = {
      onPageMatches: (pageIndex) => {
        if (firstMatchMs < 0) firstMatchMs = performance.now() - start;
        pages.push(pageIndex);
      },
      onProgress: () => undefined,
      onDone: (done) => {
        resolve({ pages, done, firstMatchMs, totalMs: performance.now() - start });
      },
    };
    const session = new SearchSession(loaded.doc.numPages, createPageTextSource(loaded.doc), OPTIONS, 0, callbacks,
      cache === undefined ? { now: () => performance.now() } : { now: () => performance.now(), cache });
    session.start();
  });
}

describe('rendimiento de la búsqueda (pages-5000.pdf)', () => {
  let loaded: LoadedPdf;

  beforeAll(async () => {
    const result = await loadPdf(fixtureSource('pages-5000.pdf'), { assetBaseUrl });
    if (!result.ok) throw new Error(`No se pudo abrir pages-5000.pdf: ${result.error.code}`);
    loaded = result.value;
  }, 60_000);

  afterAll(async () => {
    await loaded.destroy();
  });

  it('recorrido completo < 10 s, sin bloqueos del hilo > 50 ms, primera coincidencia < 1 s', async () => {
    // Un temporizador de 1 ms mide los huecos del bucle de eventos: un bloqueo largo aparece como un hueco largo.
    let maxGap = 0;
    let previous = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - previous);
      previous = now;
    }, 1);
    let run: Run;
    try {
      run = await runSearch(loaded, undefined);
    } finally {
      clearInterval(ticker);
    }
    // Anotación para el Registro del Plan: tiempos medidos en esta máquina.
    process.stdout.write(`[perf] búsqueda 5000 páginas: total ${run.totalMs.toFixed(1)} ms, primera coincidencia ${run.firstMatchMs.toFixed(1)} ms, hueco máximo ${maxGap.toFixed(1)} ms\n`);
    expect(run.done).toEqual({ pagesSearched: 5000, totalPages: 5000, matchCount: 2, truncated: false, cancelled: false });
    expect(run.pages).toEqual([1233, 4998]);
    expect(run.totalMs).toBeLessThan(10_000);
    expect(run.firstMatchMs).toBeLessThan(1_000);
    expect(maxGap).toBeLessThan(50);
  }, 60_000);

  it('una segunda búsqueda con caché termina en < 1 s', async () => {
    const cache = new PageTextCache();
    await runSearch(loaded, cache);
    const run = await runSearch(loaded, cache);
    process.stdout.write(`[perf] búsqueda con caché 5000 páginas: total ${run.totalMs.toFixed(1)} ms\n`);
    expect(run.done.cancelled).toBe(false);
    expect(run.pages).toEqual([1233, 4998]);
    expect(run.totalMs).toBeLessThan(1_000);
  }, 60_000);
});
