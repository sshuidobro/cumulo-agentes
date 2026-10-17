import { describe, expect, it } from 'vitest';
import { FIXTURES, type FixtureSpec } from '../fixtures/catalog.ts';
import { measureBest } from './measure';

// Asserts de tiempo de reloj del generador de fixtures (PDF-002, ADR-0012): solo con `pnpm perf`.

const HEAVY_TEST_MS = 120_000;

function specOf(name: string): FixtureSpec {
  const spec = FIXTURES.find((fixture) => fixture.name === name);
  if (spec === undefined) {
    throw new Error(`Fixture desconocido: ${name}`);
  }
  return spec;
}

describe('rendimiento del generador de fixtures', () => {
  it('pages-5000.pdf se genera en menos de 1 s', () => {
    const { ms } = measureBest(() => specOf('pages-5000.pdf').build());
    expect(ms).toBeLessThan(1000);
  }, HEAVY_TEST_MS);

  it('pages-100000.pdf se genera en menos de 10 s', () => {
    const { ms } = measureBest(() => specOf('pages-100000.pdf').build());
    expect(ms).toBeLessThan(10_000);
  }, HEAVY_TEST_MS);
});
