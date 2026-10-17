import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource, type ByteSource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { readXref, type XrefInfo } from '../../src/core/pdf/xref';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// `measureBest` es síncrono; readXref es asíncrono, así que aquí se mide el mismo criterio (1 calentamiento, mejor de 5).

async function bestOfAsync(source: ByteSource, warmup: number, runs: number): Promise<{ readonly value: XrefInfo; readonly ms: number }> {
  for (let w = 0; w < warmup; w++) await readXref(source);
  let best = Number.POSITIVE_INFINITY;
  let last: XrefInfo | null = null;
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    last = await readXref(source);
    best = Math.min(best, performance.now() - start);
  }
  if (last === null) throw new RangeError('bestOfAsync: se requiere runs >= 1');
  return { value: last, ms: best };
}

describe('rendimiento de readXref', () => {
  it('lee la xref de pages-100000.pdf (100 000 páginas) en menos de 1 s (mejor de 5)', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-100000.pdf')));
    const { value, ms } = await bestOfAsync(memorySource(data), 1, 5);
    expect(value.entries.size).toBe(203232);
    expect(ms).toBeLessThan(1000);
  });
});
