import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comparePageWords, CompareSession } from '../../src/core/compare/compare';
import { pageWords, type Word } from '../../src/core/compare/words';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import { createPageTextSource } from '../../src/engine/search-source';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Presupuestos de ADR-0031: recorrido completo de pages-5000.pdf < 30 s; cada página (cálculo, sin lectura) ≤ 30 ms.

const assetBaseUrl = nodeAssetBase();
const WORDS_PER_PAGE = 5000;
const CHANGES_PER_PAGE = 1500;

/** Dos textos de 5 000 palabras con 1 500 cambios (750 borrados y 750 inserciones, separados por palabras iguales). */
function twoPages(): { readonly a: readonly Word[]; readonly b: readonly Word[] } {
  const original = Array.from({ length: WORDS_PER_PAGE }, (_, i) => `palabra${String(i)}`);
  const edited: string[] = [];
  let changes = 0;
  original.forEach((word, i) => {
    if (i < 3 * CHANGES_PER_PAGE && i % 3 === 0) {
      changes += 1;
      if (changes % 2 === 1) {
        return; // borrado
      }
      edited.push(`nueva${String(i)}`, word); // inserción
      return;
    }
    edited.push(word);
  });
  if (changes !== CHANGES_PER_PAGE) throw new Error(`Se esperaban ${String(CHANGES_PER_PAGE)} cambios y hay ${String(changes)}`);
  return {
    a: pageWords([{ str: original.join(' '), hasEOL: false }]),
    b: pageWords([{ str: edited.join(' '), hasEOL: false }]),
  };
}

describe('rendimiento de la comparación', () => {
  it('una página con 5 000 palabras y 1 500 cambios se compara en ≤ 30 ms (cálculo)', () => {
    const { a, b } = twoPages();
    expect(a.length).toBe(WORDS_PER_PAGE);

    comparePageWords(0, a, b); // calentamiento
    let worst = 0;
    let result = comparePageWords(0, a, b);
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      result = comparePageWords(0, a, b);
      worst = Math.max(worst, performance.now() - start);
    }
    process.stdout.write(`[perf] comparar una página (5 000 palabras, 1 500 cambios): peor ${worst.toFixed(1)} ms\n`);

    expect(result.kind).toBe('changed');
    if (result.kind === 'changed') expect(result.changes).toHaveLength(CHANGES_PER_PAGE);
    expect(worst).toBeLessThanOrEqual(30);
  });

  describe('pages-5000.pdf frente a sí mismo con pdf.js en Node', () => {
    let loaded: LoadedPdf;

    beforeAll(async () => {
      const result = await loadPdf(fixtureSource('pages-5000.pdf'), { assetBaseUrl });
      if (!result.ok) throw new Error(`No se pudo abrir pages-5000.pdf: ${result.error.code}`);
      loaded = result.value;
    }, 60_000);

    afterAll(async () => {
      await loaded.destroy();
    });

    it('recorrido completo < 30 s y sin diferencias', async () => {
      const source = createPageTextSource(loaded.doc);
      const start = performance.now();
      const done = await new Promise<{ pagesDone: number; changedPages: number; cancelled: boolean }>((resolve) => {
        new CompareSession(
          { numPages: loaded.doc.numPages, source },
          { numPages: loaded.doc.numPages, source },
          {
            onPage: () => undefined,
            onProgress: () => undefined,
            onDone: resolve,
          },
        ).start();
      });
      const totalMs = performance.now() - start;
      process.stdout.write(`[perf] comparar pages-5000.pdf con sí mismo: total ${totalMs.toFixed(1)} ms\n`);

      expect(done).toEqual({ pagesDone: 5000, totalPages: 5000, changedPages: 0, cancelled: false });
      expect(totalMs).toBeLessThan(30_000);
    }, 120_000);
  });
});
