/**
 * Geometría de la creación de formas arrastrando (PDF-108, ADR-0029): caja de rectángulo o elipse, línea o flecha y
 * tirador de tamaño. Todo en puntos PDF; ninguna función toca el estado ni el DOM.
 */
import type { RectPt } from './model';

/** Arrastre más corto que esto (en ambos ejes) cuenta como clic: se crea la forma por defecto. */
export const MIN_SHAPE_PT = 4;
/** Caja por defecto de un clic con rectángulo o elipse. */
export const DEFAULT_BOX_PT = { width: 144, height: 96 } as const;
/** Longitud de la línea por defecto de un clic o de la creación con teclado. */
export const DEFAULT_LINE_PT = 144;

/** Recorta un rectángulo a `page`. */
function clipRect(r: RectPt, page: RectPt): RectPt {
  const x1 = clamp(r[0], page[0], page[2]);
  const y1 = clamp(r[1], page[1], page[3]);
  const x2 = clamp(r[2], page[0], page[2]);
  const y2 = clamp(r[3], page[1], page[3]);
  return [x1, y1, x2, y2];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** Caja por defecto centrada en (`sx`, `sy`), recortada a la página. */
function defaultBox(sx: number, sy: number, page: RectPt): RectPt {
  const hw = DEFAULT_BOX_PT.width / 2;
  const hh = DEFAULT_BOX_PT.height / 2;
  return clipRect([sx - hw, sy - hh, sx + hw, sy + hh], page);
}

/**
 * Caja del arrastre de `(sx, sy)` a `(ex, ey)`, recortada a `page`. `keepRatio` (Mayús): cuadrado o círculo del lado
 * menor, anclado en el punto inicial. Si el arrastre es menor que `MIN_SHAPE_PT` en ambos ejes (o el lado del
 * cuadrado queda por debajo de ese mínimo), la caja es la de `DEFAULT_BOX_PT` centrada en `(sx, sy)`.
 */
export function dragBox(sx: number, sy: number, ex: number, ey: number, keepRatio: boolean, page: RectPt): RectPt {
  const w = Math.abs(ex - sx);
  const h = Math.abs(ey - sy);
  if (w < MIN_SHAPE_PT && h < MIN_SHAPE_PT) return defaultBox(sx, sy, page);
  if (keepRatio) {
    const side = Math.min(w, h);
    if (side < MIN_SHAPE_PT) return defaultBox(sx, sy, page);
    const dirX = ex < sx ? -1 : 1;
    const dirY = ey < sy ? -1 : 1;
    const x2 = sx + dirX * side;
    const y2 = sy + dirY * side;
    return clipRect([Math.min(sx, x2), Math.min(sy, y2), Math.max(sx, x2), Math.max(sy, y2)], page);
  }
  return clipRect([Math.min(sx, ex), Math.min(sy, ey), Math.max(sx, ex), Math.max(sy, ey)], page);
}

/**
 * Puntos `[inicio x, inicio y, fin x, fin y]` de una línea, recortados a `page`. `snap` (Mayús): el ángulo se ajusta a
 * múltiplos de 45°, manteniendo la longitud. Si el arrastre es menor que `MIN_SHAPE_PT` en ambos ejes, la línea es
 * horizontal, de `DEFAULT_LINE_PT`, desde `(sx, sy)`.
 */
export function dragLine(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  snap: boolean,
  page: RectPt,
): readonly [number, number, number, number] {
  const dx = ex - sx;
  const dy = ey - sy;
  if (Math.abs(dx) < MIN_SHAPE_PT && Math.abs(dy) < MIN_SHAPE_PT) {
    return clipPoints(sx, sy, sx + DEFAULT_LINE_PT, sy, page);
  }
  if (snap) {
    const length = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return clipPoints(sx, sy, sx + length * Math.cos(angle), sy + length * Math.sin(angle), page);
  }
  return clipPoints(sx, sy, ex, ey, page);
}

function clipPoints(x1: number, y1: number, x2: number, y2: number, page: RectPt): readonly [number, number, number, number] {
  return [
    clamp(x1, page[0], page[2]),
    clamp(y1, page[1], page[3]),
    clamp(x2, page[0], page[2]),
    clamp(y2, page[1], page[3]),
  ];
}

/**
 * Tirador inferior derecho: la esquina superior izquierda queda fija; ancho y alto mínimos `MIN_SHAPE_PT`.
 * `dx` es el cambio de ancho y `dh` el de alto, en puntos; `dh` positivo = más alto.
 */
export function resizeBoxRect(r: RectPt, dx: number, dh: number): RectPt {
  const [x1, y1, x2, y2] = r;
  const width = Math.max(MIN_SHAPE_PT, x2 - x1 + dx);
  const height = Math.max(MIN_SHAPE_PT, y2 - y1 + dh);
  return [x1, y2 - height, x1 + width, y2];
}

/** Distancia en píxeles de la pantalla para cerrar un polígono haciendo clic cerca del primer vértice (PDF-115). */
export const POLYGON_CLOSE_PX = 8;
/** Radio del polígono por defecto del teclado (PDF-115), en puntos. */
const DEFAULT_POLYGON_RADIUS_PT = 48;
/** Lados del polígono por defecto: un pentágono regular. */
const DEFAULT_POLYGON_SIDES = 5;

/** Punto recortado a `page`. */
export function clipPointToPage(x: number, y: number, page: RectPt): readonly [number, number] {
  return [clamp(x, page[0], page[2]), clamp(y, page[1], page[3])];
}

/**
 * Vértices tras un clic en (x, y) de un polígono en curso (PDF-115). El punto se recorta a la página. Si hay al menos
 * tres vértices y el clic está a `closePt` o menos del primero, el polígono se cierra: `closed` y los vértices no cambian.
 * Un clic a `closePt` o menos del último vértice (p. ej. el primer clic de un doble clic) no añade nada. En otro caso,
 * añade el vértice.
 */
export function addPolygonVertex(
  vertices: readonly number[],
  x: number,
  y: number,
  closePt: number,
  page: RectPt,
): { readonly vertices: readonly number[]; readonly closed: boolean } {
  const [px, py] = clipPointToPage(x, y, page);
  const n = vertices.length;
  if (n >= 6 && Math.hypot(px - (vertices[0] ?? 0), py - (vertices[1] ?? 0)) <= closePt) {
    return { vertices, closed: true };
  }
  if (n >= 2 && Math.hypot(px - (vertices[n - 2] ?? 0), py - (vertices[n - 1] ?? 0)) <= closePt) {
    return { vertices, closed: false };
  }
  return { vertices: [...vertices, px, py], closed: false };
}

/**
 * Polígono por defecto para el teclado (PDF-115): pentágono regular de radio `DEFAULT_POLYGON_RADIUS_PT` centrado en
 * (`cx`, `cy`), con el primer vértice arriba, recortado a la página.
 */
export function defaultPolygon(cx: number, cy: number, page: RectPt): readonly number[] {
  const vertices: number[] = [];
  for (let i = 0; i < DEFAULT_POLYGON_SIDES; i++) {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / DEFAULT_POLYGON_SIDES;
    const [x, y] = clipPointToPage(
      cx + DEFAULT_POLYGON_RADIUS_PT * Math.cos(angle),
      cy + DEFAULT_POLYGON_RADIUS_PT * Math.sin(angle),
      page,
    );
    vertices.push(x, y);
  }
  return vertices;
}
