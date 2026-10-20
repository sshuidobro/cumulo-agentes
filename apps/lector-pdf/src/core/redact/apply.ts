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
  removeGlyphs,
  serializeContent,
  type ContentOp,
  type ImageBox,
  type PageContent,
  type Quad,
} from '../content';
import { pdfError } from '../errors';
import { removeWidgetRefs } from '../organize/forms-cleanup';
import type { RandomBytes } from '../pdf/crypt-rules';
import { finishDelta, reserveXref, startDelta, type DeltaWriter } from '../pdf/delta-writer';
import { decodeStreamData, flateEncode } from '../pdf/filters';
import { jpegImageObject } from '../pdf/image';
import type { ObjectReader } from '../pdf/object-reader';
import { catalogRef, createAllocator, type ObjectAllocator } from '../pdf/page-tree';
import { effectiveResources } from '../pdf/page-content';
import {
  dict,
  dictGet,
  name,
  PdfSyntaxError,
  stream,
  withEntries,
  type PdfDict,
  type PdfStream,
  type PdfRef,
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
/** Imagen parcialmente cubierta de una página (PDF-136). */
export interface PartialImage {
  /** Nombre del XObject en `/Resources` de la página. */
  readonly name: string;
  readonly kind: 'jpeg' | 'flate';
  readonly width: number;
  readonly height: number;
  /** Zonas en píxeles de la imagen (origen arriba-izquierda), ya recortadas a la imagen: `[x0, y0, x1, y1)`, mitad abierta. */
  readonly pixelRects: readonly RectPt[];
  /** Solo `jpeg`: bytes del flujo tal cual. */
  readonly jpeg?: Uint8Array;
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
  /** `"<página>:<nombre>"` → JPEG ya pintado de negro en sus zonas; solo para imágenes `jpeg` parcialmente cubiertas. */
  readonly imageReplacements: ReadonlyMap<string, Uint8Array>;
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
/** Tolerancia de redondeo de las zonas en píxeles (evita que 49.9999999 pase a 50 píxeles enteros). */
const SNAP = 1e-9;
/** Profundidad máxima de `/Parent` al buscar cajas y recursos heredados. */
const MAX_INHERITANCE = 64;
/** Claves de imagen que impiden redactarla por píxeles (PDF-136): máscaras, decodificación y máscara de tinta. */
const UNSUPPORTED_IMAGE_KEYS: readonly string[] = ['SMask', 'Mask', 'Decode', 'ImageMask'];

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
  readonly imageReplacements: ReadonlyMap<string, Uint8Array>;
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
    imageReplacements: input.imageReplacements,
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
  const partialImages = content === null
    || content.unmeasured.length > 0
    || content.forms.some((form) => touchesAny(form.quad, boxes))
    ? null
    : await partialImagesOf(reader, pageDict, content, boxes);
  const raster = partialImages === null;
  return {
    plan: { pageIndex, raster, partialImages: partialImages ?? [] },
    pageRef,
    pageDict,
    content: raster ? null : content,
  };
}

/**
 * Imágenes por nombre que cubren una zona sin caber enteras en ella (PDF-136). `null` si alguna no se puede tratar sin
 * convertir la página en imagen: dibujada en línea, con la CTM girada o sesgada, o de un tipo que no se redacta por píxeles.
 */
async function partialImagesOf(
  reader: ObjectReader,
  pageDict: PdfDict,
  content: PageContent,
  boxes: readonly Box[],
): Promise<readonly PartialImage[] | null> {
  const partial = content.images.filter((image) => touchesAny(image.quad, boxes) && !containedInAny(image.quad, boxes));
  if (partial.length === 0) return [];
  const xobjects = dictGet(await effectiveResources(reader, pageDict), 'XObject');
  if (!isDict(xobjects)) return null;

  const names = new Set<string>();
  for (const image of partial) {
    if (image.name === null) return null;
    names.add(image.name);
  }
  const images: PartialImage[] = [];
  for (const name of names) {
    const stream = await imageStream(reader, xobjects, name);
    const facts = stream === null ? null : await admittedImage(reader, stream.dict);
    if (stream === null || facts === null) return null;
    const rects: RectPt[] = [];
    for (const use of content.images) {
      if (use.name !== name || !touchesAny(use.quad, boxes)) continue;
      const pixels = pixelRectsOf(use, boxes, facts.width, facts.height);
      if (pixels === null) return null;
      rects.push(...pixels);
    }
    images.push({
      name,
      kind: facts.kind,
      width: facts.width,
      height: facts.height,
      pixelRects: rects,
      ...(facts.kind === 'jpeg' ? { jpeg: stream.data } : {}),
    });
  }
  return images;
}

/** Datos de una imagen que se redacta por píxeles. `components` es 1 (gris) o 3 (RGB). */
interface ImageFacts {
  readonly kind: 'jpeg' | 'flate';
  readonly width: number;
  readonly height: number;
  readonly components: 1 | 3;
}

/**
 * Imagen que se puede redactar por píxeles: `jpeg` con `/DCTDecode` solo, o `flate` con `/FlateDecode` solo y 8 bits,
 * ambos en `/DeviceGray` o `/DeviceRGB`, sin máscaras ni `/Decode`. `null` si no.
 */
async function admittedImage(reader: ObjectReader, dict: PdfDict): Promise<ImageFacts | null> {
  if (UNSUPPORTED_IMAGE_KEYS.some((key) => dictGet(dict, key) !== undefined)) return null;
  const width = await reader.resolve(dictGet(dict, 'Width'));
  const height = await reader.resolve(dictGet(dict, 'Height'));
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return null;
  const colorSpace = await reader.resolve(dictGet(dict, 'ColorSpace'));
  if (!isName(colorSpace) || (colorSpace.value !== 'DeviceGray' && colorSpace.value !== 'DeviceRGB')) return null;
  const components = colorSpace.value === 'DeviceGray' ? 1 : 3;
  const filters = await filterNames(reader, dictGet(dict, 'Filter'));
  if (filters.length !== 1) return null;
  if (filters[0] === 'DCTDecode') return { kind: 'jpeg', width, height, components };
  if (filters[0] !== 'FlateDecode') return null;
  const bits = await reader.resolve(dictGet(dict, 'BitsPerComponent'));
  return bits === 8 ? { kind: 'flate', width, height, components } : null;
}

/** Nombres de `/Filter` (un nombre o un array de nombres); `[]` si no hay filtro o algún elemento no es nombre. */
async function filterNames(reader: ObjectReader, value: PdfValue | undefined): Promise<readonly string[]> {
  const resolved = await reader.resolve(value);
  if (isName(resolved)) return [resolved.value];
  if (!Array.isArray(resolved)) return [];
  const names: string[] = [];
  for (const item of resolved) {
    const element = await reader.resolve(item);
    if (!isName(element)) return [];
    names.push(element.value);
  }
  return names;
}

/** Flujo de imagen del XObject `imageName`, o `null` si no es un flujo. */
async function imageStream(reader: ObjectReader, xobjects: PdfDict, imageName: string): Promise<PdfStream | null> {
  const value = await reader.resolve(dictGet(xobjects, imageName));
  return isStream(value) ? value : null;
}

/**
 * Zonas en píxeles (`[x0, y0, x1, y1)`) que cubre `zones` dentro de la imagen dibujada en `use`, recortadas a ella y
 * redondeadas hacia fuera. `null` si la CTM está girada o sesgada (`b` o `c` ≠ 0) o es degenerada.
 */
function pixelRectsOf(use: ImageBox, zones: readonly Box[], width: number, height: number): RectPt[] | null {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = use.quad;
  // Con la imagen en el cuadrado unidad: el punto (1, 0) va a (a + e, b + f) y el (0, 1) a (c + e, d + f).
  const a = x1 - x0;
  const b = y1 - y0;
  const c = x3 - x0;
  const d = y3 - y0;
  const e = x0;
  const f = y0;
  if (Math.abs(b) > EPSILON || Math.abs(c) > EPSILON || Math.abs(a) <= EPSILON || Math.abs(d) <= EPSILON) return null;
  const [bx0, by0, bx1, by1] = normalize([e, f, e + a, f + d]);
  const rects: RectPt[] = [];
  for (const zone of zones) {
    const ix0 = Math.max(zone[0], bx0);
    const iy0 = Math.max(zone[1], by0);
    const ix1 = Math.min(zone[2], bx1);
    const iy1 = Math.min(zone[3], by1);
    if (ix1 - ix0 <= 0 || iy1 - iy0 <= 0) continue;
    const uA = clamp01((ix0 - e) / a);
    const uB = clamp01((ix1 - e) / a);
    const vA = clamp01((iy0 - f) / d);
    const vB = clamp01((iy1 - f) / d);
    const u0 = Math.min(uA, uB);
    const u1 = Math.max(uA, uB);
    const v0 = Math.min(vA, vB);
    const v1 = Math.max(vA, vB);
    // Fila 0 arriba: la fila de la coordenada v es (1 − v) · alto.
    const px0 = Math.max(0, Math.floor(u0 * width + SNAP));
    const px1 = Math.min(width, Math.ceil(u1 * width - SNAP));
    const py0 = Math.max(0, Math.floor((1 - v1) * height + SNAP));
    const py1 = Math.min(height, Math.ceil((1 - v0) * height - SNAP));
    if (px1 <= px0 || py1 <= py0) continue;
    rects.push([px0, py0, px1, py1]);
  }
  return rects;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  // Solo las imágenes que caben enteras en una zona desaparecen; las parciales se sustituyen (PDF-136).
  const removedImageOps = new Set<number>();
  for (const image of content.images) {
    if (touchesAny(image.quad, boxes) && containedInAny(image.quad, boxes)) removedImageOps.add(image.op);
  }
  const removedNames: string[] = [];
  for (const [index, op] of content.ops.entries()) {
    if (!removedImageOps.has(index)) continue;
    const imageName = op.op === 'Do' ? nameOperand(op) : null;
    if (imageName !== null) removedNames.push(imageName);
  }

  const ops = removeGlyphs(content, (glyph) => touchesAny(glyph.quad, boxes), removedImageOps);

  const remaining = new Set(ops.flatMap((operation): string[] => {
    const used = operation.op === 'Do' ? nameOperand(operation) : null;
    return used === null ? [] : [used];
  }));
  const resources = await effectiveResources(ctx.reader, analysis.pageDict);
  const xobjects = dictGet(resources, 'XObject');
  const replaced = await partialImageObjects(ctx, analysis.plan, xobjects);
  if (!replaced.ok) return replaced;
  const xobjectChanges: Record<string, PdfValue | undefined> = {};
  for (const imageName of removedNames) {
    if (!remaining.has(imageName)) xobjectChanges[imageName] = undefined;
  }
  Object.assign(xobjectChanges, replaced.value);
  const cleaned = isDict(xobjects) && Object.keys(xobjectChanges).length > 0
    ? withEntries(resources, { XObject: withEntries(xobjects, xobjectChanges) })
    : resources;

  const contentRef = ctx.alloc.next();
  ctx.writer.object(contentRef.num, 0, flateStream(pageContentOps(ops, boxes)));
  const changes: Record<string, PdfValue | undefined> = { Contents: contentRef, Resources: cleaned };
  const annots = await filterAnnotations(ctx, analysis.pageDict, boxes);
  if (annots !== null) changes.Annots = annots.length === 0 ? undefined : annots;
  return ok(changes);
}

/**
 * Objetos nuevos de las imágenes parcialmente cubiertas de la página, por nombre de XObject. Cada una es propia de la
 * página: las demás páginas que comparten la imagen original no cambian.
 */
async function partialImageObjects(ctx: Context, plan: PagePlan, xobjects: PdfValue | undefined): Promise<Result<Record<string, PdfRef>>> {
  const out: Record<string, PdfRef> = {};
  for (const image of plan.partialImages) {
    const stream = isDict(xobjects) ? await imageStream(ctx.reader, xobjects, image.name) : null;
    const facts = stream === null ? null : await admittedImage(ctx.reader, stream.dict);
    if (stream === null || facts === null) return err(pdfError('organize-invalid'));
    let object: PdfStream;
    if (image.kind === 'jpeg') {
      const painted = ctx.imageReplacements.get(`${String(plan.pageIndex)}:${image.name}`);
      if (painted === undefined) return err(pdfError('organize-invalid'));
      const jpeg = jpegImageObject(painted);
      if (!jpeg.ok) return jpeg;
      object = jpeg.value;
    } else {
      const flate = blackenedFlate(stream, facts, image.pixelRects);
      if (!flate.ok) return flate;
      object = flate.value;
    }
    const ref = ctx.alloc.next();
    ctx.writer.object(ref.num, 0, object);
    out[image.name] = ref;
  }
  return ok(out);
}

/**
 * Imagen `flate` con sus píxeles en `rects` a negro (todos los canales a 0), recodificada sin predictor y sin
 * `/DecodeParms`. Un flujo cuyo tamaño no cuadra con sus dimensiones es `invalid-image`.
 */
function blackenedFlate(source: PdfStream, facts: ImageFacts, rects: readonly RectPt[]): Result<PdfStream> {
  const pixels = Uint8Array.from(decodeStreamData(source));
  const stride = facts.width * facts.components;
  if (pixels.length !== stride * facts.height) return err(pdfError('invalid-image'));
  for (const [x0, y0, x1, y1] of rects) {
    for (let row = y0; row < y1; row += 1) {
      pixels.fill(0, row * stride + x0 * facts.components, row * stride + x1 * facts.components);
    }
  }
  const entries = [...source.dict.entries].filter(([key]) => key !== 'DecodeParms' && key !== 'Length');
  return ok(stream(Object.fromEntries(entries), flateEncode(pixels)));
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

function isStream(v: PdfValue | undefined): v is PdfStream {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'stream';
}

function isPositiveInteger(v: PdfValue | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}
