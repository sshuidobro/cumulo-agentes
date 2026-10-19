/**
 * Formas y sellos (PDF-057, ADR-0029): nombres y colores de los sellos, geometría de cajas de líneas, polígonos
 * y sellos, fábricas de anotaciones nuevas y validación de sus campos. No importa `model.ts` en valor (solo tipos)
 * para no crear un ciclo: `model.ts` valida con `isShapeValid`.
 */
import { textWidth } from './helvetica-widths';
import type {
  BoxShapeAnnotation,
  LineShapeAnnotation,
  PolygonAnnotation,
  RectPt,
  Rgb,
  ShapeLineEnding,
  StampAnnotation,
} from './model';

/** Sellos estándar de ISO 32000-1 §12.5.6.12 que sabemos crear. */
export const STAMP_NAMES = [
  'Approved',
  'NotApproved',
  'Draft',
  'Final',
  'Confidential',
  'ForComment',
  'Expired',
  'NotForPublicRelease',
  'ForPublicRelease',
  'Experimental',
  'AsIs',
  'Departmental',
  'TopSecret',
  'Sold',
] as const;
export type StampName = (typeof STAMP_NAMES)[number];

/** Texto que se dibuja dentro del sello. */
export const STAMP_LABELS: Readonly<Record<StampName, string>> = {
  Approved: 'APROBADO',
  NotApproved: 'NO APROBADO',
  Draft: 'BORRADOR',
  Final: 'FINAL',
  Confidential: 'CONFIDENCIAL',
  ForComment: 'PARA COMENTARIOS',
  Expired: 'CADUCADO',
  NotForPublicRelease: 'NO PUBLICAR',
  ForPublicRelease: 'PARA PUBLICAR',
  Experimental: 'EXPERIMENTAL',
  AsIs: 'TAL CUAL',
  Departmental: 'DEPARTAMENTAL',
  TopSecret: 'ALTO SECRETO',
  Sold: 'VENDIDO',
};

const GREEN: Rgb = [0.13, 0.55, 0.13];
const RED: Rgb = [0.8, 0.1, 0.1];
const BLUE: Rgb = [0.1, 0.3, 0.7];
const GREEN_STAMPS: ReadonlySet<StampName> = new Set<StampName>(['Approved', 'Final', 'ForPublicRelease']);
const RED_STAMPS: ReadonlySet<StampName> = new Set<StampName>([
  'NotApproved',
  'Confidential',
  'TopSecret',
  'Expired',
  'NotForPublicRelease',
]);

/** Verde para aprobado/final/publicar, rojo para los negativos, azul para el resto. */
export function stampColor(n: StampName): Rgb {
  if (GREEN_STAMPS.has(n)) return GREEN;
  if (RED_STAMPS.has(n)) return RED;
  return BLUE;
}

/** Posición del texto de un sello (línea base) y su tamaño: reducido si no cabe en la caja. */
export function stampTextBox(
  name: StampName,
  rect: RectPt,
): { readonly x: number; readonly y: number; readonly fontSize: number } {
  const [x1, y1, x2, y2] = rect;
  const width = x2 - x1;
  const height = y2 - y1;
  const label = STAMP_LABELS[name];
  const fontSize = Math.min(STAMP_FONT_SIZE_PT, height - 12, (width - 16) / textWidth(label, 1));
  return {
    x: x1 + (width - textWidth(label, fontSize)) / 2,
    y: y1 + (height - 0.7 * fontSize) / 2,
    fontSize,
  };
}

export const STAMP_HEIGHT_PT = 36;
export const STAMP_FONT_SIZE_PT = 18;
/** Margen horizontal total del sello alrededor del texto, en puntos. */
const STAMP_PADDING_PT = 24;

export const SHAPE_LINE_ENDINGS = ['None', 'OpenArrow', 'ClosedArrow'] as const;

/** Longitud de la punta de flecha: max(6, 3 × width) pt. */
export function arrowHeadSize(width: number): number {
  return Math.max(6, 3 * width);
}

/** Semiángulo de la punta de flecha. */
const ARROW_ANGLE = Math.PI / 6;

/**
 * Alas de la punta en `tip`: a ±30° hacia atrás (hacia `other`), de longitud `arrowHeadSize(width)`.
 * `null` si los dos extremos coinciden (no hay dirección).
 */
export function arrowWings(
  tip: readonly [number, number],
  other: readonly [number, number],
  width: number,
): readonly [readonly [number, number], readonly [number, number]] | null {
  const dx = other[0] - tip[0];
  const dy = other[1] - tip[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const size = arrowHeadSize(width);
  const wing = (sign: number): [number, number] => {
    const c = Math.cos(sign * ARROW_ANGLE);
    const s = Math.sin(sign * ARROW_ANGLE);
    return [tip[0] + size * (ux * c - uy * s), tip[1] + size * (ux * s + uy * c)];
  };
  return [wing(1), wing(-1)];
}

/**
 * Caja de una línea: los puntos ampliados `width / 2`, más `arrowHeadSize` si algún extremo no es `None`
 * (la punta sobresale del segmento).
 */
export function lineRect(
  points: readonly [number, number, number, number],
  width: number,
  endings: readonly [ShapeLineEnding, ShapeLineEnding],
): RectPt {
  const arrow = endings.some((e) => e !== 'None');
  return boxOf(points, width / 2 + (arrow ? arrowHeadSize(width) : 0));
}

/** Caja de los vértices ampliada `width / 2`. */
export function verticesRect(vertices: readonly number[], width: number): RectPt {
  return boxOf(vertices, width / 2);
}

/** Caja de un sello centrada en (`cx`, `cy`): alto 36 y ancho del texto a 18 pt más 24. */
export function stampRectAt(name: StampName, cx: number, cy: number): RectPt {
  const halfWidth = (textWidth(STAMP_LABELS[name], STAMP_FONT_SIZE_PT) + STAMP_PADDING_PT) / 2;
  const halfHeight = STAMP_HEIGHT_PT / 2;
  return [cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight];
}

export interface NewShapeBase {
  readonly id: string;
  readonly pageIndex: number;
  readonly color: Rgb;
  readonly author: string;
  /** ISO 8601. */
  readonly now: string;
}

/** Campos comunes de una forma nueva; las fábricas los completan igual. */
function commonFields(
  i: Omit<NewShapeBase, 'color'> & { readonly color: Rgb },
  rect: RectPt,
): Pick<
  BoxShapeAnnotation,
  'id' | 'pageIndex' | 'rect' | 'color' | 'opacity' | 'contents' | 'author' | 'modified' | 'created' | 'origin'
> {
  return {
    id: i.id,
    pageIndex: i.pageIndex,
    rect,
    color: i.color,
    opacity: 1,
    contents: '',
    author: i.author,
    modified: i.now,
    created: i.now,
    origin: { kind: 'new' },
  };
}

/** Nueva caja de rectángulo o elipse. El trazo va por dentro de `rect`; sin relleno. */
export function newBoxShape(
  i: NewShapeBase & { readonly kind: 'square' | 'circle'; readonly rect: RectPt; readonly width: number },
): BoxShapeAnnotation {
  return { ...commonFields(i, i.rect), type: i.kind, width: i.width, interior: null };
}

/** Nueva línea; con `arrow` el extremo final lleva punta abierta. */
export function newLineShape(
  i: NewShapeBase & {
    readonly points: readonly [number, number, number, number];
    readonly arrow: boolean;
    readonly width: number;
  },
): LineShapeAnnotation {
  const endings: readonly [ShapeLineEnding, ShapeLineEnding] = i.arrow ? ['None', 'OpenArrow'] : ['None', 'None'];
  return {
    ...commonFields(i, lineRect(i.points, i.width, endings)),
    type: 'line',
    points: i.points,
    width: i.width,
    endings,
    interior: null,
  };
}

/** Nuevo polígono cerrado (sin relleno). */
export function newPolygonShape(i: NewShapeBase & { readonly vertices: readonly number[]; readonly width: number }): PolygonAnnotation {
  return {
    ...commonFields(i, verticesRect(i.vertices, i.width)),
    type: 'polygon',
    vertices: i.vertices,
    width: i.width,
    interior: null,
  };
}

/** Nuevo sello centrado en `center`; su color lo fija el nombre. */
export function newStamp(
  i: Omit<NewShapeBase, 'color'> & { readonly name: StampName; readonly center: readonly [number, number] },
): StampAnnotation {
  const [cx, cy] = i.center;
  return {
    ...commonFields({ ...i, color: stampColor(i.name) }, stampRectAt(i.name, cx, cy)),
    type: 'stamp',
    name: i.name,
  };
}

/** Nueva caja de rectángulo, elipse o sello (mismo tipo). */
export function resizeBox<T extends BoxShapeAnnotation | StampAnnotation>(a: T, rect: RectPt): T {
  return { ...a, rect };
}

/** Validación de los campos propios de una forma o sello (`type` square, circle, line, polygon o stamp). */
export function isShapeValid(v: Record<string, unknown>): boolean {
  switch (v.type) {
    case 'square':
    case 'circle':
      return isPositive(v.width) && isInterior(v.interior);
    case 'line':
      return isFiniteList(v.points, 4) && isPositive(v.width) && isEndings(v.endings) && isInterior(v.interior);
    case 'polygon':
      return isVertices(v.vertices) && isPositive(v.width) && isInterior(v.interior);
    case 'stamp':
      return typeof v.name === 'string' && (STAMP_NAMES as readonly string[]).includes(v.name);
    default:
      return false;
  }
}

/** Caja de los puntos `[x0, y0, x1, y1, ...]` ampliada `pad` a cada lado. */
function boxOf(points: readonly number[], pad: number): RectPt {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositive(v: unknown): boolean {
  return isFiniteNumber(v) && v > 0;
}

/** Lista de exactamente `n` números finitos. */
function isFiniteList(v: unknown, n: number): boolean {
  if (!Array.isArray(v) || v.length !== n) return false;
  const items: readonly unknown[] = v;
  return items.every(isFiniteNumber);
}

/** Vértices `[x0, y0, x1, y1, ...]`: al menos 3 puntos, longitud par. */
function isVertices(v: unknown): boolean {
  if (!Array.isArray(v) || v.length < 6 || v.length % 2 !== 0) return false;
  const items: readonly unknown[] = v;
  return items.every(isFiniteNumber);
}

function isEndings(v: unknown): boolean {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const items: readonly unknown[] = v;
  return items.every((e) => (SHAPE_LINE_ENDINGS as readonly unknown[]).includes(e));
}

/** Relleno: `null` (sin relleno) o un RGB en [0, 1]. */
function isInterior(v: unknown): boolean {
  if (v === null) return true;
  return isFiniteList(v, 3) && (v as readonly number[]).every((x) => x >= 0 && x <= 1);
}
