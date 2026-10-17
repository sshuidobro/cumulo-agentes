import { describe, expect, it } from 'vitest';
import { PageDimsTable } from '../../src/core/page-dims';
import {
  anchorAt,
  computeLayout,
  contentYForAnchor,
  contentYToScrollTop,
  DEFAULT_GAP,
  DEFAULT_PADDING,
  MAX_SCROLL_HEIGHT,
  maxContentY,
  pageAtY,
  type LayoutParams,
  scrollMap,
  scrollTopToContentY,
  visibleRange,
} from '../../src/core/layout';
import type { Rotation } from '../../src/core/rotation';

const base: LayoutParams = { scale: 1, rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING };

describe('DEFAULT_GAP y DEFAULT_PADDING', () => {
  it('valen 12 y 16 px', () => {
    expect(DEFAULT_GAP).toBe(12);
    expect(DEFAULT_PADDING).toBe(16);
  });
});

describe('computeLayout', () => {
  it('3 páginas 612×792 a escala 1 con hueco 12 y margen 16', () => {
    const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(Array.from(layout.tops)).toEqual([16, 820, 1624, 2428]);
    expect(layout.totalHeight).toBe(2432);
    expect(layout.maxWidth).toBe(612);
    expect(layout.count).toBe(3);
    expect(layout.params).toBe(base);
  });

  it('aplica la escala a tamaños, huecos y márgenes de píxeles', () => {
    const layout = computeLayout(PageDimsTable.uniform(2, 100, 200, 0), { ...base, scale: 2 });
    expect(Array.from(layout.widths)).toEqual([200, 200]);
    expect(Array.from(layout.heights)).toEqual([400, 400]);
    expect(Array.from(layout.tops)).toEqual([16, 428, 840]);
    expect(layout.totalHeight).toBe(840 - 12 + 16);
  });

  it('rotación de vista 90 intercambia ancho y alto', () => {
    const layout = computeLayout(PageDimsTable.uniform(2, 612, 792, 0), { ...base, rotation: 90 });
    expect(layout.widths[0]).toBe(792);
    expect(layout.heights[0]).toBe(612);
    expect(layout.maxWidth).toBe(792);
  });

  it('rotación propia 90 con rotación de vista 90 suma 180 y no intercambia', () => {
    const layout = computeLayout(PageDimsTable.uniform(1, 612, 792, 90), { ...base, rotation: 90 });
    expect(layout.widths[0]).toBe(612);
    expect(layout.heights[0]).toBe(792);
  });

  it('rotación propia 270 con vista 90 da 0 y no intercambia', () => {
    const layout = computeLayout(PageDimsTable.uniform(1, 612, 792, 270), { ...base, rotation: 90 });
    expect(layout.widths[0]).toBe(612);
    expect(layout.heights[0]).toBe(792);
  });

  it('sin páginas: solo los márgenes y tops con un único valor', () => {
    const layout = computeLayout(new PageDimsTable(0), base);
    expect(layout.count).toBe(0);
    expect(layout.totalHeight).toBe(2 * DEFAULT_PADDING);
    expect(layout.maxWidth).toBe(0);
    expect(Array.from(layout.tops)).toEqual([16]);
  });

  it('rechaza parámetros inválidos', () => {
    const dims = PageDimsTable.uniform(1, 612, 792, 0);
    const badRotation: number = 45;
    expect(() => computeLayout(dims, { ...base, scale: 0 })).toThrow(RangeError);
    expect(() => computeLayout(dims, { ...base, scale: Number.NaN })).toThrow(RangeError);
    expect(() => computeLayout(dims, { ...base, gap: -1 })).toThrow(RangeError);
    expect(() => computeLayout(dims, { ...base, padding: -1 })).toThrow(RangeError);
    expect(() => computeLayout(dims, { ...base, rotation: badRotation as Rotation })).toThrow(RangeError);
  });
});

describe('1 000 000 de páginas (comportamiento; los tiempos están en tests/perf)', () => {
  const layout = computeLayout(PageDimsTable.uniform(1_000_000, 612, 792, 0), base);

  it('tiene 1 000 000 de páginas y la última termina donde indica el layout', () => {
    expect(layout.count).toBe(1_000_000);
    expect(layout.tops[1_000_000]).toBe(804_000_016);
    expect(layout.totalHeight).toBe(804_000_020);
  });

  it('pageAtY encuentra la página exacta en mitad del documento', () => {
    expect(pageAtY(layout, layout.tops[123_456] ?? Number.NaN)).toBe(123_456);
  });

  it('pageAtY justo tras el inicio de la última página da la última página', () => {
    expect(pageAtY(layout, (layout.tops[999_999] ?? Number.NaN) + 1)).toBe(999_999);
  });
});

describe('pageAtY', () => {
  const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);

  it('y = 0 (por encima de la primera página) da la página 0', () => {
    expect(pageAtY(layout, 0)).toBe(0);
  });

  it('un y en el hueco tras la página 0 da la página 0', () => {
    expect(pageAtY(layout, 810)).toBe(0);
  });

  it('el inicio de la página 1 da la página 1', () => {
    expect(pageAtY(layout, 820)).toBe(1);
  });

  it('un y por debajo del final se recorta a la última página', () => {
    expect(pageAtY(layout, 1e9)).toBe(2);
  });

  it('sin páginas da -1', () => {
    expect(pageAtY(computeLayout(new PageDimsTable(0), base), 100)).toBe(-1);
  });
});

describe('visibleRange', () => {
  const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);

  it('del 800 al 900 con margen 1 da las páginas 0 a 2', () => {
    expect(visibleRange(layout, 800, 900, 1)).toEqual({ first: 0, last: 2 });
  });

  it('sin margen solo incluye las páginas tocadas', () => {
    expect(visibleRange(layout, 1700, 1800, 0)).toEqual({ first: 2, last: 2 });
  });

  it('recorta los extremos al rango válido', () => {
    expect(visibleRange(layout, 0, 1e9, 5)).toEqual({ first: 0, last: 2 });
  });

  it('sin páginas da { first: 0, last: -1 }', () => {
    expect(visibleRange(computeLayout(new PageDimsTable(0), base), 0, 100, 1)).toEqual({ first: 0, last: -1 });
  });

  it('rechaza un margen negativo o no entero', () => {
    expect(() => visibleRange(layout, 0, 100, -1)).toThrow(RangeError);
    expect(() => visibleRange(layout, 0, 100, 0.5)).toThrow(RangeError);
  });
});

describe('scrollMap', () => {
  it('sin superar el máximo, el scroll es el contenido (factor 1)', () => {
    const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(scrollMap(layout, 800)).toEqual({ scrollHeight: 2432, factor: 1 });
    expect(scrollTopToContentY(500, scrollMap(layout, 800))).toBe(500);
    expect(contentYToScrollTop(500, scrollMap(layout, 800))).toBe(500);
  });

  it('100 000 páginas de 1 056 px: scrollHeight máximo y factor mayor que 1', () => {
    const layout = computeLayout(PageDimsTable.uniform(100_000, 612, 1056, 0), base);
    expect(layout.totalHeight).toBeGreaterThan(MAX_SCROLL_HEIGHT);
    const map = scrollMap(layout, 800);
    expect(map.scrollHeight).toBe(8_000_000);
    expect(map.factor).toBeGreaterThan(1);
  });

  it('el final del scroll corresponde al final del contenido', () => {
    const layout = computeLayout(PageDimsTable.uniform(100_000, 612, 1056, 0), base);
    const map = scrollMap(layout, 800);
    expect(scrollTopToContentY(8_000_000 - 800, map)).toBeCloseTo(layout.totalHeight - 800, 3);
  });

  it('ida y vuelta entre scrollTop y contenido', () => {
    const layout = computeLayout(PageDimsTable.uniform(100_000, 612, 1056, 0), base);
    const map = scrollMap(layout, 800);
    for (const x of [0, 1, 12_345.5, 4_000_000, layout.totalHeight - 800]) {
      expect(contentYToScrollTop(scrollTopToContentY(x, map), map)).toBeCloseTo(x, 6);
    }
  });

  it('rechaza un viewport que no cabe en el máximo al escalar', () => {
    const layout = computeLayout(PageDimsTable.uniform(100_000, 612, 1056, 0), base);
    expect(() => scrollMap(layout, MAX_SCROLL_HEIGHT)).toThrow(RangeError);
  });
});

describe('anclaje', () => {
  it('anchorAt devuelve página y fracción', () => {
    const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    const anchor = anchorAt(layout, 412);
    expect(anchor.page).toBe(0);
    expect(anchor.fraction).toBeCloseTo((412 - 16) / 792, 9);
  });

  it('anchorAt en un hueco da la fracción 1 de la página anterior', () => {
    const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(anchorAt(layout, 810)).toEqual({ page: 0, fraction: 1 });
  });

  it('anchorAt sin páginas da página -1', () => {
    expect(anchorAt(computeLayout(new PageDimsTable(0), base), 50)).toEqual({ page: -1, fraction: 0 });
  });

  it('anchorAt de una página de altura 0 da fracción 0', () => {
    const dims = new PageDimsTable(1);
    dims.set(0, 0, 0, 0);
    expect(anchorAt(computeLayout(dims, base), 16)).toEqual({ page: 0, fraction: 0 });
  });

  it('contentYForAnchor recorta página y fracción', () => {
    const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(contentYForAnchor(layout, { page: 1, fraction: 0.5 })).toBe(820 + 396);
    expect(contentYForAnchor(layout, { page: 99, fraction: 2 })).toBe(1624 + 792);
    expect(contentYForAnchor(layout, { page: -5, fraction: -1 })).toBe(16);
  });

  it('contentYForAnchor sin páginas devuelve el margen superior', () => {
    expect(contentYForAnchor(computeLayout(new PageDimsTable(0), base), { page: -1, fraction: 0 })).toBe(16);
  });

  it('tras cambiar el zoom, el ancla cae en la misma página y fracción', () => {
    const dims = PageDimsTable.uniform(50, 612, 792, 0);
    const before = computeLayout(dims, base);
    const after = computeLayout(dims, { ...base, scale: 2 });
    const y = before.tops[10] ?? 0;
    const anchor = anchorAt(before, y + 300);
    const newY = contentYForAnchor(after, anchor);
    expect(pageAtY(after, newY)).toBe(anchor.page);
    expect(anchorAt(after, newY).fraction).toBeCloseTo(anchor.fraction, 9);
  });
});

describe('maxContentY', () => {
  it('es el total menos el viewport, nunca negativo', () => {
    const layout = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(maxContentY(layout, 800)).toBe(2432 - 800);
    expect(maxContentY(layout, 10_000)).toBe(0);
  });
});
