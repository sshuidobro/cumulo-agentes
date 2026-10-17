import { describe, expect, it } from 'vitest';
import { memorySource, type ByteSource } from '@suite/platform';
import { loadPdf } from '../../src/engine/load';
import { scanPageDims, type PageDimsEntry } from '../../src/engine/page-dims';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('QA loadPdf · casos límite', () => {
  it('señal ya abortada antes de llamar devuelve cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl, signal: controller.signal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cancelled');
  }, 10_000);

  it('si falla ya la lectura de la cabecera devuelve io', async () => {
    const source: ByteSource = { size: 100, read: () => Promise.reject(new Error('x')) };
    const r = await loadPdf(source, { assetBaseUrl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('io');
  });

  it('solo "%PDF-" (5 bytes) no cuelga y devuelve corrupt', async () => {
    const r = await loadPdf(memorySource(bytes('%PDF-')), { assetBaseUrl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('corrupt');
  }, 10_000);

  it('un fichero de texto con emojis y RTL sin cabecera es not-pdf', async () => {
    const r = await loadPdf(memorySource(bytes('Hola ñandú 😀 مرحبا שלום'.repeat(100))), { assetBaseUrl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-pdf');
  });

  it('un PDF con basura antes de la cabecera (<1024 bytes) no lanza', async () => {
    const real = fixtureSource('basic-5.pdf');
    const data = await real.read(0, real.size);
    const junk = new Uint8Array(100 + data.length);
    junk.set(bytes('x'.repeat(100)), 0);
    junk.set(data, 100);
    const r = await loadPdf(memorySource(junk), { assetBaseUrl });
    if (r.ok) {
      expect(r.value.numPages).toBe(5);
      await r.value.destroy();
    } else {
      expect(r.error.code).toBe('corrupt');
    }
  }, 10_000);

  it('onProgress se invoca al abrir un PDF', async () => {
    const calls: number[] = [];
    const r = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl, onProgress: (l) => calls.push(l) });
    expect(r.ok).toBe(true);
    if (r.ok) await r.value.destroy();
    expect(calls.length).toBeGreaterThan(0);
  }, 10_000);

  it('cinco cargas concurrentes del mismo fichero funcionan', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl })));
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.numPages).toBe(5);
        await r.value.destroy();
      }
    }
  }, 30_000);

  it('onIoError avisa si la lectura falla tras abrir (leer páginas lejanas)', async () => {
    const inner = fixtureSource('pages-5000.pdf');
    let failing = false;
    const source: ByteSource = {
      size: inner.size,
      read: (b, e) => (failing ? Promise.reject(new Error('desconectado')) : inner.read(b, e)),
    };
    const r = await loadPdf(source, { assetBaseUrl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const errors: string[] = [];
    const off = r.value.onIoError((e) => errors.push(e.code));
    failing = true;
    const attempt = r.value.doc.getPage(4000).then(() => 'ok', () => 'rejected');
    const outcome = await Promise.race([attempt, new Promise<string>((res) => setTimeout(() => res('hang'), 3000))]);
    expect(errors).toContain('io');
    expect(['ok', 'rejected', 'hang']).toContain(outcome);
    off();
    await r.value.destroy();
  }, 15_000);
});

describe('QA scanPageDims · casos límite', () => {
  async function open(name: string) {
    const r = await loadPdf(fixtureSource(name), { assetBaseUrl });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }

  it('from posterior al total devuelve done sin lotes', async () => {
    const pdf = await open('sizes-mixed.pdf');
    const batches: PageDimsEntry[][] = [];
    expect(await scanPageDims(pdf.doc, { from: 99, onBatch: (b) => batches.push([...b]) })).toBe('done');
    expect(batches).toHaveLength(0);
    await pdf.destroy();
  }, 10_000);

  it('from=3 entrega solo las páginas 4..6 con índices correctos', async () => {
    const pdf = await open('sizes-mixed.pdf');
    const all: PageDimsEntry[] = [];
    await scanPageDims(pdf.doc, { from: 3, onBatch: (b) => all.push(...b) });
    expect(all.map((e) => e.index)).toEqual([3, 4, 5]);
    await pdf.destroy();
  }, 10_000);

  it('batchSize 0 no entra en bucle infinito y entrega todo', async () => {
    const pdf = await open('sizes-mixed.pdf');
    const all: PageDimsEntry[] = [];
    const r = await Promise.race([
      scanPageDims(pdf.doc, { batchSize: 0, onBatch: (b) => all.push(...b) }),
      new Promise<string>((res) => setTimeout(() => res('hang'), 5000)),
    ]);
    expect(r).toBe('done');
    expect(all).toHaveLength(6);
    await pdf.destroy();
  }, 10_000);

  it('señal ya abortada devuelve cancelled sin lotes', async () => {
    const pdf = await open('sizes-mixed.pdf');
    const c = new AbortController();
    c.abort();
    let calls = 0;
    expect(await scanPageDims(pdf.doc, { signal: c.signal, onBatch: () => { calls++; } })).toBe('cancelled');
    expect(calls).toBe(0);
    await pdf.destroy();
  }, 10_000);

  it('lote final parcial: 6 páginas con batchSize 4 -> 4 + 2', async () => {
    const pdf = await open('sizes-mixed.pdf');
    const sizes: number[] = [];
    await scanPageDims(pdf.doc, { batchSize: 4, onBatch: (b) => sizes.push(b.length) });
    expect(sizes).toEqual([4, 2]);
    await pdf.destroy();
  }, 10_000);
});
