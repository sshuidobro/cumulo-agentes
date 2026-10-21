import type { PageDimsTable } from './page-dims';
import type { Rotation } from './rotation';

/** Estados del panel lateral: cerrado o con una pestaña. */
export const SIDEBAR_STATES = ['none', 'thumbnails', 'outline', 'comments', 'signatures'] as const;
export type SidebarState = (typeof SIDEBAR_STATES)[number];
/** Pestañas del panel (todo estado distinto de `none`). */
export type SidebarTab = Exclude<SidebarState, 'none'>;

/** Ancho de cada miniatura, en px CSS. */
export const THUMB_WIDTH = 128;
/** Hueco vertical entre miniaturas: deja sitio a la etiqueta de página. */
export const THUMB_GAP = 32;
/** Margen superior e inferior de la columna de miniaturas, en px. */
export const THUMB_PADDING = 12;
/** Páginas de margen que se montan a cada lado de las miniaturas visibles. */
export const THUMB_OVERSCAN = 2;

/** Guarda de lectura de la preferencia: solo acepta los cuatro estados válidos. */
export function isSidebarState(value: unknown): value is SidebarState {
  return typeof value === 'string' && (SIDEBAR_STATES as readonly string[]).includes(value);
}

/** Pestaña que pide el `PageMode` del PDF (`/UseThumbs`, `/UseOutlines`), o `null` si no pide ninguna. */
export function sidebarForPageMode(mode: string | null): SidebarState | null {
  if (mode === 'UseThumbs') return 'thumbnails';
  if (mode === 'UseOutlines') return 'outline';
  return null;
}

/** Estado del panel al abrir un documento: lo que pide el PDF, si no lo guardado, si no cerrado. */
export function sidebarOnOpen(pageMode: string | null, saved: SidebarState | null): SidebarState {
  return sidebarForPageMode(pageMode) ?? saved ?? 'none';
}

/**
 * Escala con la que se dibujan las miniaturas: la primera página, ya girada, ocupa `THUMB_WIDTH` px.
 * Todas las páginas usan esa misma escala, como en el visor.
 */
export function thumbnailScale(dims: PageDimsTable, viewRotation: Rotation): number {
  const turned = (dims.rotation(0) + viewRotation) % 360;
  const swap = turned === 90 || turned === 270;
  const widthPt = swap ? dims.height(0) : dims.width(0);
  return THUMB_WIDTH / Math.max(widthPt, 1);
}

/**
 * Página a la que lleva una tecla en la lista de miniaturas, o `null` si la tecla no es de navegación.
 * `visibleCount` es el número de miniaturas visibles (para Re Pág y Av Pág). Sin páginas, siempre `null`.
 */
export function nextThumbnailPage(
  key: string,
  current: number,
  count: number,
  visibleCount: number,
): number | null {
  if (count <= 0) return null;
  const step = Math.max(1, visibleCount);
  let target: number;
  switch (key) {
    case 'ArrowUp':
      target = current - 1;
      break;
    case 'ArrowDown':
      target = current + 1;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = count - 1;
      break;
    case 'PageUp':
      target = current - step;
      break;
    case 'PageDown':
      target = current + step;
      break;
    default:
      return null;
  }
  return Math.min(Math.max(target, 0), count - 1);
}
