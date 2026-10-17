import { describe, expect, it } from 'vitest';
import { loadPdf } from '../../src/engine/load';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Medida única con performance.now(), sin calentamiento: el presupuesto mide la apertura real.

const assetBaseUrl = nodeAssetBase();

async function timedOpen(name: string): Promise<{ readonly ms: number; readonly numPages: number }> {
  const start = performance.now();
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
  const ms = performance.now() - start;
  if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
  const numPages = result.value.numPages;
  await result.value.destroy();
  return { ms, numPages };
}

describe('rendimiento de carga por rangos', () => {
  it('abre pages-5000.pdf en menos de 3 s', async () => {
    const { ms, numPages } = await timedOpen('pages-5000.pdf');
    expect(numPages).toBe(5000);
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  it('abre pages-100000.pdf en menos de 3 s', async () => {
    const { ms, numPages } = await timedOpen('pages-100000.pdf');
    expect(numPages).toBe(100000);
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  it('abre pages-20000-flat.pdf (árbol plano) en menos de 5 s', async () => {
    const { ms, numPages } = await timedOpen('pages-20000-flat.pdf');
    expect(numPages).toBe(20000);
    expect(ms).toBeLessThan(5000);
  }, 30_000);
});
