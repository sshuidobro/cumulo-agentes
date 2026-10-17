import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Las operaciones son asíncronas, así que se mide con el mismo criterio que `measureBest`: 1 calentamiento, mejor de N.

async function bestOf<T>(runs: number, warmup: number, fn: () => Promise<T>): Promise<{ readonly value: T; readonly ms: number }> {
  for (let w = 0; w < warmup; w++) await fn();
  let best = Number.POSITIVE_INFINITY;
  let last: T | null = null;
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    last = await fn();
    best = Math.min(best, performance.now() - start);
  }
  if (last === null) throw new RangeError('bestOf: se requiere runs >= 1');
  return { value: last, ms: best };
}

describe('rendimiento de ObjectReader', () => {
  it('abrir + pageRef(99998) + getDict en pages-100000.pdf tarda menos de 1,5 s (mejor de 5)', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-100000.pdf')));
    const { value, ms } = await bestOf(5, 1, async () => {
      const reader = await ObjectReader.open(memorySource(data));
      return reader.getDict(await reader.pageRef(99998));
    });
    expect(value?.entries.get('Type')).toEqual({ kind: 'name', value: 'Page' });
    expect(ms).toBeLessThan(1500);
  });

  it('pageRefs() de pages-5000.pdf tarda menos de 1 s (mejor de 5)', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-5000.pdf')));
    const { value, ms } = await bestOf(5, 1, async () => {
      const reader = await ObjectReader.open(memorySource(data));
      return reader.pageRefs();
    });
    expect(value).toHaveLength(5000);
    expect(ms).toBeLessThan(1000);
  });
});
