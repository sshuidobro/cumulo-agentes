import { DEFAULT_GAP, type Layout, type Spread } from './layout';
import type { PageDimsTable } from './page-dims';
import type { Rotation } from './rotation';
import type { Size } from './zoom';

/** Modo de vista: desplazamiento continuo o por páginas, y páginas por fila (PDF-050, ADR-0024). */
export interface ViewMode {
  readonly scroll: 'continuous' | 'paged';
  readonly spread: Spread;
}

export const DEFAULT_VIEW_MODE: ViewMode = { scroll: 'continuous', spread: 'none' };

/** Valida un valor leído de las preferencias. Lo que no encaje cuenta como ausente. */
export function isViewMode(v: unknown): v is ViewMode {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as { readonly scroll?: unknown; readonly spread?: unknown };
  const scrollOk = candidate.scroll === 'continuous' || candidate.scroll === 'paged';
  const spreadOk = candidate.spread === 'none' || candidate.spread === 'pairs' || candidate.spread === 'cover';
  return scrollOk && spreadOk;
}

/** Primera página de la fila de `page`. none: page; pairs: page − page % 2; cover: 0 si page = 0, si no page − ((page − 1) % 2). */
export function rowFirstPage(page: number, spread: Spread): number {
  assertPage(page);
  switch (spread) {
    case 'none':
      return page;
    case 'pairs':
      return page - (page % 2);
    case 'cover':
      return page === 0 ? 0 : page - ((page - 1) % 2);
  }
}

/** Primera página de la fila siguiente (dir 1) o anterior (dir −1), acotada a [0, count − 1]; null si no hay. */
export function stepRow(page: number, dir: 1 | -1, spread: Spread, count: number): number | null {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Número de páginas no válido: ${count}`);
  if (count === 0) return null;
  const first = rowFirstPage(page, spread);
  if (dir === 1) {
    const next = nextRowStart(first, spread);
    return next < count ? next : null;
  }
  if (first === 0) return null;
  return rowFirstPage(first - 1, spread);
}

/**
 * Tamaño de referencia para los ajustes de zoom: la fila de `page` (anchos rotados sumados, alto máximo) en pt,
 * y el hueco extra en px (`DEFAULT_GAP` si la fila tiene dos páginas, si no 0).
 */
export function referenceSize(
  dims: PageDimsTable,
  viewRotation: Rotation,
  spread: Spread,
  page: number,
): { readonly pagePt: Size; readonly extraWidthPx: number } {
  const first = rowFirstPage(page, spread);
  const span = first < dims.count ? rowPageCount(first, dims.count, spread) : 0;
  let width = 0;
  let height = 0;
  for (let i = first; i < first + span; i++) {
    const turned = (dims.rotation(i) + viewRotation) % 360;
    const swap = turned === 90 || turned === 270;
    width += swap ? dims.height(i) : dims.width(i);
    height = Math.max(height, swap ? dims.width(i) : dims.height(i));
  }
  return {
    pagePt: { width, height },
    extraWidthPx: span === 2 ? DEFAULT_GAP : 0,
  };
}

/** Ventana de contenido del modo por páginas: desde `rowTops[row] − padding` con alto `rowHeights[row] + 2·padding`. */
export function pagedWindow(layout: Layout, row: number): { readonly top: number; readonly height: number } {
  if (!Number.isInteger(row) || row < 0 || row >= layout.rowCount) {
    throw new RangeError(`Fila no válida: ${row}`);
  }
  const padding = layout.params.padding;
  const top = layout.rowTops[row];
  const height = layout.rowHeights[row];
  if (top === undefined || height === undefined) throw new RangeError(`Fila no válida: ${row}`);
  return { top: top - padding, height: height + 2 * padding };
}

/** Primera página de la fila que empieza después de la que empieza en `first` (sin comprobar que exista). */
function nextRowStart(first: number, spread: Spread): number {
  switch (spread) {
    case 'none':
      return first + 1;
    case 'pairs':
      return first + 2;
    case 'cover':
      return first === 0 ? 1 : first + 2;
  }
}

/** Páginas (1 o 2) de la fila que empieza en `first`. */
function rowPageCount(first: number, count: number, spread: Spread): 1 | 2 {
  if (spread === 'none' || first + 1 >= count) return 1;
  if (spread === 'cover' && first === 0) return 1;
  return 2;
}

function assertPage(page: number): void {
  if (!Number.isInteger(page) || page < 0) throw new RangeError(`Página no válida: ${page}`);
}
