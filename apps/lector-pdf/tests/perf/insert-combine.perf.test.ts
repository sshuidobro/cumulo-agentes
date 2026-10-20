import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import type { SaveSlot } from '../../src/core/organize/plan';
import { buildOrganizeUpdate } from '../../src/core/organize/save';
import { openForSave } from '../../src/core/pdf/incremental';
import { buildNewDocument } from '../../src/core/pdf/new-document';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import type { PageSlot } from '../../src/core/pdf/page-tree';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que organize.perf.test.ts: 1 calentamiento, mejor de 3 (PDF-055).

const NOW = '2026-10-20T10:00:00.000Z';
const FILE_TIMEOUT = 300_000;

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

/** basic-5: página 1 y 2, luego las `count` páginas importadas de pages-5000, luego el resto de basic-5. */
function insertSlots(count: number): SaveSlot[] {
  const slots: SaveSlot[] = [
    { kind: 'original', source: 0, rotate: 0 },
    { kind: 'original', source: 1, rotate: 0 },
  ];
  for (let i = 0; i < count; i++) slots.push({ kind: 'imported', doc: 0, source: i, rotate: 0 });
  for (let i = 2; i < 5; i++) slots.push({ kind: 'original', source: i, rotate: 0 });
  return slots;
}

describe('rendimiento de insertar y combinar páginas (PDF-055)', () => {
  it('insertar las 5 000 páginas de pages-5000.pdf en basic-5.pdf tarda menos de 3 s (mejor de 3)', async () => {
    const target = fixtureBytes('basic-5.pdf');
    const importedBytes = fixtureBytes('pages-5000.pdf');
    const { value, ms } = await bestOf(3, 1, async () => {
      const source = memorySource(target);
      const opened = await openForSave(source);
      if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
      const from = await openForSave(memorySource(importedBytes));
      if (!from.ok) throw new Error(`openForSave del importado falló: ${from.error.code}`);
      const result = await buildOrganizeUpdate({
        source,
        reader: opened.value,
        slots: insertSlots(5000),
        imported: [from.value],
        now: NOW,
      });
      if (!result.ok) throw new Error(`buildOrganizeUpdate falló: ${result.error.code}`);
      return result.value;
    });
    expect(value.rewrittenPages).toBe(5005);
    expect(ms).toBeLessThan(3000);
  }, FILE_TIMEOUT);

  it('combinar pages-5000.pdf con pages-5000.pdf tarda menos de 4 s (mejor de 3)', async () => {
    const data = fixtureBytes('pages-5000.pdf');
    const { value, ms } = await bestOf(3, 1, async () => {
      const readers = await Promise.all([ObjectReader.open(memorySource(data)), ObjectReader.open(memorySource(data))]);
      const parts = [];
      for (const reader of readers) {
        const count = await reader.pageCount();
        const pages: PageSlot[] = Array.from({ length: count }, (_, source) => ({ source, rotate: 0 }));
        parts.push({ reader, pages });
      }
      const result = await buildNewDocument({ parts, outline: 'branches', now: NOW });
      if (!result.ok) throw new Error(`buildNewDocument falló: ${result.error.code}`);
      return result.value;
    });
    expect(value.pageCount).toBe(10000);
    expect(ms).toBeLessThan(4000);
  }, FILE_TIMEOUT);
});
