import { describe, expect, it } from 'vitest';
import { simplifyPath } from '../../src/core/annotations/simplify';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo con `pnpm perf`. Sin JSX; ver `measure.ts`.

describe('rendimiento de simplifyPath', () => {
  it('simplificar 100 000 puntos tarda menos de 100 ms', () => {
    const pts: number[] = [];
    for (let i = 0; i < 100_000; i++) pts.push(i % 1000, Math.sin(i / 50) * 300 + ((i * 7919) % 13) / 13);
    const { ms } = measureBest(() => simplifyPath(pts, 0.5));
    expect(ms, `simplifyPath de 100 000 puntos: ${ms.toFixed(1)} ms`).toBeLessThan(100);
  });
});
