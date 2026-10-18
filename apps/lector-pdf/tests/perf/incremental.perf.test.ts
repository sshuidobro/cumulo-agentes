import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { diffAnnotations, type Annotation } from '../../src/core/annotations';
import { buildIncrementalUpdate } from '../../src/core/pdf/incremental';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../fixtures/paths';
import { newAnnotation } from '../unit/annotations/factories';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que `bestOf` de object-reader.perf.test.ts: 1 calentamiento, mejor de N.

const NOW = '2026-10-18T09:30:00.000Z';

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

function tenAdditions(pages: readonly number[]): readonly Annotation[] {
  return pages.map((p, i) => newAnnotation(`suite-${i}`, 'highlight', p));
}

function diffOfAdditions(additions: readonly Annotation[]) {
  return diffAnnotations(new Map(), { upserts: new Map(additions.map((a) => [a.id, a] as const)), removed: new Set(), fields: new Map() });
}

describe('rendimiento del escritor incremental', () => {
  it('pages-5000.pdf + 10 anotaciones: buildIncrementalUpdate tarda menos de 1 s (mejor de 5)', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-5000.pdf')));
    const diff = diffOfAdditions(tenAdditions([0, 499, 1000, 1999, 2500, 3000, 3500, 4000, 4500, 4999]));
    const { value, ms } = await bestOf(5, 1, async () => {
      const source = memorySource(data);
      const reader = await ObjectReader.open(source);
      return buildIncrementalUpdate({ source, reader, diff, now: NOW });
    });
    expect(value.ok).toBe(true);
    expect(ms).toBeLessThan(1000);
  });

  it('pages-100000.pdf (página 99 999): ObjectReader.open + buildIncrementalUpdate tardan menos de 3 s (mejor de 5)', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-100000.pdf')));
    const diff = diffOfAdditions(tenAdditions([99999]));
    const { value, ms } = await bestOf(5, 1, async () => {
      const source = memorySource(data);
      const reader = await ObjectReader.open(source);
      return buildIncrementalUpdate({ source, reader, diff, now: NOW });
    });
    expect(value.ok).toBe(true);
    expect(ms).toBeLessThan(3000);
  });
});
