import type { RectPt } from '../../core/annotations/model';

/**
 * Caja del editor de texto libre sobre la página (PDF-034). Puro: sin React ni pdf.js. El editor es un elemento HTML
 * con su propia caja de `width × height` píxeles CSS, colocado en la esquina (x1, y2) del rectángulo de la página y
 * girado con `matrix` para seguir la matriz de la página (zoom y rotación de vista).
 */

export type CssMatrix = readonly [number, number, number, number, number, number];

export interface FreeTextBox {
  /** Ancho y alto en píxeles CSS, sin girar. */
  readonly width: number;
  readonly height: number;
  /** Píxeles CSS por punto PDF (zoom efectivo). */
  readonly scale: number;
  /** `transform` CSS (`matrix(a b c d e f)`) con origen en la esquina superior izquierda de la caja. */
  readonly matrix: CssMatrix;
}

/**
 * Caja en píxeles de `rect` (puntos PDF) con la matriz de la página (`viewport.transform` de pdf.js). El eje local x
 * sigue a PDF x creciente y el eje local y baja por la página (PDF y decreciente), así que sirve con cualquier rotación.
 */
export function freeTextBox(rect: RectPt, transform: readonly number[]): FreeTextBox {
  const [a = 1, b = 0] = transform;
  const [x1, y1, x2, y2] = rect;
  const origin = pdfPointToPx(transform, x1, y2);
  const along = pdfPointToPx(transform, x2, y2);
  const down = pdfPointToPx(transform, x1, y1);
  const width = Math.hypot(along[0] - origin[0], along[1] - origin[1]);
  const height = Math.hypot(down[0] - origin[0], down[1] - origin[1]);
  const [ex, ey] = width > 0 ? [(along[0] - origin[0]) / width, (along[1] - origin[1]) / width] : [1, 0];
  const [fx, fy] = height > 0 ? [(down[0] - origin[0]) / height, (down[1] - origin[1]) / height] : [0, 1];
  return {
    width,
    height,
    scale: Math.hypot(a, b),
    matrix: [ex, ey, fx, fy, origin[0], origin[1]],
  };
}

/** Píxeles CSS de la esquina inferior derecha (en puntos PDF) de `rect`, con la matriz de la página. */
export function toPx(transform: readonly number[], rect: RectPt): { readonly x: number; readonly y: number } {
  const [x, y] = pdfPointToPx(transform, rect[2], rect[1]);
  return { x, y };
}

/** Píxeles CSS de un punto PDF (x, y) con la matriz de la página. */
export function pdfPointToPx(transform: readonly number[], x: number, y: number): readonly [number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform;
  return [a * x + c * y + e, b * x + d * y + f];
}
