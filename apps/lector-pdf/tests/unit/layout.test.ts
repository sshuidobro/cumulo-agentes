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
  rowRange,
  rowWidthOf,
  type LayoutParams,
  type Spread,
  scrollMap,
  scrollTopToContentY,
  visibleRange,
} from '../../src/core/layout';
import type { Rotation } from '../../src/core/rotation';

const base: LayoutParams = { scale: 1, rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING };

/** Lectura de un array tipado con índice fijo: un índice inexistente da NaN y el test falla. */
function at(arr: ArrayLike<number>, i: number): number {
  return arr[i] ?? Number.NaN;
}

/** Generador pseudoaleatorio determinista (Park-Miller): los tests no dependen del azar real. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

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

describe('spread none: idéntico a la versión anterior (valores fijados)', () => {
  const rot = PageDimsTable.uniform(4, 612, 792, 0);
  rot.set(0, 612, 792, 90);
  rot.set(1, 612, 792, 180);
  rot.set(2, 612, 792, 270);
  rot.set(3, 612, 792, 0);
  const mixed = new PageDimsTable(5);
  mixed.set(0, 612, 792, 0);
  mixed.set(1, 800, 600, 90);
  mixed.set(2, 300, 400, 180);
  mixed.set(3, 595, 842, 270);
  mixed.set(4, 100, 100, 0);

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly dims: PageDimsTable;
    readonly tops: readonly number[];
    readonly widths: readonly number[];
    readonly heights: readonly number[];
    readonly totalHeight: number;
    readonly maxWidth: number;
  }> = [
    {
      name: 'uniforme',
      dims: PageDimsTable.uniform(5, 612, 792, 0),
      tops: [16, 820, 1624, 2428, 3232, 4036],
      widths: [612, 612, 612, 612, 612],
      heights: [792, 792, 792, 792, 792],
      totalHeight: 4040,
      maxWidth: 612,
    },
    {
      name: 'mezclada',
      dims: mixed,
      tops: [16, 820, 1632, 2044, 2651, 2763],
      widths: [612, 600, 300, 842, 100],
      heights: [792, 800, 400, 595, 100],
      totalHeight: 2767,
      maxWidth: 842,
    },
    {
      name: 'rotaciones propias 0/90/180/270',
      dims: rot,
      tops: [16, 640, 1444, 2068, 2872],
      widths: [792, 612, 792, 612],
      heights: [612, 792, 612, 792],
      totalHeight: 2876,
      maxWidth: 792,
    },
    {
      name: '0 páginas',
      dims: new PageDimsTable(0),
      tops: [16],
      widths: [],
      heights: [],
      totalHeight: 32,
      maxWidth: 0,
    },
    {
      name: '1 página',
      dims: PageDimsTable.uniform(1, 612, 792, 0),
      tops: [16, 820],
      widths: [612],
      heights: [792],
      totalHeight: 824,
      maxWidth: 612,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: tops, widths, heights, totalHeight y maxWidth no cambian`, () => {
      const layout = computeLayout(c.dims, base);
      expect(Array.from(layout.tops)).toEqual(c.tops);
      expect(Array.from(layout.widths)).toEqual(c.widths);
      expect(Array.from(layout.heights)).toEqual(c.heights);
      expect(layout.totalHeight).toBe(c.totalHeight);
      expect(layout.maxWidth).toBe(c.maxWidth);
    });

    it(`${c.name}: sin spread, lefts centra cada página (y spread 'none' es lo mismo)`, () => {
      const implicit = computeLayout(c.dims, base);
      const explicit = computeLayout(c.dims, { ...base, spread: 'none' });
      expect(Array.from(explicit.tops)).toEqual(Array.from(implicit.tops));
      expect(explicit.rowCount).toBe(c.widths.length);
      for (let i = 0; i < c.widths.length; i++) {
        expect(implicit.lefts[i]).toBe((implicit.maxWidth - at(implicit.widths, i)) / 2);
        expect(explicit.lefts[i]).toBe(implicit.lefts[i]);
      }
    });
  }
});

describe('spread pairs (1-2, 3-4…)', () => {
  const layout = computeLayout(PageDimsTable.uniform(5, 600, 800, 0), { ...base, spread: 'pairs' });

  it('5 páginas 600×800: tres filas, la última con una página', () => {
    expect(layout.rowCount).toBe(3);
    expect(Array.from(layout.rowStart)).toEqual([0, 2, 4, 5]);
    expect(Array.from(layout.rowOf)).toEqual([0, 0, 1, 1, 2]);
    expect(Array.from(layout.rowWidths)).toEqual([1212, 1212, 600]);
    expect(Array.from(layout.rowHeights)).toEqual([800, 800, 800]);
  });

  it('tops alineados arriba dentro de cada fila, con el hueco entre filas', () => {
    expect(Array.from(layout.tops)).toEqual([16, 16, 828, 828, 1640, 2452]);
    expect(Array.from(layout.rowTops)).toEqual([16, 828, 1640, 2452]);
  });

  it('ancho máximo de dos páginas y hueco; x centrada en cada fila', () => {
    expect(layout.maxWidth).toBe(1212);
    expect(Array.from(layout.lefts)).toEqual([0, 612, 0, 612, 306]);
    expect(layout.totalHeight).toBe(2456);
  });

  it('pageAtY devuelve la primera página de la fila (y en el hueco, la fila anterior)', () => {
    expect(pageAtY(layout, 16)).toBe(0);
    expect(pageAtY(layout, 500)).toBe(0);
    expect(pageAtY(layout, 828)).toBe(2);
    expect(pageAtY(layout, 1640 + 799)).toBe(4);
    expect(pageAtY(layout, 1e9)).toBe(4);
  });

  it('rowRange y rowWidthOf describen la fila de una página', () => {
    expect(rowRange(layout, 1)).toEqual({ first: 0, last: 1 });
    expect(rowRange(layout, 4)).toEqual({ first: 4, last: 4 });
    expect(rowWidthOf(layout, 1)).toBe(1212);
    expect(rowWidthOf(layout, 4)).toBe(600);
  });

  it('visibleRange incluye ambas páginas de una fila de dos', () => {
    expect(visibleRange(layout, 828 + 10, 828 + 10, 0)).toEqual({ first: 2, last: 3 });
    expect(visibleRange(layout, 16 + 1, 16 + 1, 0)).toEqual({ first: 0, last: 1 });
  });

  it('una última fila de una página se centra en el ancho máximo', () => {
    const odd = new PageDimsTable(3);
    odd.set(0, 600, 800, 0);
    odd.set(1, 600, 800, 0);
    odd.set(2, 300, 400, 0);
    const l = computeLayout(odd, { ...base, spread: 'pairs' });
    expect(l.maxWidth).toBe(1212);
    expect(l.lefts[2]).toBe((1212 - 300) / 2);
  });
});

describe('spread cover (1, 2-3, 4-5…)', () => {
  const layout = computeLayout(PageDimsTable.uniform(4, 612, 792, 0), { ...base, spread: 'cover' });

  it('4 páginas: filas [0], [1,2], [3]', () => {
    expect(layout.rowCount).toBe(3);
    expect(Array.from(layout.rowStart)).toEqual([0, 1, 3, 4]);
    expect(Array.from(layout.rowOf)).toEqual([0, 1, 1, 2]);
  });

  it('pageAtY en la segunda fila devuelve la página 1', () => {
    const top = at(layout.rowTops, 1);
    expect(pageAtY(layout, top + 5)).toBe(1);
    expect(pageAtY(layout, top + 800)).toBe(1);
  });

  it('rowRange de la página 2 devuelve la fila [1, 2]', () => {
    expect(rowRange(layout, 2)).toEqual({ first: 1, last: 2 });
    expect(rowRange(layout, 0)).toEqual({ first: 0, last: 0 });
  });

  it('una sola página (portada) va sola y centrada', () => {
    const l = computeLayout(PageDimsTable.uniform(1, 612, 792, 0), { ...base, spread: 'cover' });
    expect(l.rowCount).toBe(1);
    expect(Array.from(l.rowStart)).toEqual([0, 1]);
    expect(l.lefts[0]).toBe(0);
  });

  it('cinco páginas: [0], [1,2], [3,4]', () => {
    const l = computeLayout(PageDimsTable.uniform(5, 612, 792, 0), { ...base, spread: 'cover' });
    expect(l.rowCount).toBe(3);
    expect(Array.from(l.rowStart)).toEqual([0, 1, 3, 5]);
  });
});

describe('filas con alturas distintas', () => {
  it('la altura de la fila es la máxima de sus páginas y la siguiente fila empieza tras ella más el hueco', () => {
    const dims = new PageDimsTable(3);
    dims.set(0, 600, 800, 0);
    dims.set(1, 800, 600, 0);
    dims.set(2, 600, 800, 0);
    const layout = computeLayout(dims, { ...base, spread: 'pairs' });
    expect(at(layout.rowHeights, 0)).toBe(800);
    expect(at(layout.rowTops, 1)).toBe(16 + 800 + DEFAULT_GAP);
    expect(layout.tops[2]).toBe(16 + 800 + DEFAULT_GAP);
    expect(layout.tops[3]).toBe(layout.rowTops[2]);
  });

  it('anchorAt mide la fracción sobre la altura de la fila', () => {
    const dims = new PageDimsTable(2);
    dims.set(0, 600, 800, 0);
    dims.set(1, 600, 400, 0);
    const layout = computeLayout(dims, { ...base, spread: 'pairs' });
    expect(anchorAt(layout, 16 + 400)).toEqual({ page: 0, fraction: 0.5 });
  });
});

describe('consultas con spread', () => {
  it('sin páginas, cualquier spread da una columna vacía', () => {
    for (const spread of ['pairs', 'cover'] as const) {
      const layout = computeLayout(new PageDimsTable(0), { ...base, spread });
      expect(layout.rowCount).toBe(0);
      expect(layout.totalHeight).toBe(2 * DEFAULT_PADDING);
      expect(pageAtY(layout, 100)).toBe(-1);
      expect(visibleRange(layout, 0, 100, 1)).toEqual({ first: 0, last: -1 });
      expect(anchorAt(layout, 50)).toEqual({ page: -1, fraction: 0 });
      expect(contentYForAnchor(layout, { page: -1, fraction: 0 })).toBe(DEFAULT_PADDING);
    }
  });

  it('visibleRange con margen amplía las filas enteras', () => {
    const layout = computeLayout(PageDimsTable.uniform(6, 600, 800, 0), { ...base, spread: 'pairs' });
    // Filas [0,1], [2,3], [4,5]; la fila 1 con margen 1 da de la página 1 a la 4 (las filas enteras + 1 página a cada lado).
    expect(visibleRange(layout, 828 + 1, 828 + 1, 1)).toEqual({ first: 1, last: 4 });
    expect(visibleRange(layout, 1e9, 1e9, 0)).toEqual({ first: 4, last: 5 });
  });

  it('rowRange y rowWidthOf rechazan una página fuera de rango', () => {
    const layout = computeLayout(PageDimsTable.uniform(2, 612, 792, 0), { ...base, spread: 'pairs' });
    expect(() => rowRange(layout, 2)).toThrow(RangeError);
    expect(() => rowWidthOf(layout, -1)).toThrow(RangeError);
  });

  it('rechaza un modo de páginas desconocido', () => {
    const dims = PageDimsTable.uniform(1, 612, 792, 0);
    const unknown = 'triple' as Spread;
    expect(() => computeLayout(dims, { ...base, spread: unknown })).toThrow(RangeError);
  });

  it('anchorAt y contentYForAnchor son inversas (±0,5 px) en 1 000 posiciones aleatorias, en los tres modos', () => {
    const random = seeded(2026);
    const dims = new PageDimsTable(37);
    for (let i = 0; i < 37; i++) {
      dims.set(i, 200 + Math.floor(random() * 600), 200 + Math.floor(random() * 800), 0);
    }
    for (const spread of ['none', 'pairs', 'cover'] as const) {
      const layout = computeLayout(dims, { ...base, spread });
      for (let k = 0; k < 1000; k++) {
        // y dentro de una fila (las posiciones en el hueco entre filas no tienen inverso exacto).
        const row = Math.floor(random() * layout.rowCount);
        const y = at(layout.rowTops, row) + random() * at(layout.rowHeights, row);
        const anchor = anchorAt(layout, y);
        expect(Math.abs(contentYForAnchor(layout, anchor) - y)).toBeLessThanOrEqual(0.5);
        // Y al revés: un ancla cualquiera vuelve a dar la misma página de fila y fracción.
        const page = Math.floor(random() * layout.count);
        const fraction = random();
        const back = anchorAt(layout, contentYForAnchor(layout, { page, fraction }));
        expect(back.page).toBe(rowRange(layout, page).first);
        expect(Math.abs(back.fraction - fraction)).toBeLessThanOrEqual(1e-9);
      }
    }
  });
});
