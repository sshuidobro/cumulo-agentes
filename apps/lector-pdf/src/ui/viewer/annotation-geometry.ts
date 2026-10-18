/**
 * Geometría de la capa de anotaciones (PDF-031). Puro: sin React ni pdf.js. Todo en puntos PDF salvo
 * que se diga lo contrario.
 */
import type { Annotation, Quad, RectPt } from '../../core/annotations/model';

/** Lado mínimo de la zona de selección, en puntos PDF. */
export const MIN_OUTLINE_PT = 8;

/**
 * Caja de selección de una anotación: su `rect`, ampliado hacia fuera por igual en cada eje si es más
 * pequeño que `MIN_OUTLINE_PT`.
 */
export function annotationOutline(a: Annotation): RectPt {
  const [x1, y1, x2, y2] = a.rect;
  const padX = Math.max(0, (MIN_OUTLINE_PT - (x2 - x1)) / 2);
  const padY = Math.max(0, (MIN_OUTLINE_PT - (y2 - y1)) / 2);
  return [x1 - padX, y1 - padY, x2 + padX, y2 + padY];
}

/**
 * Trazado SVG (`d`) que cubre los quads, un polígono cerrado por quad. El orden Z del quad es
 * `x1,y2, x2,y2, x1,y1, x2,y1`; el polígono recorre sup-izq, sup-der, inf-der, inf-izq.
 */
export function svgPathForQuads(quads: readonly Quad[]): string {
  return quads
    .map((q) => `M ${q[0]} ${q[1]} L ${q[2]} ${q[3]} L ${q[6]} ${q[7]} L ${q[4]} ${q[5]} Z`)
    .join(' ');
}

/** Puntos SVG (`points`) de un trazo `[x0, y0, x1, y1, ...]`. */
export function svgPointsForPath(path: readonly number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    pairs.push(`${path[i] ?? 0},${path[i + 1] ?? 0}`);
  }
  return pairs.join(' ');
}

/** Color CSS de un color RGB en [0, 1]. */
export function cssColor(c: readonly [number, number, number]): string {
  const [r, g, b] = c.map((v) => Math.round(v * 255));
  return `rgb(${r ?? 0} ${g ?? 0} ${b ?? 0})`;
}
