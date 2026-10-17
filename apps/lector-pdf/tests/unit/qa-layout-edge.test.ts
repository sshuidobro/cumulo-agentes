import { describe, expect, it } from 'vitest';
import {
  anchorAt,
  computeLayout,
  contentYForAnchor,
  contentYToScrollTop,
  MAX_SCROLL_HEIGHT,
  pageAtY,
  scrollMap,
  scrollTopToContentY,
  visibleRange,
} from '../../src/core/layout';
import { PageDimsTable } from '../../src/core/page-dims';
import { normalizeRotation } from '../../src/core/rotation';

const base = { scale: 1, rotation: 0 as const, gap: 12, padding: 16 };

describe('QA layout: casos límite', () => {
  it('páginas desconocidas (0x0) no rompen el layout ni la búsqueda', () => {
    const l = computeLayout(new PageDimsTable(5), base);
    expect(l.maxWidth).toBe(0);
    expect(l.totalHeight).toBe(16 + 4 * 12 + 16);
    for (const y of [-50, 0, 16, 1e9]) {
      const p = pageAtY(l, y);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(5);
    }
    expect(anchorAt(l, 100).fraction).toBe(0);
  });

  it('y negativo se recorta a la página 0 y visibleRange con top > bottom no lanza', () => {
    const l = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(pageAtY(l, -1e9)).toBe(0);
    const r = visibleRange(l, 900, 100, 0);
    expect(r.first).toBeGreaterThanOrEqual(0);
    expect(r.last).toBeLessThanOrEqual(2);
  });

  it('una sola página y overscan enorme se recortan', () => {
    const l = computeLayout(PageDimsTable.uniform(1, 100, 100, 0), base);
    expect(visibleRange(l, 0, 10, 1000)).toEqual({ first: 0, last: 0 });
    expect(l.totalHeight).toBe(132);
  });

  it('rotación de vista -90 normalizada equivale a 270', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-450)).toBe(270);
    const dims = PageDimsTable.uniform(2, 100, 200, 90);
    const l = computeLayout(dims, { ...base, rotation: normalizeRotation(-90) });
    expect(l.widths[0]).toBe(100); // 90 + 270 = 360 -> sin intercambio
    expect(l.heights[0]).toBe(200);
  });

  it('el final del scroll escalado coincide con el final del contenido en varios viewports', () => {
    const l = computeLayout(PageDimsTable.uniform(500_000, 612, 792, 0), base);
    for (const vh of [1, 600, 1080, 4000]) {
      const m = scrollMap(l, vh);
      expect(m.scrollHeight).toBe(MAX_SCROLL_HEIGHT);
      const y = scrollTopToContentY(MAX_SCROLL_HEIGHT - vh, m);
      expect(Math.abs(y - (l.totalHeight - vh))).toBeLessThan(0.01);
      expect(scrollTopToContentY(0, m)).toBe(0);
      expect(contentYToScrollTop(y, m)).toBeCloseTo(MAX_SCROLL_HEIGHT - vh, 3);
    }
  });

  it('rechaza parámetros inválidos', () => {
    const d = PageDimsTable.uniform(1, 10, 10, 0);
    expect(() => computeLayout(d, { ...base, scale: 0 })).toThrow(RangeError);
    expect(() => computeLayout(d, { ...base, scale: NaN })).toThrow(RangeError);
    expect(() => computeLayout(d, { ...base, gap: -1 })).toThrow(RangeError);
    expect(() => computeLayout(d, { ...base, padding: Infinity })).toThrow(RangeError);
  });

  it('el ancla con page fuera de rango se recorta', () => {
    const l = computeLayout(PageDimsTable.uniform(3, 612, 792, 0), base);
    expect(contentYForAnchor(l, { page: 99, fraction: 5 })).toBe(l.totalHeight - base.padding);
    expect(contentYForAnchor(l, { page: -4, fraction: -1 })).toBe(l.tops[0]);
  });
});
