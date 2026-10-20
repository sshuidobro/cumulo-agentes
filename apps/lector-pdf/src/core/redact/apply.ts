/**
 * Redacción real (ADR-0039, PDF-135): dadas zonas por página, quita el texto glifo a glifo (sustituyéndolo por
 * ajustes numéricos de `TJ` que mantienen la posición de lo demás), quita las imágenes que caen enteras en una zona y
 * las anotaciones que la tocan, pinta rectángulos negros y escribe el fichero entero (`rewrite` después). Las páginas
 * que no se saben tratar se sustituyen por una imagen JPEG que entrega la interfaz (`rasterPages`).
 * Nunca lanza: los errores esperables vuelven como `Result`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import {
  intersects,
  interpretPage,
  quadBounds,
  serializeContent,
  type ContentOp,
  type GlyphBox,
  type PageContent,
  type Quad,
} from '../content';
import { pdfError } from '../errors';
import { removeWidgetRefs } from '../organize/forms-cleanup';
import type { RandomBytes } from '../pdf/crypt-rules';
import { finishDelta, reserveXref, startDelta, type DeltaWriter } from '../pdf/delta-writer';
import { flateEncode } from '../pdf/filters';
import { jpegImageObject } from '../pdf/image';
import type { ObjectReader } from '../pdf/object-reader';
import { catalogRef, createAllocator, type ObjectAllocator } from '../pdf/page-tree';
import { effectiveResources } from '../pdf/page-content';
import {
  bytesString,
  dict,
  dictGet,
  name,
  PdfSyntaxError,
  stream,
  withEntries,
  type PdfDict,
  type PdfStream,
  type PdfRef,
  type PdfString,
  type PdfValue,
} from '../pdf/objects';
import { toSaveError } from '../pdf/save-error';

/** Rectángulo `[x0, y0, x1, y1]` en espacio de usuario de la página (puntos); los extremos pueden venir en cualquier orden. */
export type RectPt = readonly [number, number, number, number];
/** Zona a redactar. */
export interface RedactArea {
  readonly pageIndex: number;
  /** Espacio de usuario de la página. */
  readonly rect: RectPt;
}
/** Imagen parcialmente cubierta; la detalla PDF-136. */
export interface PartialImage {
  readonly name: string;
  readonly op: number;
}
/** Por página con zonas: si se puede redactar sin convertir la página en imagen, o por qué no. */
export interface PagePlan {
  readonly pageIndex: number;
  readonly raster: boolean;
  readonly partialImages: readonly PartialImage[];
}
export interface RedactInput {
  readonly source: ByteSource;
  readonly reader: ObjectReader;
  readonly areas: readonly RedactArea[];
  /** JPEG de la página entera sin girar (ya con las zonas en negro), para las páginas con `raster`. */
  readonly rasterPages: ReadonlyMap<number, Uint8Array>;
  readonly now: string;
  readonly random?: RandomBytes;
  readonly signal?: AbortSignal;
}

/** Caja normalizada `[xmin, ymin, xmax, ymax]`. */
type Box = readonly [number, number, number, number];

/** Nombre del XObject con la imagen de una página rasterizada. */
const RASTER_NAME = 'SuiteRedact';
/** Tolerancia al decidir si una imagen cabe entera en una zona (puntos). */
const EPSILON = 1e-6;
/** Profundidad máxima de `/Parent` al buscar cajas y recursos heredados. */
const MAX_INHERITANCE = 64;

interface PageAnalysis {
  readonly plan: PagePlan;
  readonly pageRef: PdfRef;
  readonly pageDict: PdfDict;
  /** `null` si la página va como imagen. */
  readonly content: PageContent | null;
}

/** Estado de una pasada de escritura. */
interface Context {
  readonly reader: ObjectReader;
  readonly writer: DeltaWriter;
  readonly alloc: ObjectAllocator;
  readonly rasterPages: ReadonlyMap<number, Uint8Array>;
  /** Refs de los widgets quitados de las páginas redactadas. */
  readonly widgets: Set<number>;
}

/** Por página con zonas: si se puede redactar sin convertir la página en imagen, o por qué no. */
export async function planRedaction(reader: ObjectReader, areas: readonly RedactArea[]): Promise<Result<readonly PagePlan[]>> {
  try {
    const byPage = validAreas(areas, await reader.pageCount());
    if (byPage === null) return err(pdfError('organize-invalid'));
    const plans: PagePlan[] = [];
    for (const [pageIndex, boxes] of byPage) {
      plans.push((await analyzePage(reader, pageIndex, boxes)).plan);
    }
    return ok(plans);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

/** Escribe el incremento que redacta las zonas: contenido nuevo por página, anotaciones y widgets quitados. */
export async function buildRedactionUpdate(input: RedactInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>> {
  try {
    return await writeRedaction(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeRedaction(input: RedactInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>> {
  const { source, reader, signal } = input;
  const byPage = validAreas(input.areas, await reader.pageCount());
  if (byPage === null) return err(pdfError('organize-invalid'));
  if (byPage.size === 0) return ok({ delta: new Uint8Array(0), expectedSize: source.size });

  const ctx: Context = {
    reader,
    writer: await startDelta(source, reader, input.random),
    alloc: createAllocator(reader.xref.size),
    rasterPages: input.rasterPages,
    widgets: new Set<number>(),
  };
  for (const [pageIndex, boxes] of byPage) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const analysis = await analyzePage(reader, pageIndex, boxes);
    const changes = analysis.content === null
      ? await rasterChanges(ctx, analysis)
      : await textChanges(ctx, analysis, analysis.content, boxes);
    if (!changes.ok) return changes;
    ctx.writer.object(analysis.pageRef.num, analysis.pageRef.gen, withEntries(analysis.pageDict, changes.value));
  }

  const root = await catalogRef(reader);
  await removeWidgetRefs(reader, ctx.writer, ctx.widgets, root);
  const { xrefNum, size } = reserveXref(reader, ctx.alloc.nextNum);
  const delta = finishDelta(ctx.writer, { reader, root, size, xrefNum, now: input.now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length });
}

/** Zonas agrupadas por página (ascendente), normalizadas. `null` si alguna no es válida. */
function validAreas(areas: readonly RedactArea[], pageCount: number): Map<number, Box[]> | null {
  const byPage = new Map<number, Box[]>();
  for (const area of areas) {
    if (!Number.isInteger(area.pageIndex) || area.pageIndex < 0 || area.pageIndex >= pageCount) return null;
    if (!area.rect.every((value) => Number.isFinite(value))) return null;
    const box = normalize(area.rect);
    if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) return null;
    const list = byPage.get(area.pageIndex) ?? [];
    list.push(box);
    byPage.set(area.pageIndex, list);
  }
  return new Map([...byPage.entries()].sort(([a], [b]) => a - b));
}

function normalize(rect: RectPt): Box {
  return [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
}

async function analyzePage(reader: ObjectReader, pageIndex: number, boxes: readonly Box[]): Promise<PageAnalysis> {
  const pageRef = await reader.pageRef(pageIndex);
  const pageDict = await reader.getDict(pageRef);
  if (pageDict === null) throw new PdfSyntaxError(`página ${String(pageIndex + 1)} ilegible`, 0);
  const content = await readContent(reader, pageDict);
  const raster = content === null
    || content.unmeasured.length > 0
    || content.forms.some((form) => touchesAny(form.quad, boxes))
    || content.images.some((image) => touchesAny(image.quad, boxes) && !containedInAny(image.quad, boxes));
  return {
    plan: { pageIndex, raster, partialImages: [] },
    pageRef,
    pageDict,
    content: raster ? null : content,
  };
}

/** Contenido interpretado, o `null` si la página no se puede interpretar (entonces va como imagen). */
async function readContent(reader: ObjectReader, pageDict: PdfDict): Promise<PageContent | null> {
  try {
    return await interpretPage(reader, pageDict);
  } catch {
    return null;
  }
}

/** Un glifo toca la zona si su caja corta la zona; un glifo de área nula (p. ej. `Tfs` 0) cuenta si su origen cae dentro. */
function touches(quad: Quad, box: Box): boolean {
  const [x0, y0, x1, y1] = quadBounds(quad);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return x0 >= box[0] && x0 <= box[2] && y0 >= box[1] && y0 <= box[3];
  return intersects(quad, box);
}

function touchesAny(quad: Quad, boxes: readonly Box[]): boolean {
  return boxes.some((box) => touches(quad, box));
}

/** La caja envolvente del `quad` cabe entera en una de las zonas. */
function containedInAny(quad: Quad, boxes: readonly Box[]): boolean {
  const [x0, y0, x1, y1] = quadBounds(quad);
  return boxes.some(
    (box) => x0 >= box[0] - EPSILON && y0 >= box[1] - EPSILON && x1 <= box[2] + EPSILON && y1 <= box[3] + EPSILON,
  );
}

/** Cuadrilátero de un `/Rect` de anotación (`[x0 y0 x1 y1]`). */
function rectQuad(rect: readonly number[]): Quad {
  const [a = 0, b = 0, c = 0, d = 0] = rect;
  const [x0, y0, x1, y1] = normalize([a, b, c, d]);
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/** Cambios de la página (`Contents`, `Resources`, `Annots`) cuando va como texto con operaciones redactadas. */
async function textChanges(
  ctx: Context,
  analysis: PageAnalysis,
  content: PageContent,
  boxes: readonly Box[],
): Promise<Result<Record<string, PdfValue | undefined>>> {
  const glyphsByOp = groupGlyphs(content.glyphs);
  const removedImageOps = new Set<number>();
  for (const image of content.images) {
    if (touchesAny(image.quad, boxes)) removedImageOps.add(image.op);
  }

  const ops: ContentOp[] = [];
  const removedNames: string[] = [];
  for (const [index, op] of content.ops.entries()) {
    if (removedImageOps.has(index)) {
      const imageName = op.op === 'Do' ? nameOperand(op) : null;
      if (imageName !== null) removedNames.push(imageName);
      continue;
    }
    const glyphs = glyphsByOp.get(index);
    if (glyphs === undefined) ops.push(op);
    else ops.push(...editText(op, glyphs, boxes));
  }

  const remaining = new Set(ops.flatMap((operation): string[] => {
    const used = operation.op === 'Do' ? nameOperand(operation) : null;
    return used === null ? [] : [used];
  }));
  const resources = await effectiveResources(ctx.reader, analysis.pageDict);
  const xobjects = dictGet(resources, 'XObject');
  const unused = removedNames.filter((imageName) => !remaining.has(imageName));
  const cleaned = isDict(xobjects) && unused.length > 0
    ? withEntries(resources, { XObject: withEntries(xobjects, Object.fromEntries(unused.map((n): [string, undefined] => [n, undefined]))) })
    : resources;

  const contentRef = ctx.alloc.next();
  ctx.writer.object(contentRef.num, 0, flateStream(pageContentOps(ops, boxes)));
  const changes: Record<string, PdfValue | undefined> = { Contents: contentRef, Resources: cleaned };
  const annots = await filterAnnotations(ctx, analysis.pageDict, boxes);
  if (annots !== null) changes.Annots = annots.length === 0 ? undefined : annots;
  return ok(changes);
}

/** Contenido de una página con zonas: el original envuelto en `q`/`Q` y, después, un rectángulo negro por zona. */
function pageContentOps(ops: readonly ContentOp[], boxes: readonly Box[]): ContentOp[] {
  const blacks = boxes.flatMap((box): ContentOp[] => [
    opOf('q'),
    opOf('g', 0),
    opOf('re', box[0], box[1], box[2] - box[0], box[3] - box[1]),
    opOf('f'),
    opOf('Q'),
  ]);
  return [opOf('q'), ...ops, opOf('Q'), ...blacks];
}

/** Página en imagen: la imagen de la página ocupa la caja, sin texto ni anotaciones. */
async function rasterChanges(ctx: Context, analysis: PageAnalysis): Promise<Result<Record<string, PdfValue | undefined>>> {
  const jpeg = ctx.rasterPages.get(analysis.plan.pageIndex);
  if (jpeg === undefined) return err(pdfError('organize-invalid'));
  const box = await pageBox(ctx.reader, analysis.pageDict);
  if (box === null || box[2] - box[0] <= 0 || box[3] - box[1] <= 0) return err(pdfError('organize-invalid'));
  const image = jpegImageObject(jpeg);
  if (!image.ok) return image;

  const imageRef = ctx.alloc.next();
  ctx.writer.object(imageRef.num, 0, image.value);
  const contentRef = ctx.alloc.next();
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  const ops = [opOf('q'), opOf('cm', width, 0, 0, height, box[0], box[1]), { op: 'Do', operands: [name(RASTER_NAME)] }, opOf('Q')];
  ctx.writer.object(contentRef.num, 0, flateStream(ops));
  // Sin anotaciones: se registran los widgets para quitarlos de /AcroForm.
  await filterAnnotations(ctx, analysis.pageDict, null);
  return ok({
    Contents: contentRef,
    Resources: dict({ XObject: dict({ [RASTER_NAME]: imageRef }) }),
    Annots: undefined,
  });
}

/**
 * Anotaciones que quedan: `null` si no cambian. Con `boxes` quita las que tocan una zona (y su `/Popup`); con `null`
 * (página en imagen) quita todas. Los widgets quitados se añaden a `ctx.widgets` para su limpieza de `/AcroForm`.
 */
async function filterAnnotations(
  ctx: Context,
  pageDict: PdfDict,
  boxes: readonly Box[] | null,
): Promise<readonly PdfValue[] | null> {
  const annots = await ctx.reader.resolve(dictGet(pageDict, 'Annots'));
  if (!Array.isArray(annots)) return null;
  const entries: AnnotEntry[] = [];
  for (const item of annots) {
    if (!isRef(item)) {
      entries.push({ item, num: null, popup: null, widget: false, drop: boxes === null });
      continue;
    }
    const annot = await ctx.reader.getDict(item);
    const rect = annot === null ? null : numericArray(await ctx.reader.resolve(dictGet(annot, 'Rect')), 4);
    const popup = annot === null ? undefined : dictGet(annot, 'Popup');
    const subtype = annot === null ? undefined : dictGet(annot, 'Subtype');
    const widget = isName(subtype) && subtype.value === 'Widget';
    const drop = boxes === null || (rect !== null && touchesAny(rectQuad(rect), boxes));
    entries.push({ item, num: item.num, popup: isRef(popup) ? popup.num : null, widget, drop });
  }

  const dropped = new Set<number>();
  for (const entry of entries) if (entry.drop && entry.num !== null) dropped.add(entry.num);
  for (const entry of entries) if (entry.drop && entry.popup !== null) dropped.add(entry.popup);
  for (const entry of entries) {
    if (entry.num !== null && dropped.has(entry.num) && entry.widget) ctx.widgets.add(entry.num);
  }
  const kept = entries.filter((entry) => entry.num === null || !dropped.has(entry.num)).map((entry) => entry.item);
  return kept.length === annots.length ? null : kept;
}

interface AnnotEntry {
  readonly item: PdfValue;
  readonly num: number | null;
  readonly popup: number | null;
  readonly widget: boolean;
  readonly drop: boolean;
}

/**
 * Operaciones de texto con sus glifos quitados. Sin glifos que toquen una zona, la operación no cambia. Si un glifo
 * no tiene avance expresable (`Tfs` 0), se quita el texto de la operación. `'` y `"` conservan su `T*` (y `Tw`/`Tc`).
 */
function editText(operation: ContentOp, glyphs: readonly GlyphBox[], boxes: readonly Box[]): readonly ContentOp[] {
  const removed = glyphs.map((glyph) => touchesAny(glyph.quad, boxes));
  if (!removed.some((flag) => flag)) return [operation];
  const prefix = statePrefix(operation);
  const unexpressible = glyphs.some((glyph, index) => removed[index] === true && glyph.shift === null);
  if (unexpressible) return prefix;
  const items = textItems(operation);
  return [...prefix, { op: 'TJ', operands: [redactItems(items, glyphs, removed)] }];
}

/** Operaciones que hay que conservar delante de un `TJ` equivalente: `'` → `T*`; `"` → `aw Tw ac Tc T*`. */
function statePrefix(operation: ContentOp): ContentOp[] {
  if (operation.op === "'") return [opOf('T*')];
  if (operation.op === '"') {
    const [aw = 0, ac = 0] = operation.operands;
    return [{ op: 'Tw', operands: [aw] }, { op: 'Tc', operands: [ac] }, opOf('T*')];
  }
  return [];
}

/** Cadenas y ajustes de la operación de texto, en orden. `Tj`/`'` tienen una cadena; `"`, la tercera operando. */
function textItems(operation: ContentOp): readonly PdfValue[] {
  if (operation.op === 'TJ') {
    const [items] = operation.operands;
    return Array.isArray(items) ? items : [];
  }
  const index = operation.op === '"' ? 2 : 0;
  return [operation.operands[index] ?? null];
}

/**
 * Elementos de `TJ` con los glifos quitados sustituidos por su ajuste; los ajustes vecinos se suman. Los códigos que
 * se quedan van en cadenas del mismo tipo (literal o hexadecimal) que su original.
 */
function redactItems(items: readonly PdfValue[], glyphs: readonly GlyphBox[], removed: readonly boolean[]): PdfValue[] {
  const out: PdfValue[] = [];
  let run: number[] = [];
  let runHex = false;
  const flush = (): void => {
    if (run.length > 0) out.push(bytesString(Uint8Array.from(run), runHex));
    run = [];
  };
  const addNumber = (value: number): void => {
    flush();
    const last = out[out.length - 1];
    if (typeof last === 'number') out[out.length - 1] = last + value;
    else out.push(value);
  };

  let index = 0;
  for (const item of items) {
    if (typeof item === 'number') {
      addNumber(item);
      continue;
    }
    if (!isString(item)) continue;
    let at = 0;
    while (at < item.bytes.length) {
      const glyph = glyphs[index];
      if (glyph === undefined || at + glyph.length > item.bytes.length) throw new RangeError('glifos desalineados con la cadena de texto');
      if (removed[index] === true) {
        addNumber(glyph.shift ?? 0);
      } else {
        if (run.length === 0) runHex = item.hex;
        for (const byte of item.bytes.subarray(at, at + glyph.length)) run.push(byte);
      }
      at += glyph.length;
      index += 1;
    }
  }
  flush();
  return out;
}

function groupGlyphs(glyphs: readonly GlyphBox[]): Map<number, GlyphBox[]> {
  const groups = new Map<number, GlyphBox[]>();
  for (const glyph of glyphs) {
    const list = groups.get(glyph.op) ?? [];
    list.push(glyph);
    groups.set(glyph.op, list);
  }
  return groups;
}

/** Caja de la página en espacio de usuario: `/CropBox` o, si no, `/MediaBox`, heredadas. */
async function pageBox(reader: ObjectReader, page: PdfDict): Promise<Box | null> {
  for (const key of ['CropBox', 'MediaBox'] as const) {
    const numbers = numericArray(await inheritedValue(reader, page, key), 4);
    if (numbers !== null) {
      const [a = 0, b = 0, c = 0, d = 0] = numbers;
      return normalize([a, b, c, d]);
    }
  }
  return null;
}

async function inheritedValue(reader: ObjectReader, page: PdfDict, key: string): Promise<PdfValue | undefined> {
  let node: PdfDict | null = page;
  for (let depth = 0; node !== null && depth < MAX_INHERITANCE; depth += 1) {
    const value = dictGet(node, key);
    if (value !== undefined) return reader.resolve(value);
    const parent = dictGet(node, 'Parent');
    node = isRef(parent) ? await reader.getDict(parent) : null;
  }
  return undefined;
}

function flateStream(ops: readonly ContentOp[]): PdfStream {
  return stream({ Filter: name('FlateDecode') }, flateEncode(serializeContent(ops)));
}

function opOf(operator: string, ...operands: readonly number[]): ContentOp {
  return { op: operator, operands };
}

function nameOperand(operation: ContentOp): string | null {
  const [value] = operation.operands;
  return isName(value) ? value.value : null;
}

/** Array de exactamente `count` números; `null` si no lo es. */
function numericArray(value: PdfValue | undefined, count: number): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== count) return null;
  const numeric = value.filter((v): v is number => typeof v === 'number');
  return numeric.length === count ? numeric : null;
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isName(v: PdfValue | undefined): v is { readonly kind: 'name'; readonly value: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}

function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}
