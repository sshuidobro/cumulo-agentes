import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeChange, comparePageWords, CompareSession, MAX_EDITS_PER_PAGE, type CompareCallbacks, type CompareProgress, type PageComparison } from '../../../src/core/compare/compare';
import { pageWords, type Word } from '../../../src/core/compare/words';
import type { PageTextSource } from '../../../src/core/search/session';
import { loadPdf, type LoadedPdf } from '../../../src/engine/load';
import { createPageTextSource } from '../../../src/engine/search-source';
import { fixtureSource, nodeAssetBase } from '../../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();

/** Fuente falsa: cada página es una lista de líneas; cada línea es un ítem con fin de línea. */
function fakeSource(pages: readonly (readonly string[])[]): PageTextSource {
  return {
    async getPageItems(pageIndex) {
      const lines = pages[pageIndex];
      if (lines === undefined) throw new Error(`sin página ${String(pageIndex)}`);
      return lines.map((str) => ({ str, hasEOL: true }));
    },
  };
}

function wordsOf(text: string): Word[] {
  return [...pageWords([{ str: text, hasEOL: false }])];
}

interface Collected {
  readonly pages: PageComparison[];
  readonly progress: CompareProgress[];
  readonly done: (CompareProgress & { readonly cancelled: boolean }) | undefined;
  readonly doneCount: number;
}

/** Ejecuta una sesión con reloj fijo (sin cesiones ni cadencia de progreso) y espera a onDone. */
function runSession(
  a: { numPages: number; source: PageTextSource },
  b: { numPages: number; source: PageTextSource },
  opts: { timeSliceMs?: number; now?: () => number } = {},
): Promise<Collected> {
  return new Promise((resolve) => {
    const collected: { pages: PageComparison[]; progress: CompareProgress[]; done?: CompareProgress & { cancelled: boolean }; doneCount: number } = { pages: [], progress: [], doneCount: 0 };
    const callbacks: CompareCallbacks = {
      onPage: (r) => collected.pages.push(r),
      onProgress: (p) => collected.progress.push(p),
      onDone: (d) => {
        collected.doneCount += 1;
        collected.done = d;
        resolve({ ...collected, done: d });
      },
    };
    new CompareSession(a, b, callbacks, { now: () => 0, ...opts }).start();
  });
}

describe('comparePageWords', () => {
  it('páginas iguales dan same', () => {
    expect(comparePageWords(3, wordsOf('uno dos'), wordsOf('uno dos'))).toEqual({ kind: 'same', page: 3 });
    expect(comparePageWords(0, [], [])).toEqual({ kind: 'same', page: 0 });
  });

  it('una palabra cambiada es un replace con removed y added', () => {
    const r = comparePageWords(1, wordsOf('la página dos'), wordsOf('la hoja dos'));
    expect(r.kind).toBe('changed');
    if (r.kind !== 'changed') return;
    expect(r.page).toBe(1);
    expect(r.changes).toHaveLength(1);
    const change = r.changes[0];
    expect(change?.kind).toBe('replace');
    expect(change?.removed.map((w) => w.text)).toEqual(['página']);
    expect(change?.added.map((w) => w.text)).toEqual(['hoja']);
  });

  it('insert y delete puros', () => {
    const ins = comparePageWords(0, wordsOf('uno'), wordsOf('uno dos'));
    expect(ins).toMatchObject({ kind: 'changed', changes: [{ kind: 'insert', removed: [], added: [{ text: 'dos' }] }] });
    const del = comparePageWords(0, wordsOf('uno dos'), wordsOf('uno'));
    expect(del).toMatchObject({ kind: 'changed', changes: [{ kind: 'delete', removed: [{ text: 'dos' }], added: [] }] });
  });

  it('más de MAX_EDITS_PER_PAGE ediciones → too-different', () => {
    const a = Array.from({ length: MAX_EDITS_PER_PAGE + 1 }, (_, i) => `a${String(i)}`).join(' ');
    const b = Array.from({ length: MAX_EDITS_PER_PAGE + 1 }, (_, i) => `b${String(i)}`).join(' ');
    expect(comparePageWords(7, wordsOf(a), wordsOf(b))).toEqual({ kind: 'too-different', page: 7 });
  });
});

describe('describeChange', () => {
  const word = (text: string): Word => ({ text, start: { item: 0, offset: 0 }, end: { item: 0, offset: 0 } });

  it('replace, delete e insert con el texto de la ficha', () => {
    expect(describeChange({ kind: 'replace', removed: [word('página')], added: [word('hoja')] })).toBe('Se ha cambiado “página” por “hoja”.');
    expect(describeChange({ kind: 'delete', removed: [word('dos')], added: [] })).toBe('Se ha eliminado “dos”.');
    expect(describeChange({ kind: 'insert', removed: [], added: [word('uno'), word('dos')] })).toBe('Se ha añadido “uno dos”.');
  });

  it('recorta cada lado a 80 caracteres con «…»', () => {
    const long = 'x'.repeat(100);
    const text = describeChange({ kind: 'insert', removed: [], added: [word(long)] });
    const shown = text.slice('Se ha añadido “'.length, -'”.'.length);
    expect(Array.from(shown)).toHaveLength(80);
    expect(shown.endsWith('…')).toBe(true);
    const exact = 'y'.repeat(80);
    expect(describeChange({ kind: 'insert', removed: [], added: [word(exact)] })).toBe(`Se ha añadido “${exact}”.`);
  });
});

describe('CompareSession con fuentes falsas', () => {
  it('solo informa de las páginas que cambian, en orden, con progreso y onDone', async () => {
    const a = fakeSource([['uno'], ['dos tres'], ['cuatro'], ['cinco']]);
    const b = fakeSource([['uno'], ['dos cuatro'], ['cuatro'], ['cinco']]);
    const r = await runSession({ numPages: 4, source: a }, { numPages: 4, source: b });
    expect(r.pages.map((p) => p.page)).toEqual([1]);
    expect(r.pages[0]?.kind).toBe('changed');
    expect(r.done).toEqual({ pagesDone: 4, totalPages: 4, changedPages: 1, cancelled: false });
    expect(r.doneCount).toBe(1);
    expect(r.progress.length).toBeGreaterThan(0);
  });

  it('páginas de más en un lado → only-in-a / only-in-b; documento vacío → onDone inmediato', async () => {
    const a = fakeSource([['1'], ['2'], ['3']]);
    const b = fakeSource([['1']]);
    const r = await runSession({ numPages: 3, source: a }, { numPages: 1, source: b });
    expect(r.pages).toEqual([
      { kind: 'only-in-a', page: 1 },
      { kind: 'only-in-a', page: 2 },
    ]);
    expect(r.done).toEqual({ pagesDone: 3, totalPages: 3, changedPages: 2, cancelled: false });

    const s2 = fakeSource([['x']]);
    const r2 = await runSession({ numPages: 0, source: s2 }, { numPages: 0, source: s2 });
    expect(r2.pages).toEqual([]);
    expect(r2.done).toEqual({ pagesDone: 0, totalPages: 0, changedPages: 0, cancelled: false });
  });

  it('un fallo al leer una página se informa como too-different y se sigue', async () => {
    const good = fakeSource([['a'], ['b'], ['c']]);
    const broken: PageTextSource = {
      async getPageItems(pageIndex) {
        if (pageIndex === 1) throw new Error('ilegible');
        return good.getPageItems(pageIndex, new AbortController().signal);
      },
    };
    const r = await runSession({ numPages: 3, source: broken }, { numPages: 3, source: good });
    expect(r.pages).toEqual([{ kind: 'too-different', page: 1 }]);
    expect(r.done?.pagesDone).toBe(3);
  });

  it('cancel() a mitad: onDone con cancelled y no se leen más páginas', async () => {
    const reads: number[] = [];
    let session: CompareSession | undefined;
    const spy: PageTextSource = {
      async getPageItems(pageIndex) {
        reads.push(pageIndex);
        if (pageIndex === 2) session?.cancel();
        return [{ str: 'x', hasEOL: true }];
      },
    };
    const doneCalls: Array<CompareProgress & { cancelled: boolean }> = [];
    const done = new Promise<void>((resolve) => {
      session = new CompareSession(
        { numPages: 10, source: spy },
        { numPages: 10, source: spy },
        {
          onPage: () => undefined,
          onProgress: () => undefined,
          onDone: (d) => {
            doneCalls.push(d);
            resolve();
          },
        },
        { now: () => 0 },
      );
      session.start();
    });
    await done;
    session?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(doneCalls).toHaveLength(1);
    expect(doneCalls[0]?.cancelled).toBe(true);
    expect(Math.max(...reads)).toBe(2);
  });

  it('cede el hilo entre páginas cuando se agota el corte de tiempo', async () => {
    let clock = 0;
    const source = fakeSource([['a'], ['b'], ['c']]);
    const r = await runSession(
      { numPages: 3, source },
      { numPages: 3, source },
      { timeSliceMs: 1, now: () => (clock += 5) },
    );
    expect(r.done).toEqual({ pagesDone: 3, totalPages: 3, changedPages: 0, cancelled: false });
  });
});

describe('CompareSession con pdf.js (Node) sobre fixtures', () => {
  let basic: LoadedPdf;
  let changed: LoadedPdf;
  let outline: LoadedPdf;

  async function open(name: string): Promise<LoadedPdf> {
    const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
    if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
    return result.value;
  }

  beforeAll(async () => {
    basic = await open('basic-5.pdf');
    changed = await open('basic-5-changed.pdf');
    outline = await open('outline.pdf');
  }, 60_000);

  afterAll(async () => {
    await basic.destroy();
    await changed.destroy();
    await outline.destroy();
  });

  it('basic-5 frente a basic-5-changed: un único cambio «página» → «hoja» en la página 2', async () => {
    const a = { numPages: basic.doc.numPages, source: createPageTextSource(basic.doc) };
    const b = { numPages: changed.doc.numPages, source: createPageTextSource(changed.doc) };
    const r = await runSession(a, b, { now: () => performance.now() });

    expect(r.pages).toHaveLength(1);
    const first = r.pages[0];
    expect(first?.kind).toBe('changed');
    if (first?.kind !== 'changed') return;
    expect(first.page).toBe(1);
    expect(first.changes).toHaveLength(1);
    const change = first.changes[0];
    expect(change?.kind).toBe('replace');
    expect(change?.removed.map((w) => w.text)).toEqual(['página']);
    expect(change?.added.map((w) => w.text)).toEqual(['hoja']);
    expect(describeChange(change ?? { kind: 'insert', removed: [], added: [] })).toBe('Se ha cambiado “página” por “hoja”.');

    const items = await createPageTextSource(basic.doc).getPageItems(1, new AbortController().signal);
    const removed = change?.removed[0];
    expect(removed).toBeDefined();
    if (removed === undefined) return;
    expect(items[removed.start.item]?.str.slice(removed.start.offset, removed.end.offset)).toBe('página');
  });

  it('basic-5 frente a sí mismo: ningún onPage y changedPages 0', async () => {
    const source = createPageTextSource(basic.doc);
    const r = await runSession({ numPages: 5, source }, { numPages: 5, source }, { now: () => performance.now() });
    expect(r.pages).toEqual([]);
    expect(r.done).toEqual({ pagesDone: 5, totalPages: 5, changedPages: 0, cancelled: false });
  });

  it('basic-5 (5 p.) frente a outline.pdf: las páginas de más salen como only-in', async () => {
    const a = { numPages: basic.doc.numPages, source: createPageTextSource(basic.doc) };
    const b = { numPages: outline.doc.numPages, source: createPageTextSource(outline.doc) };
    const r = await runSession(a, b, { now: () => performance.now() });
    const shorter = Math.min(5, outline.doc.numPages);
    const longer = Math.max(5, outline.doc.numPages);
    const extra = r.pages.filter((p) => p.page >= shorter);
    expect(extra.map((p) => p.page)).toEqual(Array.from({ length: longer - shorter }, (_, i) => shorter + i));
    const onlyIn = outline.doc.numPages > 5 ? 'only-in-b' : 'only-in-a';
    for (const p of extra) {
      expect(p.kind).toBe(onlyIn);
    }
    expect(r.done?.totalPages).toBe(longer);
  });
});
