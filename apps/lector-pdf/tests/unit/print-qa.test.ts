import { describe, expect, it } from 'vitest';
import { parsePageRange } from '../../src/core/print/range';
import { planPage, printScale, sheetFor } from '../../src/core/print/plan';

describe('QA impresión: casos límite', () => {
  it('rangos con espacios, repetidos y desordenados', () => {
    expect(parsePageRange(' 5 , 1 - 2 , 2-3 ', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('3-', 3)).toEqual([2]);
  });
  it('entradas inválidas', () => {
    for (const t of ['-', '-3', '1-2-3', '1.5', '1;2', ' ', '１', '1,', ',1', 'NaN', '1e1', '99999999999999999999']) {
      expect(parsePageRange(t, 10), t).toBeNull();
    }
    expect(parsePageRange('1', 0)).toBeNull();
  });
  it('página enorme y diminuta: escala finita y positiva', () => {
    for (const [w, h] of [[14400, 14400], [1, 1], [100000, 10]] as const) {
      const s = printScale(w, h, 300);
      expect(Number.isFinite(s) && s > 0).toBe(true);
      expect(Math.floor(w * s) * Math.floor(h * s)).toBeLessThanOrEqual(33_554_432);
    }
  });
  it('plan: hoja apaisada y página vertical gira', () => {
    const sheet = sheetFor({ widthPt: 842, heightPt: 595 });
    expect(planPage({ widthPt: 595, heightPt: 842 }, sheet, true).rotate).toBe(90);
    expect(planPage({ widthPt: 595, heightPt: 842 }, sheet, false).rotate).toBe(0);
  });
});
