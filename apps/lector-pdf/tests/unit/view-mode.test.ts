import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/layout';
import { PageDimsTable } from '../../src/core/page-dims';
import {
  DEFAULT_VIEW_MODE,
  isViewMode,
  pagedWindow,
  referenceSize,
  rowFirstPage,
  stepRow,
} from '../../src/core/view-mode';

describe('DEFAULT_VIEW_MODE', () => {
  it('es continuo y sin páginas por fila', () => {
    expect(DEFAULT_VIEW_MODE).toEqual({ scroll: 'continuous', spread: 'none' });
  });
});

describe('isViewMode', () => {
  it('rechaza valores que no son un modo de vista', () => {
    expect(isViewMode(null)).toBe(false);
    expect(isViewMode(undefined)).toBe(false);
    expect(isViewMode('paged')).toBe(false);
    expect(isViewMode({})).toBe(false);
    expect(isViewMode({ scroll: 'x', spread: 'none' })).toBe(false);
    expect(isViewMode({ scroll: 'paged', spread: 'double' })).toBe(false);
    expect(isViewMode({ scroll: 'paged' })).toBe(false);
  });

  it('acepta las seis combinaciones válidas', () => {
    const scrolls = ['continuous', 'paged'] as const;
    const spreads = ['none', 'pairs', 'cover'] as const;
    for (const scroll of scrolls) {
      for (const spread of spreads) {
        expect(isViewMode({ scroll, spread })).toBe(true);
      }
    }
  });
});

describe('rowFirstPage', () => {
  it('con pares, la fila de cada página empieza en par', () => {
    expect(rowFirstPage(0, 'pairs')).toBe(0);
    expect(rowFirstPage(1, 'pairs')).toBe(0);
    expect(rowFirstPage(4, 'pairs')).toBe(4);
    expect(rowFirstPage(5, 'pairs')).toBe(4);
  });

  it('con portada, la página 0 va sola y el resto empieza en impar', () => {
    expect(rowFirstPage(0, 'cover')).toBe(0);
    expect(rowFirstPage(1, 'cover')).toBe(1);
    expect(rowFirstPage(2, 'cover')).toBe(1);
    expect(rowFirstPage(3, 'cover')).toBe(3);
    expect(rowFirstPage(4, 'cover')).toBe(3);
  });

  it('sin filas dobles, cada página es su propia fila', () => {
    expect(rowFirstPage(7, 'none')).toBe(7);
  });

  it('rechaza páginas negativas o no enteras como bug del llamante', () => {
    expect(() => rowFirstPage(-1, 'pairs')).toThrow(RangeError);
    expect(() => rowFirstPage(1.5, 'cover')).toThrow(RangeError);
  });
});

describe('stepRow', () => {
  it('con portada y 6 páginas avanza y retrocede por filas', () => {
    expect(stepRow(0, 1, 'cover', 6)).toBe(1);
    expect(stepRow(1, 1, 'cover', 6)).toBe(3);
    expect(stepRow(3, 1, 'cover', 6)).toBe(5);
    expect(stepRow(5, 1, 'cover', 6)).toBeNull();

    expect(stepRow(5, -1, 'cover', 6)).toBe(3);
    expect(stepRow(1, -1, 'cover', 6)).toBe(0);
    expect(stepRow(0, -1, 'cover', 6)).toBeNull();
  });

  it('con pares y 5 páginas, la última fila es la página 4 sola', () => {
    expect(stepRow(4, 1, 'pairs', 5)).toBeNull();
    expect(stepRow(4, -1, 'pairs', 5)).toBe(2);
  });

  it('desde una página que no empieza fila, parte de la primera de su fila', () => {
    expect(stepRow(3, 1, 'pairs', 10)).toBe(4);
    expect(stepRow(3, -1, 'pairs', 10)).toBe(0);
  });

  it('sin filas dobles, avanza de una en una', () => {
    expect(stepRow(0, 1, 'none', 3)).toBe(1);
    expect(stepRow(2, 1, 'none', 3)).toBeNull();
    expect(stepRow(2, -1, 'none', 3)).toBe(1);
  });

  it('sin páginas no hay a dónde ir', () => {
    expect(stepRow(0, 1, 'pairs', 0)).toBeNull();
    expect(stepRow(0, -1, 'cover', 0)).toBeNull();
  });

  it('rechaza un número de páginas negativo como bug del llamante', () => {
    expect(() => stepRow(0, 1, 'none', -1)).toThrow(RangeError);
  });
});

describe('referenceSize', () => {
  const pages600x800 = PageDimsTable.uniform(2, 600, 800, 0);

  it('en pares, dos páginas de 600×800 pt suman ancho y añaden el hueco', () => {
    expect(referenceSize(pages600x800, 0, 'pairs', 0)).toEqual({
      pagePt: { width: 1200, height: 800 },
      extraWidthPx: 12,
    });
  });

  it('con rotación de vista de 90°, los anchos se intercambian', () => {
    expect(referenceSize(pages600x800, 90, 'pairs', 0)).toEqual({
      pagePt: { width: 1600, height: 600 },
      extraWidthPx: 12,
    });
  });

  it('una fila de una sola página no tiene hueco extra', () => {
    expect(referenceSize(pages600x800, 0, 'none', 1)).toEqual({
      pagePt: { width: 600, height: 800 },
      extraWidthPx: 0,
    });
    expect(referenceSize(pages600x800, 0, 'cover', 0)).toEqual({
      pagePt: { width: 600, height: 800 },
      extraWidthPx: 0,
    });
  });

  it('la última página sola de una fila con pares no tiene hueco extra', () => {
    const three = PageDimsTable.uniform(3, 600, 800, 0);
    expect(referenceSize(three, 0, 'pairs', 2)).toEqual({
      pagePt: { width: 600, height: 800 },
      extraWidthPx: 0,
    });
  });

  it('suma páginas de tamaños distintos y toma el alto máximo', () => {
    const mixed = new PageDimsTable(2);
    mixed.set(0, 600, 800, 0);
    mixed.set(1, 400, 900, 0);
    expect(referenceSize(mixed, 0, 'pairs', 0).pagePt).toEqual({ width: 1000, height: 900 });
  });
});

describe('pagedWindow', () => {
  it('la primera fila empieza en 0 y cada ventana abarca la fila con sus márgenes', () => {
    const dims = PageDimsTable.uniform(4, 100, 200, 0);
    const layout = computeLayout(dims, { scale: 1, rotation: 0, gap: 10, padding: 16, spread: 'pairs' });
    const first = pagedWindow(layout, 0);
    expect(first).toEqual({ top: 0, height: 200 + 32 });
    const second = pagedWindow(layout, 1);
    expect(second.top).toBe((layout.rowTops[1] ?? Number.NaN) - 16);
    expect(second.height).toBe(200 + 32);
  });

  it('rechaza una fila que no existe', () => {
    const layout = computeLayout(PageDimsTable.uniform(1, 100, 200, 0), { scale: 1, rotation: 0, gap: 10, padding: 16 });
    expect(() => pagedWindow(layout, 1)).toThrow(RangeError);
  });
});
