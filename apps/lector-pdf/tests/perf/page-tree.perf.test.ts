import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { openForSave } from '../../src/core/pdf/incremental';
import { buildPageTreeUpdate, type PageSlot } from '../../src/core/pdf/page-tree';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que `bestOf` de incremental.perf.test.ts: 1 calentamiento, mejor de 3. Cada pasada abre el
// lector y escribe el incremento completo (`ObjectReader.open` + `buildPageTreeUpdate`).

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

/** Todas las páginas en su orden, salvo `skip` (índice 0-based), y `rotateIndex` con giro 90. */
function identityWith(count: number, options: { readonly skip?: number; readonly rotateIndex?: number }): PageSlot[] {
  const out: PageSlot[] = [];
  for (let i = 0; i < count; i++) {
    if (i === options.skip) continue;
    out.push({ source: i, rotate: i === options.rotateIndex ? 90 : 0 });
  }
  return out;
}

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

async function organizeTime(data: Uint8Array, pages: readonly PageSlot[]) {
  return bestOf(3, 1, async () => {
    const source = memorySource(data);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
    const result = await buildPageTreeUpdate({ source, reader: opened.value, pages, now: NOW });
    if (!result.ok) throw new Error(`buildPageTreeUpdate falló: ${result.error.code}`);
    return result.value;
  });
}

describe('rendimiento de la reorganización de páginas (PDF-052)', () => {
  it('pages-5000.pdf borrando la página 2 tarda menos de 1 s (mejor de 3)', async () => {
    const data = fixtureBytes('pages-5000.pdf');
    const { value, ms } = await organizeTime(data, identityWith(5000, { skip: 1 }));
    expect(value.rewrittenPages).toBe(4999);
    expect(ms, 'pages-5000 borrar página 2').toBeLessThan(1000);
  }, FILE_TIMEOUT);

  it('pages-100000.pdf borrando la página 2 tarda menos de 15 s (mejor de 3)', async () => {
    const data = fixtureBytes('pages-100000.pdf');
    const { value, ms } = await organizeTime(data, identityWith(100000, { skip: 1 }));
    expect(value.rewrittenPages).toBe(99999);
    expect(ms, 'pages-100000 borrar página 2').toBeLessThan(15000);
  }, FILE_TIMEOUT);

  it('pages-100000.pdf girando la página 50 000 tarda menos de 3 s (mejor de 3)', async () => {
    const data = fixtureBytes('pages-100000.pdf');
    const { value, ms } = await organizeTime(data, identityWith(100000, { rotateIndex: 49999 }));
    expect(value.rewrittenPages).toBe(1);
    expect(ms, 'pages-100000 girar página 50000').toBeLessThan(3000);
  }, FILE_TIMEOUT);
});
