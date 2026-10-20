import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import type { SaveSlot } from '../../src/core/organize/plan';
import { buildOrganizeUpdate } from '../../src/core/organize/save';
import { openForSave } from '../../src/core/pdf/incremental';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que page-tree.perf.test.ts: 1 calentamiento, mejor de 3. Cada pasada abre el lector y escribe
// el incremento completo (`openForSave` + `buildOrganizeUpdate`).

const NOW = '2026-10-19T10:00:00.000Z';
/** Cada caso hace 4 pasadas (calentamiento + 3) de 100 000 páginas. */
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

/** Las `count` páginas originales en orden, con una página en blanco 595×842 insertada tras la `at`-ésima. */
function withBlankAfter(count: number, at: number): SaveSlot[] {
  const slots: SaveSlot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ kind: 'original', source: i, rotate: 0 });
    if (i === at) slots.push({ kind: 'blank', width: 595, height: 842, rotate: 0 });
  }
  return slots;
}

async function organizeTime(data: Uint8Array, slots: readonly SaveSlot[]) {
  return bestOf(3, 1, async () => {
    const source = memorySource(data);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
    const result = await buildOrganizeUpdate({ source, reader: opened.value, slots, now: NOW });
    if (!result.ok) throw new Error(`buildOrganizeUpdate falló: ${result.error.code}`);
    return result.value;
  });
}

describe('rendimiento de organizar con páginas en blanco (PDF-119)', () => {
  it('pages-100000.pdf con una página en blanco insertada en la mitad tarda menos de 15 s (mejor de 3)', async () => {
    const data = fixtureBytes('pages-100000.pdf');
    const { value, ms } = await organizeTime(data, withBlankAfter(100000, 49999));
    expect(value.rewrittenPages).toBe(100001);
    expect(ms, 'pages-100000 insertar página en blanco en la mitad').toBeLessThan(15000);
  }, FILE_TIMEOUT);
});
