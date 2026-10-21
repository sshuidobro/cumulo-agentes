import { describe, expect, it } from 'vitest';
import { loadPdf } from '../../src/engine';
import { scanAnnotations } from '../../src/engine/annotations-import';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Medida única con performance.now(), sin calentamiento.

const assetBaseUrl = nodeAssetBase();

describe('rendimiento de scanAnnotations', () => {
  it('escanea pages-5000.pdf en menos de 10 s sin lotes de más de 100 ms', async () => {
    const result = await loadPdf(fixtureSource('pages-5000.pdf'), { assetBaseUrl });
    if (!result.ok) throw new Error(`No se pudo abrir pages-5000.pdf: ${result.error.code}`);
    const loaded = result.value;
    try {
      let batches = 0;
      let maxGap = 0;
      let previous = performance.now();
      const start = previous;
      const outcome = await scanAnnotations(loaded.doc, {
        batchSize: 50,
        fallbackDate: '2026-10-17T12:00:00.000Z',
        onBatch: () => {
          const now = performance.now();
          maxGap = Math.max(maxGap, now - previous);
          previous = now;
          batches += 1;
        },
      });
      const total = performance.now() - start;
      // Anotación para el Registro del Plan: tiempo total, máximo entre lotes y número de lotes.
      process.stdout.write(`[perf] scanAnnotations 5000 páginas: total ${total.toFixed(1)} ms, máximo ${maxGap.toFixed(1)} ms, lotes ${String(batches)}\n`);
      expect(outcome).toBe('done');
      expect(total).toBeLessThan(10_000);
      expect(maxGap).toBeLessThan(100);
    } finally {
      await loaded.destroy();
    }
  }, 60_000);
});
