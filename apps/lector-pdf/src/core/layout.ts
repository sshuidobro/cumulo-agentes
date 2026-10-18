import type { PageDimsTable } from './page-dims';
import { assertRotation, type Rotation } from './rotation';

/**
 * Páginas por fila: `none` una sola; `pairs` (1-2, 3-4…); `cover` (1, 2-3, 4-5…, como «Mostrar portada»).
 */
export type Spread = 'none' | 'pairs' | 'cover';

const SPREADS: readonly Spread[] = ['none', 'pairs', 'cover'];

export interface LayoutParams {
  /** Píxeles CSS por punto PDF. */
  readonly scale: number;
  /** Rotación de vista (se suma a la rotación propia de cada página). */
  readonly rotation: Rotation;
  /** Hueco vertical entre páginas (y horizontal entre las dos de una fila), en px. */
  readonly gap: number;
  /** Margen superior e inferior de la columna, en px. */
  readonly padding: number;
  /** Páginas por fila. Ausente = `'none'`. */
  readonly spread?: Spread;
}

export interface Layout {
  readonly count: number;
  /** Longitud `count + 1`: `tops[i]` es el y de la fila de la página i y `tops[count]` el final de la última página. */
  readonly tops: Float64Array;
  /** Anchos en px, ya rotados. */
  readonly widths: Float64Array;
  /** Altos en px, ya rotados. */
  readonly heights: Float64Array;
  /** `padding + filas + gaps + padding`. */
  readonly totalHeight: number;
  readonly maxWidth: number;
  readonly params: LayoutParams;
  /** x de cada página dentro de una columna de ancho `maxWidth` (el visor suma el margen de centrado). */
  readonly lefts: Float64Array;
  /** Fila de cada página. */
  readonly rowOf: Uint32Array;
  /** Longitud `rowCount + 1`: primera página de cada fila; `rowStart[rowCount] === count`. */
  readonly rowStart: Uint32Array;
  /** Longitud `rowCount + 1`: y de cada fila; `rowTops[rowCount]` = final de la última fila + gap (como `tops[count]`). */
  readonly rowTops: Float64Array;
  /** Alto de cada fila: el máximo de sus páginas. */
  readonly rowHeights: Float64Array;
  /** Ancho de cada fila: suma de sus páginas más el hueco entre ellas. */
  readonly rowWidths: Float64Array;
  readonly rowCount: number;
}

export const DEFAULT_GAP = 12;
export const DEFAULT_PADDING = 16;

/** Altura máxima de scroll que admite el navegador con seguridad (px). */
export const MAX_SCROLL_HEIGHT = 8_000_000;

export interface ScrollMap {
  /** Altura del elemento de scroll (px). */
  readonly scrollHeight: number;
  /** Píxeles de contenido por píxel de scroll. */
  readonly factor: number;
}

export interface Anchor {
  /** Primera página de la fila del ancla. */
  readonly page: number;
  /** Posición dentro de la fila, en [0, 1]. */
  readonly fraction: number;
}

/** Calcula la columna vertical de páginas agrupadas en filas. Coste lineal en el número de páginas. */
export function computeLayout(dims: PageDimsTable, p: LayoutParams): Layout {
  assertParams(p);
  const n = dims.count;
  const spread = p.spread ?? 'none';
  const tops = new Float64Array(n + 1);
  const widths = new Float64Array(n);
  const heights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Ambos sumandos son múltiplos de 90, así que el resultado también lo es.
    const turned = (dims.rotation(i) + p.rotation) % 360;
    const swap = turned === 90 || turned === 270;
    widths[i] = (swap ? dims.height(i) : dims.width(i)) * p.scale;
    heights[i] = (swap ? dims.width(i) : dims.height(i)) * p.scale;
  }

  const rowCount = rowCountOf(n, spread);
  const rowOf = new Uint32Array(n);
  const rowStart = new Uint32Array(rowCount + 1);
  const rowTops = new Float64Array(rowCount + 1);
  const rowHeights = new Float64Array(rowCount);
  const rowWidths = new Float64Array(rowCount);

  // Primera pasada: filas con su alto, su ancho y su y. Hace falta antes el ancho máximo para centrar.
  let y = p.padding;
  let maxWidth = 0;
  let i = 0;
  for (let r = 0; r < rowCount; r++) {
    const span = pagesInRow(i, n, spread);
    const w0 = valueAt(widths, i);
    let rowWidth = w0;
    let rowHeight = valueAt(heights, i);
    if (span === 2) {
      rowWidth = w0 + p.gap + valueAt(widths, i + 1);
      rowHeight = Math.max(rowHeight, valueAt(heights, i + 1));
    }
    rowStart[r] = i;
    rowTops[r] = y;
    rowHeights[r] = rowHeight;
    rowWidths[r] = rowWidth;
    if (rowWidth > maxWidth) maxWidth = rowWidth;
    for (let k = 0; k < span; k++) rowOf[i + k] = r;
    y += rowHeight + p.gap;
    i += span;
  }
  rowStart[rowCount] = n;
  rowTops[rowCount] = y;

  // Segunda pasada: cada fila centrada en `maxWidth` y sus páginas alineadas arriba.
  const lefts = new Float64Array(n);
  for (let r = 0; r < rowCount; r++) {
    const first = valueAt(rowStart, r);
    const end = valueAt(rowStart, r + 1);
    const top = valueAt(rowTops, r);
    let x = (maxWidth - valueAt(rowWidths, r)) / 2;
    for (let k = first; k < end; k++) {
      lefts[k] = x;
      tops[k] = top;
      x = x + valueAt(widths, k) + p.gap;
    }
  }
  tops[n] = y;

  // Sin páginas, la columna solo tiene los dos márgenes (no hay hueco que restar).
  const totalHeight = n === 0 ? 2 * p.padding : y - p.gap + p.padding;
  return {
    count: n,
    tops,
    widths,
    heights,
    totalHeight,
    maxWidth,
    params: p,
    lefts,
    rowOf,
    rowStart,
    rowTops,
    rowHeights,
    rowWidths,
    rowCount,
  };
}

/** Página que contiene `y`, devuelta como la primera página de su fila (búsqueda binaria). Un y en un hueco es la fila anterior; fuera de rango se recorta. Sin páginas, -1. */
export function pageAtY(layout: Layout, y: number): number {
  if (layout.count === 0) return -1;
  return valueAt(layout.rowStart, rowAtY(layout, y));
}

/** Páginas de la fila que contiene `page`, ambas incluidas. */
export function rowRange(layout: Layout, page: number): { readonly first: number; readonly last: number } {
  const row = valueAt(layout.rowOf, page);
  return { first: valueAt(layout.rowStart, row), last: valueAt(layout.rowStart, row + 1) - 1 };
}

/** Ancho en px de la fila que contiene `page` (incluye el hueco entre sus páginas). */
export function rowWidthOf(layout: Layout, page: number): number {
  return valueAt(layout.rowWidths, valueAt(layout.rowOf, page));
}

/** Rango de páginas entre `top` y `bottom` (en px de contenido) con `overscan` páginas de margen a cada lado. Las filas se incluyen enteras. */
export function visibleRange(
  layout: Layout,
  top: number,
  bottom: number,
  overscan: number,
): { readonly first: number; readonly last: number } {
  if (!Number.isInteger(overscan) || overscan < 0) {
    throw new RangeError(`Margen de páginas no válido: ${overscan}`);
  }
  if (layout.count === 0) return { first: 0, last: -1 };
  const firstRow = rowAtY(layout, top);
  const lastRow = rowAtY(layout, bottom);
  const first = Math.max(0, valueAt(layout.rowStart, firstRow) - overscan);
  const last = Math.min(layout.count - 1, valueAt(layout.rowStart, lastRow + 1) - 1 + overscan);
  return { first, last };
}

/**
 * Traduce entre el scroll del navegador y el contenido. Si la altura total supera
 * `MAX_SCROLL_HEIGHT`, el scroll se escala para que el final del scroll coincida con el final del contenido.
 */
export function scrollMap(layout: Layout, viewportHeight: number): ScrollMap {
  if (layout.totalHeight <= MAX_SCROLL_HEIGHT) {
    return { scrollHeight: layout.totalHeight, factor: 1 };
  }
  const room = MAX_SCROLL_HEIGHT - viewportHeight;
  if (!(room > 0)) throw new RangeError(`Viewport no válido: ${viewportHeight}`);
  return {
    scrollHeight: MAX_SCROLL_HEIGHT,
    factor: (layout.totalHeight - viewportHeight) / room,
  };
}

export function scrollTopToContentY(scrollTop: number, map: ScrollMap): number {
  return scrollTop * map.factor;
}

export function contentYToScrollTop(contentY: number, map: ScrollMap): number {
  return contentY / map.factor;
}

/** Página (primera de su fila) y posición relativa dentro de la fila en `contentY`. Sin páginas, `page` es -1. */
export function anchorAt(layout: Layout, contentY: number): Anchor {
  if (layout.count === 0) return { page: -1, fraction: 0 };
  const row = rowAtY(layout, contentY);
  const top = valueAt(layout.rowTops, row);
  const height = valueAt(layout.rowHeights, row);
  const fraction = height > 0 ? clamp01((contentY - top) / height) : 0;
  return { page: valueAt(layout.rowStart, row), fraction };
}

/** Posición en `contentY` del ancla (útil para mantener la vista al cambiar el zoom). Sin páginas, devuelve el margen superior. */
export function contentYForAnchor(layout: Layout, anchor: Anchor): number {
  if (layout.count === 0) return valueAt(layout.rowTops, 0);
  const page = Math.min(Math.max(anchor.page, 0), layout.count - 1);
  const row = valueAt(layout.rowOf, page);
  return valueAt(layout.rowTops, row) + clamp01(anchor.fraction) * valueAt(layout.rowHeights, row);
}

export function maxContentY(layout: Layout, viewportHeight: number): number {
  return Math.max(0, layout.totalHeight - viewportHeight);
}

/** Fila que contiene `y` (búsqueda binaria en `rowTops`). Requiere al menos una fila. */
function rowAtY(layout: Layout, y: number): number {
  const rowTops = layout.rowTops;
  let lo = 0;
  let hi = layout.rowCount - 1;
  let found = 0;
  // Camino caliente: sin llamadas auxiliares. `mid` siempre está en [0, rowCount), así que rowTops[mid] existe.
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((rowTops[mid] ?? Infinity) <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Número de filas para `n` páginas. Con `pairs` la última fila puede tener una página; con `cover` la portada va sola. */
function rowCountOf(n: number, spread: Spread): number {
  if (spread === 'none') return n;
  if (spread === 'pairs') return (n + 1) >>> 1;
  return n === 0 ? 0 : 1 + (n >>> 1);
}

/** Páginas (1 o 2) que van en la fila que empieza en `first`. */
function pagesInRow(first: number, n: number, spread: Spread): 1 | 2 {
  if (spread === 'none' || first + 1 >= n) return 1;
  if (spread === 'cover' && first === 0) return 1;
  return 2;
}

function assertParams(p: LayoutParams): void {
  if (!Number.isFinite(p.scale) || p.scale <= 0) throw new RangeError(`Escala no válida: ${p.scale}`);
  if (!Number.isFinite(p.gap) || p.gap < 0) throw new RangeError(`Hueco no válido: ${p.gap}`);
  if (!Number.isFinite(p.padding) || p.padding < 0) throw new RangeError(`Margen no válido: ${p.padding}`);
  if (p.spread !== undefined && !SPREADS.includes(p.spread)) {
    throw new RangeError(`Modo de páginas no válido: ${String(p.spread)}`);
  }
  assertRotation(p.rotation);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Lee una posición de un array; los índices siempre son válidos por construcción, así que un undefined es un bug. */
function valueAt(arr: ArrayLike<number>, i: number): number {
  const value = arr[i];
  if (value === undefined) throw new RangeError(`Índice fuera de rango: ${i}`);
  return value;
}
