/**
 * Modelo de anotaciones (ADR-0009). Coordenadas en puntos PDF del espacio de usuario de la página
 * (origen abajo-izquierda, sin rotar). Colores RGB en [0, 1]. Todo inmutable.
 */

import type { FieldValue } from '../forms/model';

export type Rgb = readonly [number, number, number];
/** x1, y1, x2, y2 con x1 <= x2 e y1 <= y2. */
export type RectPt = readonly [number, number, number, number];
/** Orden Z: x1,y2, x2,y2, x1,y1, x2,y1. */
export type Quad = readonly [number, number, number, number, number, number, number, number];

export interface PdfObjRef {
  readonly num: number;
  readonly gen: number;
}

export type AnnotationOrigin =
  | { readonly kind: 'new' }
  | { readonly kind: 'file'; readonly ref: PdfObjRef; readonly popupRef: PdfObjRef | null };

interface Base {
  /** Nuevas: `suite-<uuid>`; del fichero: `ref:<num>R` o `ref:<num>R<gen>` si gen > 0. */
  readonly id: string;
  readonly pageIndex: number;
  readonly rect: RectPt;
  readonly color: Rgb;
  /** 0..1 */
  readonly opacity: number;
  /** Comentario. */
  readonly contents: string;
  readonly author: string;
  /** ISO 8601. */
  readonly modified: string;
  /** ISO 8601 o `null` si el fichero no lo indica. */
  readonly created: string | null;
  readonly origin: AnnotationOrigin;
}

export interface TextMarkupAnnotation extends Base {
  readonly type: 'highlight' | 'underline' | 'strikeout';
  readonly quads: readonly Quad[];
}

export type NoteIcon = 'Comment' | 'Note' | 'Key' | 'Help' | 'NewParagraph' | 'Paragraph' | 'Insert';

export interface NoteAnnotation extends Base {
  readonly type: 'note';
  readonly icon: NoteIcon;
  readonly open: boolean;
}

/** El texto de la anotación es `contents`. */
export interface FreeTextAnnotation extends Base {
  readonly type: 'freetext';
  readonly fontSize: number;
  readonly textColor: Rgb;
}

/** Cada trazo es `[x0, y0, x1, y1, ...]`. */
export interface InkAnnotation extends Base {
  readonly type: 'ink';
  readonly paths: readonly (readonly number[])[];
  readonly width: number;
}

export type Annotation = TextMarkupAnnotation | NoteAnnotation | FreeTextAnnotation | InkAnnotation;
export type AnnotationType = Annotation['type'];

/**
 * Lo que el usuario ha cambiado sobre la línea base del fichero. Su nombre no cambia por llevar también
 * los valores de formulario (`fields`, ADR-0019): es el documento de deshacer común.
 */
export interface AnnotationEdits {
  readonly upserts: ReadonlyMap<string, Annotation>;
  readonly removed: ReadonlySet<string>;
  /** Nombre completo del campo → valor, solo los que difieren del fichero. */
  readonly fields: ReadonlyMap<string, FieldValue>;
}

export const EMPTY_EDITS: AnnotationEdits = { upserts: new Map(), removed: new Set(), fields: new Map() };

export function fileAnnotationId(ref: PdfObjRef): string {
  return ref.gen === 0 ? `ref:${ref.num}R` : `ref:${ref.num}R${ref.gen}`;
}

export function quadFromRect(r: RectPt): Quad {
  const [x1, y1, x2, y2] = r;
  return [x1, y2, x2, y2, x1, y1, x2, y1];
}

/** Caja mínima que contiene todos los quads; `[0,0,0,0]` si no hay ninguno. */
export function rectFromQuads(quads: readonly Quad[]): RectPt {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const q of quads) {
    xs.push(q[0], q[2], q[4], q[6]);
    ys.push(q[1], q[3], q[5], q[7]);
  }
  return boundingBox(xs, ys, 0);
}

/** Caja mínima que contiene todos los puntos de los trazos, ampliada `pad` a cada lado. */
export function rectFromPaths(paths: readonly (readonly number[])[], pad: number): RectPt {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of paths) {
    for (let i = 0; i + 1 < p.length; i += 2) {
      xs.push(p[i] ?? 0);
      ys.push(p[i + 1] ?? 0);
    }
  }
  return boundingBox(xs, ys, pad);
}

/** Desplaza la anotación `dx, dy` puntos: rect, quads o trazos. */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  const rect = shiftRect(a.rect, dx, dy);
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { ...a, rect, quads: a.quads.map((q) => shiftQuad(q, dx, dy)) };
    case 'ink':
      return {
        ...a,
        rect,
        paths: a.paths.map((p) => p.map((v, i) => (i % 2 === 0 ? v + dx : v + dy))),
      };
    case 'note':
    case 'freetext':
      return { ...a, rect };
  }
}

/** Validación completa de una anotación (para borradores y datos externos). */
export function isAnnotation(v: unknown): v is Annotation {
  if (!isRecord(v) || !isBaseValid(v)) return false;
  switch (v.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return isArrayOf(v.quads, (q) => numbers(q, 8) !== null) && hasItems(v.quads);
    case 'note':
      return typeof v.icon === 'string' && NOTE_ICONS.includes(v.icon) && typeof v.open === 'boolean';
    case 'freetext':
      return isPositive(v.fontSize) && isRgb(v.textColor);
    case 'ink':
      return isArrayOf(v.paths, isPath) && hasItems(v.paths) && isPositive(v.width);
    default:
      return false;
  }
}

const NOTE_ICONS: readonly unknown[] = ['Comment', 'Note', 'Key', 'Help', 'NewParagraph', 'Paragraph', 'Insert'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Bucle explícito (sin spread): los trazos pueden tener cientos de miles de puntos. */
function boundingBox(xs: readonly number[], ys: readonly number[], pad: number): RectPt {
  if (xs.length === 0 || ys.length === 0) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of xs) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  for (const y of ys) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

function shiftRect(r: RectPt, dx: number, dy: number): RectPt {
  return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
}

function shiftQuad(q: Quad, dx: number, dy: number): Quad {
  return [q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy, q[4] + dx, q[5] + dy, q[6] + dx, q[7] + dy];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isPositive(v: unknown): boolean {
  return isFiniteNumber(v) && v > 0;
}

function isUnit(v: unknown): boolean {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

function isArrayOf(v: unknown, check: (x: unknown) => boolean): boolean {
  return Array.isArray(v) && v.every(check);
}

function hasItems(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/** Devuelve los `n` números (finitos) de `v`, o `null` si no lo son. */
function numbers(v: unknown, n: number): readonly number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const items: readonly unknown[] = v;
  return items.every(isFiniteNumber) ? items : null;
}

function isRect(v: unknown): boolean {
  const r = numbers(v, 4);
  if (r === null) return false;
  const [x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN] = r;
  return x1 <= x2 && y1 <= y2;
}

function isRgb(v: unknown): boolean {
  const c = numbers(v, 3);
  return c !== null && c.every((x) => x >= 0 && x <= 1);
}

function isPath(v: unknown): boolean {
  return Array.isArray(v) && v.length >= 2 && v.length % 2 === 0 && v.every(isFiniteNumber);
}

function isIsoDate(v: unknown): boolean {
  return typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}

function isPdfRef(v: unknown): boolean {
  return isRecord(v) && isInt(v.num) && v.num >= 1 && isInt(v.gen) && v.gen >= 0;
}

function isOrigin(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (v.kind === 'new') return true;
  return v.kind === 'file' && isPdfRef(v.ref) && (v.popupRef === null || isPdfRef(v.popupRef));
}

function isBaseValid(v: Record<string, unknown>): boolean {
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    isInt(v.pageIndex) &&
    v.pageIndex >= 0 &&
    isRect(v.rect) &&
    isRgb(v.color) &&
    isUnit(v.opacity) &&
    typeof v.contents === 'string' &&
    typeof v.author === 'string' &&
    isIsoDate(v.modified) &&
    (v.created === null || isIsoDate(v.created)) &&
    isOrigin(v.origin)
  );
}
