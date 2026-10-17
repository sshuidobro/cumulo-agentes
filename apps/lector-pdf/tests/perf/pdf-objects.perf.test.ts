import { describe, expect, it } from 'vitest';
import { parseValue } from '../../src/core/pdf/parser';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.

const ANNOTATION = '<< /Type /Annot /Rect [0 0 10.5 -3] /C [1 0 0] /P 12 0 R /T (Ana \\(x\\)) /N /a#20b /H <4E6F> /O true /Z null >>\n';

function analyzeAll(input: Uint8Array, count: number): number {
  let offset = 0;
  let parsed = 0;
  while (parsed < count) {
    offset = parseValue(input, offset).end;
    parsed++;
  }
  return parsed;
}

describe('rendimiento del léxico y analizador PDF', () => {
  it('analiza 10 000 diccionarios de anotación en menos de 300 ms', () => {
    const input = new TextEncoder().encode(ANNOTATION.repeat(10_000));
    const { value, ms } = measureBest(() => analyzeAll(input, 10_000));
    expect(value).toBe(10_000);
    expect(ms).toBeLessThan(300);
  });
});
