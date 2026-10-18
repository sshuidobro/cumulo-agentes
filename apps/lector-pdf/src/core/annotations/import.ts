/**
 * Importa las anotaciones que ya trae un PDF (ADR-0009). Puro: recibe los objetos planos que devuelve
 * pdf.js en `page.getAnnotations()` y nunca lanza. Las de tipos soportados pasan al modelo (línea base
 * editable); el resto son "ajenas", de solo lectura.
 *
 * Convención: un campo ausente (`undefined` o `null`) toma su valor por defecto; un campo presente con
 * un tipo inesperado hace que la anotación sea ajena.
 */
import { parsePdfDate } from '../pdf-date';
import { importWidget } from '../forms/import';
import type { FormField } from '../forms/model';
import {
  quadFromRect,
  type Annotation,
  type AnnotationOrigin,
  type AnnotationType,
  type FreeTextAnnotation,
  type InkAnnotation,
  type NoteIcon,
  type NoteAnnotation,
  type PdfObjRef,
  type Quad,
  type RectPt,
  type Rgb,
} from './model';

/** Objeto plano de `page.getAnnotations()` de pdf.js. */
export interface RawAnnotation {
  readonly [k: string]: unknown;
}

/** Anotación del fichero de un tipo que el editor no maneja: solo se muestra. */
export interface ForeignAnnotation {
  readonly id: string;
  readonly pageIndex: number;
  readonly subtype: string;
  readonly rect: RectPt;
  readonly contents: string;
  readonly author: string;
  readonly modified: string | null;
}

export interface ImportedPage {
  readonly supported: readonly Annotation[];
  readonly foreign: readonly ForeignAnnotation[];
  /** Widgets de formulario de la página, un `FormField` por widget (se agrupan por nombre al unir páginas). */
  readonly widgets: readonly FormField[];
}

type BaseFields = Omit<NoteAnnotation, 'type' | 'icon' | 'open'>;

const YELLOW: Rgb = [1, 0.92, 0.23];
const BLACK: Rgb = [0, 0, 0];
const ZERO_RECT: RectPt = [0, 0, 0, 0];
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_OPACITY = 1;
const DEFAULT_INK_WIDTH = 1;
const DEFAULT_NOTE_ICON: NoteIcon = 'Note';
/** Bit 2 de `/F` (ISO 32000 §12.5.3): la anotación está oculta. */
const HIDDEN_FLAG = 2;
/** Subtipos con capa propia o asociados a otra anotación: no se importan ni se muestran. Los widgets van a `forms`. */
const IGNORED_SUBTYPES: readonly unknown[] = ['Popup', 'Link'];
const NOTE_ICONS: readonly unknown[] = ['Comment', 'Note', 'Key', 'Help', 'NewParagraph', 'Paragraph', 'Insert'];
/** `<num>R` o `<num>R<gen>`, tal como lo escribe pdf.js en `id` y `popupRef`. */
const REF_PATTERN = /^(\d+)R(\d*)$/;

export function importPageAnnotations(
  pageIndex: number,
  raws: readonly RawAnnotation[],
  fallbackDate: string,
): ImportedPage {
  const supported: Annotation[] = [];
  const foreign: ForeignAnnotation[] = [];
  const widgets: FormField[] = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    if (!isRecord(raw) || IGNORED_SUBTYPES.includes(raw.subtype)) continue;
    if (raw.subtype === 'Widget') {
      const field = importWidget(raw, pageIndex);
      if (field !== null) widgets.push(field);
      continue;
    }
    const hidden = hiddenOf(raw.annotationFlags);
    if (hidden === true) continue;
    const annotation = hidden === false ? importSupported(raw, pageIndex, fallbackDate) : null;
    if (annotation !== null) {
      supported.push(annotation);
    } else {
      foreign.push(importForeign(raw, pageIndex, i));
    }
  }
  return { supported, foreign, widgets };
}

/** Convierte una anotación de tipo soportado; `null` si el tipo no lo es o algún dato no encaja. */
function importSupported(raw: Record<string, unknown>, pageIndex: number, fallbackDate: string): Annotation | null {
  const kind = kindOf(raw.subtype);
  if (kind === undefined || typeof raw.id !== 'string') return null;
  const ref = parseRef(raw.id);
  const rect = toRect(raw.rect);
  const popupRef = optRef(raw.popupRef);
  const color = optRgb(raw.color, kind === 'highlight' ? YELLOW : BLACK);
  const opacity = optNumber(raw.opacity, DEFAULT_OPACITY);
  const contents = textObj(raw.contentsObj);
  const author = textObj(raw.titleObj);
  const modified = optDate(raw.modificationDate);
  const created = optDate(raw.creationDate);
  if (
    ref === null ||
    rect === undefined ||
    popupRef === undefined ||
    color === undefined ||
    opacity === undefined ||
    contents === undefined ||
    author === undefined ||
    modified === undefined ||
    created === undefined
  ) {
    return null;
  }
  const origin: AnnotationOrigin = { kind: 'file', ref, popupRef };
  const base: BaseFields = {
    id: `ref:${raw.id}`,
    pageIndex,
    rect,
    color,
    opacity: clamp01(opacity),
    contents,
    author,
    modified: modified ?? fallbackDate,
    created,
    origin,
  };
  switch (kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return buildTextMarkup(base, kind, rect, raw.quadPoints);
    case 'note':
      return buildNote(base, raw);
    case 'freetext':
      return buildFreeText(base, raw);
    case 'ink':
      return buildInk(base, raw);
  }
}

function buildTextMarkup(
  base: BaseFields,
  type: 'highlight' | 'underline' | 'strikeout',
  rect: RectPt,
  quadPoints: unknown,
): Annotation | null {
  const quads = quadsOf(quadPoints, rect);
  return quads === undefined ? null : { ...base, type, quads };
}

function buildNote(base: BaseFields, raw: Record<string, unknown>): NoteAnnotation {
  const name = raw.name;
  return {
    ...base,
    type: 'note',
    icon: isNoteIcon(name) ? name : DEFAULT_NOTE_ICON,
    open: raw.open === true,
  };
}

function buildFreeText(base: BaseFields, raw: Record<string, unknown>): FreeTextAnnotation | null {
  const lines = linesOf(raw.textContent);
  const appearance = raw.defaultAppearanceData;
  let fontSize = DEFAULT_FONT_SIZE;
  let textColor: Rgb = BLACK;
  if (appearance !== undefined && appearance !== null) {
    if (!isRecord(appearance)) return null;
    const size = optNumber(appearance.fontSize, DEFAULT_FONT_SIZE);
    const color = optRgb(appearance.fontColor, BLACK);
    if (size === undefined || color === undefined) return null;
    fontSize = size > 0 ? size : DEFAULT_FONT_SIZE;
    textColor = color;
  }
  if (lines === undefined) return null;
  return {
    ...base,
    contents: base.contents === '' ? lines : base.contents,
    type: 'freetext',
    fontSize,
    textColor,
  };
}

function buildInk(base: BaseFields, raw: Record<string, unknown>): InkAnnotation | null {
  const lists = raw.inkLists;
  if (!Array.isArray(lists)) return null;
  const items: readonly unknown[] = lists;
  const paths: (readonly number[])[] = [];
  for (const item of items) {
    const path = numList(item);
    if (path === undefined || path.length < 2 || path.length % 2 !== 0) return null;
    paths.push(path);
  }
  const width = widthOf(raw.borderStyle);
  if (paths.length === 0 || width === undefined) return null;
  return { ...base, type: 'ink', paths, width };
}

/** Anotación ajena: no se valida del todo, se muestra con lo que tenga y se rellenan los huecos. */
function importForeign(raw: Record<string, unknown>, pageIndex: number, index: number): ForeignAnnotation {
  return {
    id: typeof raw.id === 'string' ? `ref:${raw.id}` : `ref:?${String(pageIndex)}.${String(index)}`,
    pageIndex,
    subtype: typeof raw.subtype === 'string' ? raw.subtype : 'Unknown',
    rect: toRect(raw.rect) ?? ZERO_RECT,
    contents: textObj(raw.contentsObj) ?? '',
    author: textObj(raw.titleObj) ?? '',
    modified: optDate(raw.modificationDate) ?? null,
  };
}

/** Tipos que se importan como editables. Las firmas (`/Stamp` propio) no vienen de ningún fichero: son ajenas. */
type ImportedType = Exclude<AnnotationType, 'signature'>;

function kindOf(subtype: unknown): ImportedType | undefined {
  switch (subtype) {
    case 'Highlight':
      return 'highlight';
    case 'Underline':
      return 'underline';
    case 'StrikeOut':
      return 'strikeout';
    case 'Text':
      return 'note';
    case 'FreeText':
      return 'freetext';
    case 'Ink':
      return 'ink';
    default:
      return undefined;
  }
}

/** `quadPoints` de pdf.js: ausente o vacío → rectángulo; longitud o valores inválidos → `undefined`. */
function quadsOf(v: unknown, rect: RectPt): readonly Quad[] | undefined {
  const fallback = [quadFromRect(rect)];
  if (v === undefined || v === null) return fallback;
  const nums = numList(v);
  if (nums === undefined) return undefined;
  if (nums.length === 0) return fallback;
  if (nums.length % 8 !== 0) return undefined;
  const quads: Quad[] = [];
  for (let i = 0; i < nums.length; i += 8) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = nums.slice(i, i + 8);
    quads.push([a, b, c, d, e, f, g, h]);
  }
  return quads;
}

/** Texto de `contentsObj`/`titleObj` (`{ str }`): `''` si falta; `undefined` si el tipo no encaja. */
function textObj(v: unknown): string | undefined {
  if (v === undefined || v === null) return '';
  return isRecord(v) ? optString(v.str, '') : undefined;
}

/** `textContent` (líneas de texto libre): `''` si falta; `undefined` si no es una lista de cadenas. */
function linesOf(v: unknown): string | undefined {
  if (v === undefined || v === null) return '';
  if (!Array.isArray(v)) return undefined;
  const items: readonly unknown[] = v;
  return items.every((line) => typeof line === 'string') ? items.join('\n') : undefined;
}

function toRect(v: unknown): RectPt | undefined {
  const nums = numList(v);
  if (nums === undefined || nums.length !== 4) return undefined;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = nums;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** Color de 0-255 de pdf.js → RGB en [0, 1]. `fallback` si falta; `undefined` si no tiene 3 componentes. */
function optRgb(v: unknown, fallback: Rgb): Rgb | undefined {
  if (v === undefined || v === null) return fallback;
  const c = numList(v);
  if (c === undefined || c.length !== 3) return undefined;
  const [r = 0, g = 0, b = 0] = c;
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

/** `borderStyle.width` (o 1 si falta o no es positivo); `undefined` si `borderStyle` no es un objeto. */
function widthOf(v: unknown): number | undefined {
  if (v === undefined || v === null) return DEFAULT_INK_WIDTH;
  if (!isRecord(v)) return undefined;
  const width = optNumber(v.width, DEFAULT_INK_WIDTH);
  if (width === undefined) return undefined;
  return width > 0 ? width : DEFAULT_INK_WIDTH;
}

/** Bandera `/F`: `false` si falta; `true` si está oculta; `undefined` si no es un número. */
function hiddenOf(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'number') return undefined;
  return (v & HIDDEN_FLAG) !== 0;
}

/** Referencia de objeto (`<num>R` o `<num>R<gen>`); `null` si no es válida. */
function parseRef(s: string): PdfObjRef | null {
  const m = REF_PATTERN.exec(s);
  if (m === null) return null;
  const num = Number(m[1] ?? '');
  const gen = Number(m[2] ?? '');
  return num >= 1 ? { num, gen } : null;
}

/** `popupRef`: `null` si falta; `undefined` si no es una referencia válida (tipo o forma inesperados). */
function optRef(v: unknown): PdfObjRef | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  return parseRef(v) ?? undefined;
}

/** Fecha de pdf.js (`D:...`): `null` si falta o no es una fecha válida; `undefined` si no es cadena. */
function optDate(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? parsePdfDate(v) : undefined;
}

function optNumber(v: unknown, fallback: number): number | undefined {
  if (v === undefined || v === null) return fallback;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function optString(v: unknown, fallback: string): string | undefined {
  if (v === undefined || v === null) return fallback;
  return typeof v === 'string' ? v : undefined;
}

/** Lista numérica (array o typed array) con solo valores finitos; `undefined` si no lo es. */
function numList(v: unknown): readonly number[] | undefined {
  const isList = Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));
  if (!isList) return undefined;
  const items = v as ArrayLike<unknown>;
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
    out.push(x);
  }
  return out;
}

function isNoteIcon(v: unknown): v is NoteIcon {
  return NOTE_ICONS.includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
