import type { Annotation, AnnotationType, RectPt } from './model';
import type { ForeignAnnotation } from './import';

/**
 * Lista de comentarios del panel (PDF-036). Puro: sin React ni pdf.js. Las anotaciones editables y las ajenas
 * (solo lectura) se muestran juntas, agrupadas por página.
 */

export interface CommentFilter {
  /** Etiquetas de tipo (`CommentRow.typeLabel`) que se muestran. Vacío = todos los tipos. */
  readonly types: ReadonlySet<string>;
  /** Autor exacto que se muestra, o `null` = todos. */
  readonly author: string | null;
  /** Texto a buscar en los comentarios: sin distinguir mayúsculas ni acentos. Vacío = sin filtro de texto. */
  readonly text: string;
}

export const EMPTY_COMMENT_FILTER: CommentFilter = { types: new Set(), author: null, text: '' };

export type CommentRow =
  | { readonly kind: 'page'; readonly pageIndex: number; readonly count: number }
  | {
      readonly kind: 'item';
      readonly id: string;
      readonly pageIndex: number;
      readonly typeLabel: string;
      readonly author: string;
      readonly modified: string | null;
      readonly excerpt: string;
      readonly readOnly: boolean;
    };

/** Caracteres del comentario que se muestran en la fila. */
export const EXCERPT_LENGTH = 160;
/** Texto del extracto de un marcado de texto sin comentario. */
export const NO_COMMENT_TEXT = '«sin comentario»';

/** Altura fija de la cabecera de página y de un comentario, en px CSS (la lista es virtualizada). */
export const PAGE_ROW_HEIGHT = 28;
export const ITEM_ROW_HEIGHT = 72;

const SUPPORTED_LABELS: Readonly<Record<AnnotationType, string>> = {
  highlight: 'Resaltado',
  underline: 'Subrayado',
  strikeout: 'Tachado',
  note: 'Nota',
  freetext: 'Texto',
  ink: 'Dibujo',
  signature: 'Firma',
};

/** Subtipos ajenos con nombre en español; el resto se muestra con su `subtype` tal cual. */
const FOREIGN_LABELS: ReadonlyMap<string, string> = new Map([
  ['Square', 'Rectángulo'],
  ['Circle', 'Elipse'],
  ['Line', 'Línea'],
  ['Polygon', 'Polígono'],
  ['PolyLine', 'Polilínea'],
  ['Stamp', 'Sello'],
  ['Caret', 'Inserción'],
  ['FileAttachment', 'Adjunto'],
  ['Sound', 'Sonido'],
  ['Squiggly', 'Subrayado ondulado'],
  // Subtipos que el editor sabe manejar, pero que el fichero trae con un dato no válido: se muestran como ajenos.
  ['Highlight', 'Resaltado'],
  ['Underline', 'Subrayado'],
  ['StrikeOut', 'Tachado'],
  ['Text', 'Nota'],
  ['FreeText', 'Texto'],
  ['Ink', 'Dibujo'],
]);

/** Subtipos de marcado de texto (su comentario vacío se muestra como «sin comentario»). */
const MARKUP_SUBTYPES: ReadonlySet<string> = new Set(['Highlight', 'Underline', 'StrikeOut', 'Squiggly']);

interface Candidate {
  readonly id: string;
  readonly pageIndex: number;
  readonly x1: number;
  readonly y2: number;
  readonly typeLabel: string;
  readonly author: string;
  readonly modified: string | null;
  readonly contents: string;
  readonly excerpt: string;
  readonly readOnly: boolean;
}

/** Etiqueta de tipo de una anotación editable. */
export function typeLabelOf(a: Annotation): string {
  return SUPPORTED_LABELS[a.type];
}

/** Etiqueta de tipo de una anotación ajena: su nombre en español si se conoce; si no, el `subtype`. */
export function foreignTypeLabel(subtype: string): string {
  return FOREIGN_LABELS.get(subtype) ?? subtype;
}

/** Los 160 primeros caracteres del comentario, sin saltos de línea. Vacío en un marcado de texto → «sin comentario». */
export function excerptOf(contents: string, textMarkup: boolean): string {
  const flat = contents.replace(/[\r\n]+/g, ' ').trim();
  if (flat === '') return textMarkup ? NO_COMMENT_TEXT : '';
  return Array.from(flat).slice(0, EXCERPT_LENGTH).join('');
}

/** Forma de comparar textos del filtro: sin acentos (marcas combinadas) y en minúsculas. */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();
}

/**
 * Filas de la lista: por página ascendente; cada página lleva una cabecera con su recuento y, debajo, sus comentarios
 * de arriba abajo (`rect` con `y2` mayor primero) y de izquierda a derecha. Las páginas sin filas no aparecen.
 */
export function buildCommentRows(
  effective: ReadonlyMap<string, Annotation>,
  foreign: ReadonlyMap<string, ForeignAnnotation>,
  f: CommentFilter,
): CommentRow[] {
  const needle = f.text.trim() === '' ? null : foldForSearch(f.text);
  const byPage = new Map<number, Candidate[]>();

  const keep = (c: Candidate): void => {
    if (f.types.size > 0 && !f.types.has(c.typeLabel)) return;
    if (f.author !== null && c.author !== f.author) return;
    if (needle !== null && !foldForSearch(c.contents).includes(needle)) return;
    const list = byPage.get(c.pageIndex);
    if (list === undefined) byPage.set(c.pageIndex, [c]);
    else list.push(c);
  };

  for (const a of effective.values()) {
    keep({
      id: a.id,
      pageIndex: a.pageIndex,
      x1: a.rect[0],
      y2: a.rect[3],
      typeLabel: typeLabelOf(a),
      author: a.author,
      modified: a.modified,
      contents: a.contents,
      excerpt: excerptOf(a.contents, isMarkupType(a.type)),
      readOnly: false,
    });
  }
  for (const r of foreign.values()) {
    keep({
      id: r.id,
      pageIndex: r.pageIndex,
      x1: r.rect[0],
      y2: r.rect[3],
      typeLabel: foreignTypeLabel(r.subtype),
      author: r.author,
      modified: r.modified,
      contents: r.contents,
      excerpt: excerptOf(r.contents, MARKUP_SUBTYPES.has(r.subtype)),
      readOnly: true,
    });
  }

  const rows: CommentRow[] = [];
  const pages = [...byPage.keys()].sort((p, q) => p - q);
  for (const pageIndex of pages) {
    const items = byPage.get(pageIndex) ?? [];
    items.sort(compareReading);
    rows.push({ kind: 'page', pageIndex, count: items.length });
    for (const c of items) {
      rows.push({
        kind: 'item',
        id: c.id,
        pageIndex: c.pageIndex,
        typeLabel: c.typeLabel,
        author: c.author,
        modified: c.modified,
        excerpt: c.excerpt,
        readOnly: c.readOnly,
      });
    }
  }
  return rows;
}

/** Autores distintos de todas las anotaciones (sin filtrar), sin vacíos, en orden español. */
export function authorsOf(
  effective: ReadonlyMap<string, Annotation>,
  foreign: ReadonlyMap<string, ForeignAnnotation>,
): string[] {
  const set = new Set<string>();
  for (const a of effective.values()) set.add(a.author);
  for (const r of foreign.values()) set.add(r.author);
  return [...set].filter((name) => name.trim() !== '').sort((a, b) => a.localeCompare(b, 'es'));
}

/** Etiquetas de tipo presentes en el documento (sin filtrar), en orden español. */
export function typeLabelsOf(
  effective: ReadonlyMap<string, Annotation>,
  foreign: ReadonlyMap<string, ForeignAnnotation>,
): string[] {
  const set = new Set<string>();
  for (const a of effective.values()) set.add(typeLabelOf(a));
  for (const r of foreign.values()) set.add(foreignTypeLabel(r.subtype));
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Alturas y posiciones verticales de las filas, para virtualizar la lista. */
export interface RowLayout {
  readonly tops: readonly number[];
  readonly heights: readonly number[];
  readonly total: number;
}

export function rowLayout(rows: readonly CommentRow[]): RowLayout {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (const row of rows) {
    const h = row.kind === 'page' ? PAGE_ROW_HEIGHT : ITEM_ROW_HEIGHT;
    tops.push(y);
    heights.push(h);
    y += h;
  }
  return { tops, heights, total: y };
}

/**
 * Filas que caen en la franja visible `[viewTop, viewTop + viewHeight)` más `overscan` filas a cada lado.
 * `null` si no hay filas.
 */
export function visibleRowRange(
  layout: RowLayout,
  viewTop: number,
  viewHeight: number,
  overscan: number,
): { readonly first: number; readonly last: number } | null {
  const n = layout.tops.length;
  if (n === 0) return null;
  const bottom = viewTop + Math.max(viewHeight, 0);
  let first = lastIndexAtOrBefore(layout.tops, Math.max(viewTop, 0));
  let last = first;
  while (last < n - 1 && (layout.tops[last + 1] ?? Infinity) < bottom) last++;
  first = Math.max(0, first - overscan);
  last = Math.min(n - 1, last + overscan);
  return { first, last };
}

/**
 * Fracción vertical (0 = arriba) del borde superior de un `rect` en la página tal como se ve, con la rotación total
 * (la de la página más la de vista). `rect` está en puntos del espacio de usuario sin girar; `widthPt` y `heightPt`
 * son las dimensiones sin girar.
 */
export function rectTopFraction(rect: RectPt, widthPt: number, heightPt: number, rotation: number): number {
  const [x1, y1, x2, y2] = rect;
  const w = Math.max(widthPt, 1);
  const h = Math.max(heightPt, 1);
  let fraction: number;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      fraction = x1 / w;
      break;
    case 180:
      fraction = y1 / h;
      break;
    case 270:
      fraction = (w - x2) / w;
      break;
    default:
      fraction = (h - y2) / h;
  }
  return Math.min(Math.max(fraction, 0), 1);
}

function isMarkupType(type: AnnotationType): boolean {
  return type === 'highlight' || type === 'underline' || type === 'strikeout';
}

/** Orden de lectura: de arriba abajo (y2 mayor primero), de izquierda a derecha, y por id para ser estable. */
function compareReading(a: Candidate, b: Candidate): number {
  if (a.y2 !== b.y2) return b.y2 - a.y2;
  if (a.x1 !== b.x1) return a.x1 - b.x1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Último índice `i` con `tops[i] <= value` (0 si ninguno). */
function lastIndexAtOrBefore(tops: readonly number[], value: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((tops[mid] ?? 0) <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Paso de navegación por las filas de comentario (las cabeceras de página se saltan). */
export type ItemStep = 'prev' | 'next' | 'first' | 'last';

/**
 * Índice de la fila de comentario a la que lleva un paso de teclado, o `null` si no hay ninguna en esa dirección.
 * `from` es el índice de la fila activa, o -1 si no hay ninguna (el siguiente es la primera; el anterior, la última).
 */
export function nextItemRow(rows: readonly CommentRow[], from: number, step: ItemStep): number | null {
  const last = rows.length - 1;
  switch (step) {
    case 'first':
      return findItemRow(rows, 0, 1);
    case 'last':
      return findItemRow(rows, last, -1);
    case 'next':
      return findItemRow(rows, from + 1, 1);
    case 'prev':
      return from < 0 ? findItemRow(rows, last, -1) : findItemRow(rows, from - 1, -1);
  }
}

function findItemRow(rows: readonly CommentRow[], start: number, dir: 1 | -1): number | null {
  for (let i = start; i >= 0 && i < rows.length; i += dir) {
    if (rows[i]?.kind === 'item') return i;
  }
  return null;
}
