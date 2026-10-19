import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { rewriteDocument, type RewriteOutput } from '../../src/core/pdf/rewrite';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que new-document.perf.test.ts: 1 calentamiento, mejor de 3. Cada pasada abre el lector y
// reescribe el documento completo (`ObjectReader.open` + `rewriteDocument`).

const NOW = '2026-10-19T10:00:00.000Z';
const PASSWORD = 'abc';
/** Cada caso hace 4 pasadas (calentamiento + 3) de un documento de 100 000 páginas. */
const FILE_TIMEOUT = 900_000;

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

async function rewriteTime(bytes: Uint8Array, encrypt: boolean): Promise<{ readonly value: RewriteOutput; readonly ms: number }> {
  return bestOf(3, 1, async () => {
    const reader = await ObjectReader.open(memorySource(bytes), {});
    const result = await rewriteDocument({
      reader,
      encryption: encrypt ? { userPassword: PASSWORD, ownerPassword: 'propietario', permissions: { print: 'high', modify: true, copy: true, annotate: true, fillForms: true, assemble: true }, random: reader.random } : null,
      now: NOW,
    });
    if (!result.ok) throw new Error(`rewriteDocument falló: ${result.error.code}`);
    return result.value;
  });
}

describe('rendimiento de la reescritura completa (PDF-131)', () => {
  it('reescribir pages-100000.pdf sin cifrar tarda menos de 20 s (mejor de 3)', async () => {
    const { value, ms } = await rewriteTime(fixtureBytes('pages-100000.pdf'), false);
    expect(value.objects).toBeGreaterThan(100_000);
    expect(ms, 'pages-100000 reescribir sin cifrar').toBeLessThan(20_000);
  }, FILE_TIMEOUT);

  it('reescribir pages-100000.pdf con cifrado AES-256 tarda menos de 25 s (mejor de 3)', async () => {
    const { value, ms } = await rewriteTime(fixtureBytes('pages-100000.pdf'), true);
    expect(value.objects).toBeGreaterThan(100_000);
    expect(ms, 'pages-100000 reescribir con cifrado').toBeLessThan(25_000);
  }, FILE_TIMEOUT);
});
