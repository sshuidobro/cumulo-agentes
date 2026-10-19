/**
 * Formas y sellos ajenos que pasan a editables al abrir (PDF-107, ADR-0029). `/Square`, `/Circle`, `/Line`,
 * `/Polygon` y nuestros `/Stamp` se leen con `ObjectReader` (pdf.js no expone `/IC`, `/LE` ni `/NM`). Lo que no
 * encaja con el modelo sigue ajeno, sin tocar. `shapeFromDict` es puro; `promoteShapes` nunca lanza.
 */
import { parsePdfDate } from '../pdf-date';
import type { ObjectReader } from '../pdf/object-reader';
import { dictGet, ref, type PdfDict, type PdfString, type PdfValue } from '../pdf/objects';
import { decodeTextString } from '../pdf/text-string';
import { parseRef, type ForeignAnnotation, type ImportedPage } from './import';
import type {
  Annotation,
  AnnotationOrigin,
  BoxShapeAnnotation,
  LineShapeAnnotation,
  PdfObjRef,
  PolygonAnnotation,
  RectPt,
  Rgb,
  ShapeLineEnding,
  StampAnnotation,
} from './model';
import { SHAPE_LINE_ENDINGS, STAMP_NAMES, type StampName } from './shapes';

/** Subtipos que pueden pasar de ajenos a editables. */
export const SHAPE_SUBTYPES: ReadonlySet<string> = new Set(['Square', 'Circle', 'Line', 'Polygon', 'Stamp']);

/** Prefijo de los ids de anotación ajena que pudieron leerse como referencia (`ref:<num>R[<gen>]`). */
const REF_PREFIX = 'ref:';
/** Prefijo de los `/NM` de las anotaciones creadas por la suite (ver `to-pdf.ts`). */
const SUITE_ID_PREFIX = 'suite-';
const BLACK: Rgb = [0, 0, 0];
const DEFAULT_OPACITY = 1;
const DEFAULT_BORDER_WIDTH = 1;
/** Índice del grosor en `/Border` (`[hr vr w [dash]]`, ISO 32000-1 §12.5.4). */
const BORDER_WIDTH_INDEX = 2;
const BORDER_LENGTH = 3;

/**
 * Forma o sello editable a partir de su diccionario, o `null` si debe seguir ajena. Puro.
 * `foreign` aporta id, página, subtipo, autor, contenido y fecha de modificación de la anotación ajena.
 */
export function shapeFromDict(d: PdfDict, foreign: ForeignAnnotation, fallbackDate: string): Annotation | null {
  if (!SHAPE_SUBTYPES.has(foreign.subtype)) return null;
  const origin = fileOrigin(foreign.id, d);
  const rect = rectOf(dictGet(d, 'Rect'));
  const color = rgbOf(dictGet(d, 'C'), BLACK);
  const opacity = opacityOf(dictGet(d, 'CA'));
  const created = dateOf(dictGet(d, 'CreationDate'));
  if (origin === null || rect === undefined || color === undefined || opacity === undefined || created === undefined) {
    return null;
  }
  const common: CommonFields = {
    id: foreign.id,
    pageIndex: foreign.pageIndex,
    rect,
    color,
    opacity,
    contents: foreign.contents,
    author: foreign.author,
    modified: foreign.modified ?? fallbackDate,
    created,
    origin,
  };
  switch (foreign.subtype) {
    case 'Square':
    case 'Circle':
      return boxOf(common, foreign.subtype === 'Square' ? 'square' : 'circle', d);
    case 'Line':
      return lineOf(common, d);
    case 'Polygon':
      return polygonOf(common, d);
    case 'Stamp':
      return stampOf(common, d);
    default:
      return null;
  }
}

/**
 * Lee los diccionarios de las ajenas de `SHAPE_SUBTYPES` y pasa a `supported` las que encajan (al final, en su
 * orden). Las demás se quedan en `foreign`, en su orden. Un objeto ilegible deja la ajena como está. Nunca lanza.
 */
export async function promoteShapes(reader: ObjectReader, page: ImportedPage, fallbackDate: string): Promise<ImportedPage> {
  const supported: Annotation[] = [...page.supported];
  const foreign: ForeignAnnotation[] = [];
  let changed = false;
  for (const a of page.foreign) {
    const promoted = await promoteOne(reader, a, fallbackDate);
    if (promoted === null) {
      foreign.push(a);
    } else {
      supported.push(promoted);
      changed = true;
    }
  }
  return changed ? { ...page, supported, foreign } : page;
}

async function promoteOne(reader: ObjectReader, a: ForeignAnnotation, fallbackDate: string): Promise<Annotation | null> {
  if (!SHAPE_SUBTYPES.has(a.subtype) || !a.id.startsWith(REF_PREFIX)) return null;
  const r = parseRef(a.id.slice(REF_PREFIX.length));
  if (r === null) return null;
  try {
    const d = await reader.getDict(ref(r.num, r.gen));
    return d === null ? null : shapeFromDict(d, a, fallbackDate);
  } catch {
    // Objeto ilegible: la anotación sigue siendo ajena.
    return null;
  }
}

type CommonFields = Omit<StampAnnotation, 'type' | 'name'>;

function boxOf(common: CommonFields, type: 'square' | 'circle', d: PdfDict): BoxShapeAnnotation | null {
  const width = strokeWidthOf(d);
  const interior = interiorOf(d);
  if (width === null || interior === undefined) return null;
  return { ...common, type, width, interior };
}

function lineOf(common: CommonFields, d: PdfDict): LineShapeAnnotation | null {
  const points = numbersOf(dictGet(d, 'L'));
  const endings = endingsOf(dictGet(d, 'LE'));
  const width = strokeWidthOf(d);
  const interior = interiorOf(d);
  if (points === undefined || points.length !== 4 || endings === undefined || width === null) return null;
  if (interior === undefined) return null;
  if (!isLineArrowOrAbsent(dictGet(d, 'IT'))) return null;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
  return { ...common, type: 'line', points: [x1, y1, x2, y2], width, endings, interior };
}

function polygonOf(common: CommonFields, d: PdfDict): PolygonAnnotation | null {
  const vertices = numbersOf(dictGet(d, 'Vertices'));
  const width = strokeWidthOf(d);
  const interior = interiorOf(d);
  if (vertices === undefined || vertices.length < 6 || vertices.length % 2 !== 0) return null;
  if (width === null || interior === undefined) return null;
  // Con `/IT` es una polilínea, una cota u otra forma de Adobe: no encaja.
  const it = dictGet(d, 'IT');
  if (it !== undefined && it !== null) return null;
  return { ...common, type: 'polygon', vertices: [...vertices], width, interior };
}

function stampOf(common: CommonFields, d: PdfDict): StampAnnotation | null {
  const name = nameOf(dictGet(d, 'Name'));
  const nm = dictGet(d, 'NM');
  if (name === undefined || !isStampName(name) || !isPdfString(nm)) return null;
  if (!decodeTextString(nm).startsWith(SUITE_ID_PREFIX)) return null;
  return { ...common, type: 'stamp', name };
}

/** Referencia del objeto de la anotación (de su id `ref:<num>R[<gen>]`) y de su `/Popup`; `null` si no encaja. */
function fileOrigin(id: string, d: PdfDict): AnnotationOrigin | null {
  if (!id.startsWith(REF_PREFIX)) return null;
  const r = parseRef(id.slice(REF_PREFIX.length));
  if (r === null) return null;
  const popup = dictGet(d, 'Popup');
  if (popup === undefined || popup === null) return { kind: 'file', ref: r, popupRef: null };
  const popupRef = refValue(popup);
  return popupRef === undefined ? null : { kind: 'file', ref: r, popupRef };
}

/**
 * Grosor del trazo: `/BS /W` (o `/Border[2]` si no hay `/BS /W`; por defecto 1). `null` si no encaja: `/BS` que no
 * es diccionario, `/BS /S` distinto de `/S` (discontinuo), efecto nube (`/BE /S /C`) y grosor no positivo
 * (0 es una forma invisible).
 */
function strokeWidthOf(d: PdfDict): number | null {
  const be = dictGet(d, 'BE');
  if (be !== undefined && be !== null) {
    const beDict = dictOf(be);
    if (beDict === undefined) return null;
    if (nameOf(dictGet(beDict, 'S')) === 'C') return null;
  }
  const bs = dictGet(d, 'BS');
  let bsDict: PdfDict | undefined;
  if (bs !== undefined && bs !== null) {
    bsDict = dictOf(bs);
    if (bsDict === undefined) return null;
    const style = dictGet(bsDict, 'S');
    if (style !== undefined && style !== null && nameOf(style) !== 'S') return null;
  }
  const w = bsDict === undefined ? undefined : dictGet(bsDict, 'W');
  if (w !== undefined && w !== null) return positiveOrNull(w);
  const border = dictGet(d, 'Border');
  if (border !== undefined && border !== null) {
    // `[hr vr w]`: un cuarto elemento es un patrón de trazo discontinuo, y entonces sigue ajena.
    const nums = numbersOf(border);
    if (nums === undefined || nums.length !== BORDER_LENGTH) return null;
    return positiveOrNull(nums[BORDER_WIDTH_INDEX]);
  }
  return DEFAULT_BORDER_WIDTH;
}

/** Relleno (`/IC`): `null` si no hay; `undefined` si no encaja con un RGB en [0, 1]. */
function interiorOf(d: PdfDict): Rgb | null | undefined {
  const ic = dictGet(d, 'IC');
  if (ic === undefined || ic === null) return null;
  return rgbOf(ic, BLACK);
}

/** Extremos (`/LE`): ausente → `['None', 'None']`; `undefined` si no son dos extremos soportados. */
function endingsOf(v: PdfValue | undefined): readonly [ShapeLineEnding, ShapeLineEnding] | undefined {
  if (v === undefined || v === null) return ['None', 'None'];
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const items: readonly unknown[] = v;
  const [a, b] = items.map((item) => nameOf(item));
  if (!isLineEnding(a) || !isLineEnding(b)) return undefined;
  return [a, b];
}

function isLineEnding(v: string | undefined): v is ShapeLineEnding {
  return v !== undefined && (SHAPE_LINE_ENDINGS as readonly string[]).includes(v);
}

/** `/IT` ausente, o `/LineArrow` (flecha). Cualquier otro valor (cotas, etc.) no encaja. */
function isLineArrowOrAbsent(v: PdfValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  return nameOf(v) === 'LineArrow';
}

/** `/Rect` normalizado; `undefined` si no tiene cuatro números. */
function rectOf(v: PdfValue | undefined): RectPt | undefined {
  const nums = numbersOf(v);
  if (nums === undefined || nums.length !== 4) return undefined;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = nums;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** Color de tres componentes en [0, 1]; `fallback` si falta; `undefined` si no encaja. */
function rgbOf(v: PdfValue | undefined, fallback: Rgb): Rgb | undefined {
  if (v === undefined || v === null) return fallback;
  const c = numbersOf(v);
  if (c === undefined || c.length !== 3) return undefined;
  const [r = 0, g = 0, b = 0] = c;
  return [r, g, b].every(inUnit) ? [r, g, b] : undefined;
}

/** `/CA`: 1 si falta; `undefined` si no es un número (se acota a [0, 1]). */
function opacityOf(v: PdfValue | undefined): number | undefined {
  if (v === undefined || v === null) return DEFAULT_OPACITY;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(1, Math.max(0, v));
}

/** `/CreationDate`: `null` si falta o no es una fecha válida; `undefined` si no es una cadena. */
function dateOf(v: PdfValue | undefined): string | null | undefined {
  if (v === undefined || v === null) return null;
  return isPdfString(v) ? parsePdfDate(decodeTextString(v)) : undefined;
}

function refValue(v: PdfValue): PdfObjRef | undefined {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref') {
    return { num: v.num, gen: v.gen };
  }
  return undefined;
}

/** Diccionario de un valor, o `undefined` si no lo es. */
function dictOf(v: PdfValue): PdfDict | undefined {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict') return v;
  return undefined;
}

/** Valor de un `/Name`; `undefined` si no es un nombre. */
function nameOf(v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null || !('kind' in v) || v.kind !== 'name' || !('value' in v)) return undefined;
  return typeof v.value === 'string' ? v.value : undefined;
}

function isStampName(v: string): v is StampName {
  return (STAMP_NAMES as readonly string[]).includes(v);
}

function isPdfString(v: PdfValue | undefined): v is PdfString {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

/** Lista de números finitos (sin otros tipos); `undefined` si no lo es. */
function numbersOf(v: PdfValue | undefined): readonly number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const items: readonly unknown[] = v;
  const out: number[] = [];
  for (const x of items) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
    out.push(x);
  }
  return out;
}

/** Grosor positivo, o `null` si no es un número positivo. */
function positiveOrNull(v: PdfValue | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function inUnit(x: number): boolean {
  return x >= 0 && x <= 1;
}
