import { describe, expect, it } from 'vitest';
import { loadPdf, scanPageDims, type LoadedPdf, type PageDimsEntry } from '../../src/engine';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const SCAN_TIMEOUT = 60_000;

async function openFixture(name: string): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
  if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
  return result.value;
}

function asTuples(entries: readonly PageDimsEntry[]): string[] {
  return entries.map((e) => `(${String(e.width)},${String(e.height)},${String(e.rotation)})`);
}

describe('scanPageDims', () => {
  it('entrega las dimensiones reales de sizes-mixed.pdf, incluida la página rotada', async () => {
    const loaded = await openFixture('sizes-mixed.pdf');
    try {
      const batches: PageDimsEntry[][] = [];
      const outcome = await scanPageDims(loaded.doc, { onBatch: (entries) => { batches.push([...entries]); } });
      expect(outcome).toBe('done');
      const all = batches.flat();
      expect(all).toHaveLength(6);
      expect(asTuples(all)).toEqual([
        '(595,842,0)', '(792,612,0)', '(842,1191,0)', '(420,595,0)', '(595,842,90)', '(595,842,0)',
      ]);
      expect(all.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    } finally {
      await loaded.destroy();
    }
  }, SCAN_TIMEOUT);

  it('con batchSize 2 hace 3 llamadas a onBatch para 6 páginas', async () => {
    const loaded = await openFixture('sizes-mixed.pdf');
    try {
      const calls: number[] = [];
      await scanPageDims(loaded.doc, { batchSize: 2, onBatch: (entries) => { calls.push(entries.length); } });
      expect(calls).toEqual([2, 2, 2]);
    } finally {
      await loaded.destroy();
    }
  }, SCAN_TIMEOUT);

  it('cancelado tras el primer lote devuelve cancelled y no entrega más lotes', async () => {
    const loaded = await openFixture('sizes-mixed.pdf');
    try {
      const controller = new AbortController();
      let calls = 0;
      const outcome = await scanPageDims(loaded.doc, {
        batchSize: 2,
        signal: controller.signal,
        onBatch: () => {
          calls += 1;
          controller.abort();
        },
      });
      expect(outcome).toBe('cancelled');
      expect(calls).toBe(1);
    } finally {
      await loaded.destroy();
    }
  }, SCAN_TIMEOUT);

  it('recorre pages-5000.pdf completo, en orden y en lotes de batchSize', async () => {
    const loaded = await openFixture('pages-5000.pdf');
    try {
      const sizes: number[] = [];
      const indexes: number[] = [];
      const outcome = await scanPageDims(loaded.doc, {
        batchSize: 1000,
        onBatch: (entries) => {
          sizes.push(entries.length);
          for (const e of entries) indexes.push(e.index);
        },
      });
      expect(outcome).toBe('done');
      expect(sizes).toEqual([1000, 1000, 1000, 1000, 1000]);
      expect(indexes).toHaveLength(5000);
      expect(indexes.every((index, position) => index === position)).toBe(true);
    } finally {
      await loaded.destroy();
    }
  }, SCAN_TIMEOUT);
});
