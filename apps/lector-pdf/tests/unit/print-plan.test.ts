import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_PIXELS } from '../../src/core/canvas-size';
import { PRINT_DPI, planPage, printScale, sheetFor } from '../../src/core/print/plan';

describe('sheetFor y planPage', () => {
  it('la hoja toma el tamaño de la primera página', () => {
    expect(sheetFor({ widthPt: 595, heightPt: 842 })).toEqual({ sheetWidthPt: 595, sheetHeightPt: 842 });
  });

  it('con autoRotate, una página apaisada en hoja vertical gira 90° y el tamaño queda girado', () => {
    const sheet = sheetFor({ widthPt: 595, heightPt: 842 });
    expect(planPage({ widthPt: 842, heightPt: 595 }, sheet, true)).toEqual({ rotate: 90, widthPt: 595, heightPt: 842 });
  });

  it('sin autoRotate la página no gira aunque no coincida la orientación', () => {
    const sheet = sheetFor({ widthPt: 595, heightPt: 842 });
    expect(planPage({ widthPt: 842, heightPt: 595 }, sheet, false)).toEqual({ rotate: 0, widthPt: 842, heightPt: 595 });
  });

  it('una página con la misma orientación que la hoja no gira', () => {
    const sheet = sheetFor({ widthPt: 842, heightPt: 595 });
    expect(planPage({ widthPt: 842, heightPt: 595 }, sheet, true)).toEqual({ rotate: 0, widthPt: 842, heightPt: 595 });
    expect(planPage({ widthPt: 595, heightPt: 842 }, sheet, true)).toEqual({ rotate: 90, widthPt: 842, heightPt: 595 });
  });

  it('las páginas cuadradas no giran nunca', () => {
    const portraitSheet = sheetFor({ widthPt: 595, heightPt: 842 });
    expect(planPage({ widthPt: 400, heightPt: 400 }, portraitSheet, true)).toEqual({ rotate: 0, widthPt: 400, heightPt: 400 });
    const squareSheet = sheetFor({ widthPt: 400, heightPt: 400 });
    expect(planPage({ widthPt: 842, heightPt: 595 }, squareSheet, true)).toEqual({ rotate: 0, widthPt: 842, heightPt: 595 });
  });
});

describe('printScale', () => {
  it('a 300 ppp en A4 la escala es 300/72', () => {
    expect(printScale(595, 842, 300)).toBe(300 / 72);
    expect(PRINT_DPI).toEqual({ normal: 150, high: 300 });
  });

  it('una página de 5 000 × 5 000 pt a 300 ppp no supera los píxeles máximos del lienzo', () => {
    const scale = printScale(5000, 5000, 300);
    expect(scale).toBeLessThan(300 / 72);
    const width = Math.floor(5000 * scale);
    const height = Math.floor(5000 * scale);
    expect(width * height).toBeLessThanOrEqual(33_554_432);
    // La escala no se reduce de más: el lienzo ocupa casi todo el límite.
    expect(width * height).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
  });

  it('rechaza tamaños o dpi no válidos', () => {
    expect(() => printScale(0, 842, 150)).toThrow(RangeError);
    expect(() => printScale(595, Number.NaN, 150)).toThrow(RangeError);
    expect(() => printScale(595, 842, -1)).toThrow(RangeError);
  });
});
