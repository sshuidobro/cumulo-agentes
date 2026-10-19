import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { buildNewDocument, type NewDocumentPart } from '../../src/core/pdf/new-document';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import type { PageSlot } from '../../src/core/pdf/page-tree';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que `bestOf` de page-tree.perf.test.ts: 1 calentamiento, mejor de 3. Cada pasada abre el lector
// y crea el PDF completo (`ObjectReader.open` + `buildNewDocument`).

const NOW = '2026-10-19T10:00:00.000Z';
/** Cada caso hace 4 pasadas (calentamiento + 3) de hasta 100 000 páginas. */
const FILE_TIMEOUT = 600_000;

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

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Las primeras `count` páginas del fixture, en orden y con giro 0. */
function firstPages(count: number): PageSlot[] {
  return Array.from({ length: count }, (_, source) => ({ source, rotate: 0 }));
}

async function createTime(file: string, count: number) {
  const data = fixtureBytes(file);
  return bestOf(3, 1, async () => {
    const reader = await ObjectReader.open(memorySource(data), {});
    const part: NewDocumentPart = { reader, pages: firstPages(count) };
    const result = await buildNewDocument({ parts: [part], now: NOW });
    if (!result.ok) throw new Error(`buildNewDocument falló: ${result.error.code}`);
    return result.value;
  });
}

describe('rendimiento de la creación de PDF nuevos (PDF-121)', () => {
  it('1 000 páginas de pages-5000.pdf tardan menos de 2 s (mejor de 3)', async () => {
    const { value, ms } = await createTime('pages-5000.pdf', 1000);
    expect(value.pageCount).toBe(1000);
    expect(ms, 'pages-5000 extraer 1 000 páginas').toBeLessThan(2000);
  }, FILE_TIMEOUT);

  it('las 100 000 páginas de pages-100000.pdf tardan menos de 20 s (mejor de 3)', async () => {
    const { value, ms } = await createTime('pages-100000.pdf', 100_000);
    expect(value.pageCount).toBe(100_000);
    expect(ms, 'pages-100000 extraer todas las páginas').toBeLessThan(20_000);
  }, FILE_TIMEOUT);
});
