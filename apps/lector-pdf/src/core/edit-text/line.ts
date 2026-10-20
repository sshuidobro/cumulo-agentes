/**
 * Localización de una línea de texto editable (ADR-0042): qué glifos forman la línea señalada, dónde empieza su
 * línea base y con qué fuente estándar, tamaño y color hay que reescribirla. Sin E/S salvo las lecturas de
 * `ObjectReader` para resolver la fuente.
 */
import { err, ok, type Result } from '@suite/shared';
import type { Rgb, RectPt } from '../annotations/model';
import { interpretPage, intersects, quadBounds, type PageContent, type Quad, type TextRun } from '../content';
import { effectiveResources } from '../pdf/page-content';
import type { ObjectReader } from '../pdf/object-reader';
import { dictGet, PdfSyntaxError, type PdfDict, type PdfValue } from '../pdf/objects';
import { standardFontFor, type StandardFont } from './standard-font';

export interface LineStyle {
  readonly font: StandardFont;
  readonly fontSize: number; // TextRun.fontSize redondeado a 0,01
  readonly color: Rgb; // TextRun.fill
}

export interface LocatedLine {
  readonly bounds: RectPt; // unión de quadBounds de sus glifos
  readonly origin: readonly [number, number]; // [bounds[0], refRun.origin[1]]
  readonly style: LineStyle;
  readonly glyphs: readonly number[]; // índices en content.glyphs, ascendentes
}

export interface EditableLine extends Omit<LocatedLine, 'glyphs'> {
  readonly pageIndex: number;
}

export type LineIssue = 'no-text' | 'unsupported' | 'rotated' | 'invisible';

/** Ángulo máximo (grados) de un texto para considerarlo horizontal. */
const MAX_ANGLE_DEG = 0.5;
/** Modos de representación que no pintan: invisible (3) y solo recorte (7). */
const RENDER_INVISIBLE = 3;
const RENDER_CLIP_ONLY = 7;
/** Tolerancia vertical entre glifos de la misma línea, relativa al tamaño de fuente. */
const BASELINE_TOLERANCE = 0.25;
/** Prefijo de subconjunto de una fuente embebida (ISO 32000-1, §9.6.4): seis mayúsculas y «+». */
const SUBSET_PREFIX = /^[A-Z]{6}\+/;

/** Sobre un contenido ya interpretado; `resources` = effectiveResources de la página. La usa PDF-145. */
export async function locateLine(
  reader: ObjectReader,
  resources: PdfDict,
  content: PageContent,
  hint: RectPt,
): Promise<Result<LocatedLine, LineIssue>> {
  if (content.unmeasured.length > 0) return err('unsupported');
  if (content.forms.some((form) => intersects(form.quad, hint))) return err('unsupported');

  const box = normalize(hint);
  const runs = new Map<number, TextRun>(content.runs.map((run) => [run.op, run]));
  const candidates = content.glyphs.flatMap((glyph, index) => (centerInside(glyph.quad, box) ? [index] : []));
  if (candidates.length === 0) return err('no-text');

  for (const index of candidates) {
    const glyph = content.glyphs[index];
    if (glyph === undefined || !runs.has(glyph.op)) return err('unsupported');
  }

  const ref = nearestToCenter(content, candidates, box);
  const refRun = runs.get(ref.op);
  if (refRun === undefined) return err('unsupported');
  if (Math.abs(refRun.angle) > MAX_ANGLE_DEG) return err('rotated');
  if (refRun.renderMode === RENDER_INVISIBLE || refRun.renderMode === RENDER_CLIP_ONLY) return err('invisible');

  const glyphs = candidates.filter((index) => {
    const glyph = content.glyphs[index];
    const run = glyph === undefined ? undefined : runs.get(glyph.op);
    return (
      run !== undefined &&
      Math.abs(run.angle) <= MAX_ANGLE_DEG &&
      run.renderMode !== RENDER_INVISIBLE &&
      run.renderMode !== RENDER_CLIP_ONLY &&
      Math.abs(run.origin[1] - refRun.origin[1]) <= BASELINE_TOLERANCE * refRun.fontSize
    );
  });

  const bounds = unionBounds(glyphs.map((index) => quadBounds(content.glyphs[index]?.quad ?? ZERO_QUAD)));
  const font = await fontStyleOf(reader, resources, refRun.fontResource);
  if (font === null) return err('unsupported');

  return ok({
    bounds,
    origin: [bounds[0], refRun.origin[1]],
    style: { font, fontSize: round2(refRun.fontSize), color: refRun.fill },
    glyphs,
  });
}

/** Interpreta la página y llama a `locateLine`. `pageIndex` fuera de rango o `hint` no finito/de área 0 → RangeError (bug). */
export async function findEditableLine(
  reader: ObjectReader,
  pageIndex: number,
  hint: RectPt,
): Promise<Result<EditableLine, LineIssue>> {
  if (!hint.every(Number.isFinite)) throw new RangeError('hint no finito');
  const box = normalize(hint);
  if (box[0] === box[2] || box[1] === box[3]) throw new RangeError('hint de área 0');
  const pageCount = await reader.pageCount();
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) throw new RangeError(`página fuera de rango: ${String(pageIndex)}`);

  const page = await reader.getDict(await reader.pageRef(pageIndex));
  if (page === null) return err('unsupported');

  let content: PageContent;
  try {
    content = await interpretPage(reader, page);
  } catch (error) {
    if (error instanceof PdfSyntaxError) return err('unsupported');
    throw error;
  }
  const located = await locateLine(reader, await effectiveResources(reader, page), content, hint);
  if (!located.ok) return err(located.error);
  return ok({ bounds: located.value.bounds, origin: located.value.origin, style: located.value.style, pageIndex });
}

const ZERO_QUAD: Quad = [0, 0, 0, 0, 0, 0, 0, 0];

function normalize(r: RectPt): RectPt {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** Centro de la caja envolvente del glifo dentro de `box` (bordes incluidos). */
function centerInside(quad: Quad, box: RectPt): boolean {
  const [x0, y0, x1, y1] = quadBounds(quad);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3];
}

/** Candidato con el centro más cercano al centro de `box`; empate → menor índice. `candidates` es ascendente. */
function nearestToCenter(content: PageContent, candidates: readonly number[], box: RectPt): { readonly op: number } {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  let best: { readonly op: number } | null = null;
  let bestDistance = Infinity;
  for (const index of candidates) {
    const glyph = content.glyphs[index];
    if (glyph === undefined) continue;
    const [x0, y0, x1, y1] = quadBounds(glyph.quad);
    const distance = (((x0 + x1) / 2 - cx) ** 2) + (((y0 + y1) / 2 - cy) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { op: glyph.op };
    }
  }
  if (best === null) throw new RangeError('sin candidatos');
  return best;
}

function unionBounds(boxes: readonly (readonly [number, number, number, number])[]): RectPt {
  return boxes.reduce<RectPt>(
    (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

/** Estilo de la fuente `resourceName` de /Resources; null si no se encuentra. */
async function fontStyleOf(reader: ObjectReader, resources: PdfDict, resourceName: string): Promise<StandardFont | null> {
  const fonts = await reader.resolve(dictGet(resources, 'Font'));
  if (!isDict(fonts)) return null;
  const font = await reader.resolve(fonts.entries.get(resourceName));
  if (!isDict(font)) return null;

  const baseFont = (nameOf(await reader.resolve(dictGet(font, 'BaseFont'))) ?? '').replace(SUBSET_PREFIX, '');
  const descriptorOwner = await descriptorOwnerOf(reader, font);
  const descriptor = await reader.resolve(dictGet(descriptorOwner, 'FontDescriptor'));
  const flags = isDict(descriptor) ? numberOf(await reader.resolve(dictGet(descriptor, 'Flags'))) : 0;
  return standardFontFor(baseFont, flags);
}

/** La fuente en sí, o, en Type0, la primera fuente descendiente (que es quien tiene el descriptor). */
async function descriptorOwnerOf(reader: ObjectReader, font: PdfDict): Promise<PdfDict> {
  if (nameOf(await reader.resolve(dictGet(font, 'Subtype'))) !== 'Type0') return font;
  const descendants = await reader.resolve(dictGet(font, 'DescendantFonts'));
  const first = Array.isArray(descendants) ? await reader.resolve(descendants[0]) : undefined;
  return isDict(first) ? first : font;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function nameOf(v: PdfValue | undefined): string | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' ? v.value : null;
}

function numberOf(v: PdfValue | undefined): number {
  return typeof v === 'number' ? v : 0;
}
