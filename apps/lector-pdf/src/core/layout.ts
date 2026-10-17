import type { PageDimsTable } from './page-dims';
import { assertRotation, type Rotation } from './rotation';

export interface LayoutParams {
  /** Píxeles CSS por punto PDF. */
  readonly scale: number;
  /** Rotación de vista (se suma a la rotación propia de cada página). */
  readonly rotation: Rotation;
  /** Hueco vertical entre páginas, en px. */
  readonly gap: number;
  /** Margen superior e inferior de la columna, en px. */
  readonly padding: number;
}

export interface Layout {
  readonly count: number;
  /** Longitud `count + 1`: `tops[i]` es el y de la página i y `tops[count]` el final de la última página. */
  readonly tops: Float64Array;
  /** Anchos en px, ya rotados. */
  readonly widths: Float64Array;
  /** Altos en px, ya rotados. */
  readonly heights: Float64Array;
  /** `padding + páginas + gaps + padding`. */
  readonly totalHeight: number;
  readonly maxWidth: number;
  readonly params: LayoutParams;
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
  readonly page: number;
  /** Posición dentro de la página, en [0, 1]. */
  readonly fraction: number;
}

/** Calcula la columna vertical de páginas. Coste lineal en el número de páginas. */
export function computeLayout(dims: PageDimsTable, p: LayoutParams): Layout {
  assertParams(p);
  const n = dims.count;
  const tops = new Float64Array(n + 1);
  const widths = new Float64Array(n);
  const heights = new Float64Array(n);
  let maxWidth = 0;
  let y = p.padding;
  for (let i = 0; i < n; i++) {
    // Ambos sumandos son múltiplos de 90, así que el resultado también lo es.
    const turned = (dims.rotation(i) + p.rotation) % 360;
    const swap = turned === 90 || turned === 270;
    const w = (swap ? dims.height(i) : dims.width(i)) * p.scale;
    const h = (swap ? dims.width(i) : dims.height(i)) * p.scale;
    tops[i] = y;
    widths[i] = w;
    heights[i] = h;
    if (w > maxWidth) maxWidth = w;
    y += h + p.gap;
  }
  tops[n] = y;
  // Sin páginas, la columna solo tiene los dos márgenes (no hay hueco que restar).
  const totalHeight = n === 0 ? 2 * p.padding : y - p.gap + p.padding;
  return { count: n, tops, widths, heights, totalHeight, maxWidth, params: p };
}

/** Página que contiene `y` (búsqueda binaria). Un y en un hueco es la página anterior; fuera de rango se recorta. */
export function pageAtY(layout: Layout, y: number): number {
  if (layout.count === 0) return -1;
  const tops = layout.tops;
  let lo = 0;
  let hi = layout.count - 1;
  let found = 0;
  // Camino caliente: sin llamadas auxiliares. `mid` siempre está en [0, count), así que tops[mid] existe.
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((tops[mid] ?? Infinity) <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Rango de páginas entre `top` y `bottom` (en px de contenido) con `overscan` páginas de margen a cada lado. */
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
  const first = Math.max(0, pageAtY(layout, top) - overscan);
  const last = Math.min(layout.count - 1, pageAtY(layout, bottom) + overscan);
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

/** Página y posición relativa dentro de ella que hay en `contentY`. Sin páginas, `page` es -1. */
export function anchorAt(layout: Layout, contentY: number): Anchor {
  if (layout.count === 0) return { page: -1, fraction: 0 };
  const page = pageAtY(layout, contentY);
  const top = valueAt(layout.tops, page);
  const height = valueAt(layout.heights, page);
  const fraction = height > 0 ? clamp01((contentY - top) / height) : 0;
  return { page, fraction };
}

/** Posición en `contentY` del ancla (útil para mantener la vista al cambiar el zoom). Sin páginas, devuelve el margen superior. */
export function contentYForAnchor(layout: Layout, anchor: Anchor): number {
  if (layout.count === 0) return valueAt(layout.tops, 0);
  const page = Math.min(Math.max(anchor.page, 0), layout.count - 1);
  return valueAt(layout.tops, page) + clamp01(anchor.fraction) * valueAt(layout.heights, page);
}

export function maxContentY(layout: Layout, viewportHeight: number): number {
  return Math.max(0, layout.totalHeight - viewportHeight);
}

function assertParams(p: LayoutParams): void {
  if (!Number.isFinite(p.scale) || p.scale <= 0) throw new RangeError(`Escala no válida: ${p.scale}`);
  if (!Number.isFinite(p.gap) || p.gap < 0) throw new RangeError(`Hueco no válido: ${p.gap}`);
  if (!Number.isFinite(p.padding) || p.padding < 0) throw new RangeError(`Margen no válido: ${p.padding}`);
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
