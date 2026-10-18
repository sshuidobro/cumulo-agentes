import type { RectPt } from '../../core/annotations/model';

/**
 * Colocación de la ventana de comentario (PDF-033). Puro: sin React ni pdf.js. Coordenadas en píxeles CSS del
 * marco de la página (origen arriba-izquierda), salvo que se diga lo contrario.
 */

/** Ancho de la ventana, en píxeles CSS. */
export const POPUP_WIDTH_PX = 280;
/** Alto máximo de la ventana (su CSS lo limita a este valor): sirve para no salirse por abajo. */
export const POPUP_MAX_HEIGHT_PX = 240;
/** Separación entre la anotación y la ventana. */
export const POPUP_GAP_PX = 8;

export interface PxBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PageSizePx {
  readonly width: number;
  readonly height: number;
}

/** Caja en píxeles del `rect` (puntos PDF) con la matriz de la página (`viewport.transform` de pdf.js). */
export function pageBox(transform: readonly number[], rect: RectPt): PxBox {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform;
  const [x1, y1, x2, y2] = rect;
  const corners = [
    [a * x1 + c * y1 + e, b * x1 + d * y1 + f],
    [a * x2 + c * y1 + e, b * x2 + d * y1 + f],
    [a * x1 + c * y2 + e, b * x1 + d * y2 + f],
    [a * x2 + c * y2 + e, b * x2 + d * y2 + f],
  ] as const;
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** `true` si la caja toca la página (aunque sea un píxel). */
export function isBoxOnPage(box: PxBox, page: PageSizePx): boolean {
  return box.right > 0 && box.left < page.width && box.bottom > 0 && box.top < page.height;
}

/**
 * Posición de la ventana: a la derecha de la anotación si cabe; si no, a su izquierda. Siempre dentro de la página:
 * si no cabe en ningún lado se pega al borde, y su parte superior se limita para que no salga por abajo.
 */
export function popupPlacement(box: PxBox, page: PageSizePx): { readonly left: number; readonly top: number; readonly width: number } {
  const width = Math.min(POPUP_WIDTH_PX, page.width);
  const rightSide = box.right + POPUP_GAP_PX;
  const preferred = rightSide + width <= page.width ? rightSide : box.left - POPUP_GAP_PX - width;
  const left = clamp(preferred, 0, page.width - width);
  const top = clamp(box.top, 0, page.height - POPUP_MAX_HEIGHT_PX);
  return { left, top, width };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
