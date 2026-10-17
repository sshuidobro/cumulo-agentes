import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import { createPageTextSource } from '../../src/engine/search-source';
import { buildPageText } from '../../src/core/search/page-text';
import { findInPage, type SearchMatch } from '../../src/core/search/find';
import { normalizeQuery, normalizeText, type NormalizeOptions } from '../../src/core/search/normalize';
import {
  PageTextCache,
  SearchSession,
  type PageTextSource,
  type SearchCallbacks,
  type SearchProgress,
} from '../../src/core/search/session';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();

async function openFixture(name: string): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
  if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
  return result.value;
}

/** Busca en todas las páginas de un documento real, como lo hace la sesión, y devuelve las coincidencias. */
async function searchAll(source: PageTextSource, numPages: number, query: string, opts: NormalizeOptions & { readonly wholeWord: boolean }): Promise<SearchMatch[]> {
  const controller = new AbortController();
  const found: SearchMatch[] = [];
  const normalizedQuery = normalizeQuery(query, opts);
  for (let i = 0; i < numPages; i++) {
    const pt = buildPageText(await source.getPageItems(i, controller.signal));
    found.push(...findInPage(i, pt, normalizeText(pt.raw, opts), normalizedQuery, opts.wholeWord));
  }
  return found;
}

describe('motor real: búsqueda en basic-5.pdf', () => {
  let loaded: LoadedPdf;
  let source: PageTextSource;

  beforeAll(async () => {
    loaded = await openFixture('basic-5.pdf');
    source = createPageTextSource(loaded.doc);
  });

  afterAll(async () => {
    await loaded.destroy();
  });

  it('«busqueda» sin tildes ni mayúsculas encuentra p2, p3, p4 (×2) y p5 (dentro de «rebusquedas»)', async () => {
    const found = await searchAll(source, 5, 'busqueda', { matchCase: false, matchDiacritics: false, wholeWord: false });
    expect(found.map((m) => m.pageIndex + 1)).toEqual([2, 3, 4, 4, 5]);
  });

  it('con palabra completa, p5 ya no aparece', async () => {
    const found = await searchAll(source, 5, 'busqueda', { matchCase: false, matchDiacritics: false, wholeWord: true });
    expect(found.map((m) => m.pageIndex + 1)).toEqual([2, 3, 4, 4]);
  });

  it('con mayúsculas y tildes, «búsqueda» solo aparece en p2 y p4', async () => {
    const found = await searchAll(source, 5, 'búsqueda', { matchCase: true, matchDiacritics: true, wholeWord: false });
    expect(new Set(found.map((m) => m.pageIndex + 1))).toEqual(new Set([2, 4]));
    expect(found.map((m) => m.pageIndex + 1)).toEqual([2, 4, 4]);
  });

  it('la coincidencia de «murciélago» en p1 cae en el ítem que contiene el texto', async () => {
    const items = await source.getPageItems(0, new AbortController().signal);
    const pt = buildPageText(items);
    const [match] = findInPage(0, pt, normalizeText(pt.raw, { matchCase: false, matchDiacritics: true }), 'murciélago', false);
    expect(match).toBeDefined();
    if (match === undefined) return;
    expect(match.start.item).toBe(match.end.item);
    expect(items[match.start.item]?.str.slice(match.start.offset, match.end.offset)).toBe('murciélago');
  });

  it('una sesión sobre el motor real entrega las páginas con coincidencias en orden desde startPage', async () => {
    const capture = captureCallbacks();
    const session = new SearchSession(5, source, { query: 'busqueda', matchCase: false, matchDiacritics: false, wholeWord: false }, 2, capture.callbacks, { now: () => 0, timeSliceMs: 0 });
    session.start();
    const done = await capture.finished();
    // p1 no contiene la palabra; las páginas se entregan en orden desde la 3 y siguen por la 1.
    expect(capture.pages.map((p) => p + 1)).toEqual([3, 4, 5, 2]);
    expect(done).toEqual({ pagesSearched: 5, totalPages: 5, matchCount: 5, truncated: false, cancelled: false });
  });
});

describe('motor real: búsqueda en pages-5000.pdf', () => {
  let loaded: LoadedPdf;

  beforeAll(async () => {
    loaded = await openFixture('pages-5000.pdf');
  }, 60_000);

  afterAll(async () => {
    await loaded.destroy();
  });

  it('«aguja» desde la página 0 encuentra exactamente las páginas 1233 y 4998 (0-based)', async () => {
    const capture = captureCallbacks();
    const session = new SearchSession(
      loaded.doc.numPages,
      createPageTextSource(loaded.doc),
      { query: 'aguja', matchCase: false, matchDiacritics: false, wholeWord: false },
      0,
      capture.callbacks,
      { now: () => 0, timeSliceMs: 1_000_000 },
    );
    session.start();
    const done = await capture.finished();
    expect(capture.pages).toEqual([1233, 4998]);
    expect(done).toEqual({ pagesSearched: 5000, totalPages: 5000, matchCount: 2, truncated: false, cancelled: false });
  }, 120_000);

  it('con PageTextCache, una segunda búsqueda no vuelve a llamar a getPageItems', async () => {
    const inner = createPageTextSource(loaded.doc);
    let calls = 0;
    const counting: PageTextSource = {
      getPageItems: (pageIndex, signal) => {
        calls += 1;
        return inner.getPageItems(pageIndex, signal);
      },
    };
    const cache = new PageTextCache();
    const options = { query: 'aguja', matchCase: false, matchDiacritics: false, wholeWord: false };

    const first = captureCallbacks();
    new SearchSession(loaded.doc.numPages, counting, options, 0, first.callbacks, { now: () => 0, timeSliceMs: 1_000_000, cache }).start();
    expect((await first.finished()).pagesSearched).toBe(5000);
    expect(calls).toBe(5000);

    const second = captureCallbacks();
    new SearchSession(loaded.doc.numPages, counting, options, 0, second.callbacks, { now: () => 0, timeSliceMs: 1_000_000, cache }).start();
    expect((await second.finished()).matchCount).toBe(2);
    expect(calls).toBe(5000);
    expect(second.pages).toEqual([1233, 4998]);
  }, 120_000);
});

/** Callbacks que guardan las páginas con coincidencias y resuelven `finished()` al terminar. */
function captureCallbacks() {
  const pages: number[] = [];
  let resolveDone: (p: SearchProgress & { readonly cancelled: boolean }) => void = () => undefined;
  const done = new Promise<SearchProgress & { readonly cancelled: boolean }>((resolve) => { resolveDone = resolve; });
  const callbacks: SearchCallbacks = {
    onPageMatches: (pageIndex) => { pages.push(pageIndex); },
    onProgress: () => undefined,
    onDone: (p) => { resolveDone(p); },
  };
  return { callbacks, pages, finished: () => done };
}
