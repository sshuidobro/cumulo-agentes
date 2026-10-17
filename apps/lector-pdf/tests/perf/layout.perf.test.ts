import { describe, expect, it } from 'vitest';
import { PageDimsTable } from '../../src/core/page-dims';
import { computeLayout, DEFAULT_GAP, DEFAULT_PADDING, pageAtY, type LayoutParams } from '../../src/core/layout';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.

const base: LayoutParams = { scale: 1, rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING };

/** Generador pseudoaleatorio determinista (Park-Miller): los tests no dependen del azar real. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe('rendimiento de layout con 1 000 000 de páginas', () => {
  it('calcula 1 000 000 de páginas en menos de 100 ms', () => {
    const dims = PageDimsTable.uniform(1_000_000, 612, 792, 0);
    const { value, ms } = measureBest(() => computeLayout(dims, base));
    expect(value.count).toBe(1_000_000);
    expect(ms).toBeLessThan(100);
  });

  it('1 000 000 de consultas aleatorias en menos de 300 ms', () => {
    const big = computeLayout(PageDimsTable.uniform(1_000_000, 612, 792, 0), base);
    const random = seeded(42);
    const ys = new Float64Array(1_000_000);
    for (let i = 0; i < ys.length; i++) ys[i] = random() * big.totalHeight;
    // Referencia local: evita el coste de acceder al export en cada iteración.
    const lookup = pageAtY;
    const { value: checksum, ms } = measureBest(() => {
      let sum = 0;
      for (let i = 0; i < ys.length; i++) sum += lookup(big, ys[i] ?? 0);
      return sum;
    });
    expect(checksum).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  });
});
