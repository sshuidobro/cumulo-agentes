/**
 * Escritor incremental de anotaciones (ISO 32000-1 §7.5.6, ADR-0009). Convierte la diferencia de
 * anotaciones en un incremento que se anexa tras el último `%%EOF`. Nunca toca ni carga el resto del
 * fichero: solo lee la xref, el diccionario de cada página tocada y los objetos de las anotaciones
 * afectadas (ADR-0014). Nunca lanza: los errores vuelven como `Result`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type AppError, type Result } from '@suite/shared';
import { inflateSync } from 'fflate';
import { buildAppearance } from '../annotations/appearance';
import { isEmptyDiff, type AnnotationDiff } from '../annotations/diff';
import type { Annotation, PdfObjRef } from '../annotations/model';
import { annotationDict, popupDict, updatedDict } from '../annotations/to-pdf';
import { fromBase64 } from '../base64';
import { pdfError } from '../errors';
import type { FieldChange } from '../forms/diff';
import { planFieldWrites } from '../forms/to-pdf';
import { finishDelta, reserveXref, startDelta, type DeltaWriter } from './delta-writer';
import type { RandomBytes } from './crypt-rules';
import { jpegImageObject, rgbaImageObjects } from './image';
import {
  dictGet,
  PdfSyntaxError,
  ref,
  withEntries,
  type PdfDict,
  type PdfRef,
  type PdfValue,
} from './objects';
import { ObjectReader } from './object-reader';

export interface IncrementalInput {
  readonly source: ByteSource;
  /** Abierto sobre el mismo `source`. */
  readonly reader: ObjectReader;
  readonly diff: AnnotationDiff;
  /** ISO 8601; lo pasa quien llama (así el resultado es determinista). */
  readonly now: string;
  /** Valores de formulario cambiados (PDF-042). Por defecto, ninguno. */
  readonly fields?: readonly FieldChange[];
  /** IV de AES para cifrar los objetos. Por defecto, el del lector; con uno fijo el delta es determinista. */
  readonly random?: RandomBytes;
}

export interface IncrementalOutput {
  /** Bytes a anexar al original. */
  readonly delta: Uint8Array;
  /** Tamaño del fichero resultante: `source.size + delta.length`. */
  readonly expectedSize: number;
  /** Id de anotación → objeto escrito. */
  readonly written: ReadonlyMap<string, PdfObjRef>;
}

interface AddedPlan {
  readonly a: Annotation;
  readonly annot: PdfRef;
  readonly ap: PdfRef;
  /** Solo para notas. */
  readonly popup: PdfRef | null;
  /**
   * Números reservados para los objetos de imagen de una firma: `[imagen, SMask]` si es `rgba-deflate`,
   * `[imagen]` si es `jpeg`, ninguno en el resto. Se reservan aquí para que la xref no tenga huecos.
   */
  readonly extra: readonly PdfRef[];
}

interface ModifiedPlan {
  readonly a: Annotation;
  readonly origin: PdfObjRef;
  readonly ap: PdfRef;
}

/**
 * Escribe el incremento. Diff vacío → `delta` vacío. Cualquier fallo se devuelve como `Result`:
 * contraseña errónea → `save-wrong-password`; cifrado no soportado → `save-encryption-unsupported`;
 * cualquier otra lectura o estructura dañada → `save-unreadable`.
 */
export async function buildIncrementalUpdate(input: IncrementalInput): Promise<Result<IncrementalOutput>> {
  try {
    return ok(await writeUpdate(input));
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

/** Error de guardado (`Result`) a partir de un fallo de lectura o escritura. Lo comparten los escritores de PDF. */
export function toSaveError(error: unknown): AppError {
  if (error instanceof PdfSyntaxError && error.message === 'wrong-password') return pdfError('save-wrong-password', error);
  if (error instanceof PdfSyntaxError && error.message === 'encryption-unsupported') {
    return pdfError('save-encryption-unsupported', error);
  }
  return pdfError('save-unreadable', error);
}

/**
 * Abre el lector para guardar: única forma en que la app abre un lector para escribir (PDF-037).
 * `password` abre un PDF cifrado (por defecto, la vacía). Nunca lanza: los fallos vuelven como `Result`
 * (ver `buildIncrementalUpdate`).
 */
export async function openForSave(source: ByteSource, password?: string): Promise<Result<ObjectReader>> {
  try {
    return ok(await ObjectReader.open(source, password === undefined ? {} : { password }));
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeUpdate(input: IncrementalInput): Promise<IncrementalOutput> {
  const { source, reader, diff, now } = input;
  const fields = input.fields ?? [];
  if (isEmptyDiff(diff) && fields.length === 0) {
    return { delta: new Uint8Array(0), expectedSize: source.size, written: new Map() };
  }

  const trailer = reader.xref.trailer;
  const root = dictGet(trailer, 'Root');
  if (!isRefValue(root)) throw unreadable('Root');

  // 1. Números de objeto: anotación, apariencia y popup (solo notas) por cada añadida; apariencia por cada modificada.
  let next = reader.xref.size;
  const added: AddedPlan[] = diff.added.map((a) => {
    const annot = ref(next++);
    const ap = ref(next++);
    const popup = a.type === 'note' ? ref(next++) : null;
    const extra = Array.from({ length: imageObjectCount(a) }, () => ref(next++));
    return { a, annot, ap, popup, extra };
  });
  const modified: ModifiedPlan[] = diff.modified.map((a) => ({ a, origin: fileOrigin(a).ref, ap: ref(next++) }));
  const fieldWrites = await planFieldWrites(reader, fields, () => ref(next++));
  const { xrefNum, size } = reserveXref(reader, next);

  // 2. Huecos de las anotaciones borradas: sus números y los de sus popups, agrupados por página.
  const removedByPage = new Map<number, Set<number>>();
  for (const a of diff.removed) {
    const origin = fileOrigin(a);
    const nums = removedByPage.get(a.pageIndex) ?? new Set<number>();
    removedByPage.set(a.pageIndex, nums);
    nums.add(origin.ref.num);
    if (origin.popupRef !== null) nums.add(origin.popupRef.num);
    const dictOfAnnot = await reader.getDict(toRef(origin.ref));
    if (dictOfAnnot === null) throw unreadable(`anotación ${a.id}`);
    const popup = dictGet(dictOfAnnot, 'Popup');
    if (isRefValue(popup)) nums.add(popup.num);
  }

  const addedByPage = new Map<number, AddedPlan[]>();
  for (const p of added) {
    const list = addedByPage.get(p.a.pageIndex) ?? [];
    list.push(p);
    addedByPage.set(p.a.pageIndex, list);
  }

  const written = new Map<string, PdfObjRef>();
  for (const p of added) written.set(p.a.id, { num: p.annot.num, gen: 0 });
  for (const m of modified) written.set(m.a.id, m.origin);

  // 3. Escritura. El delta empieza con un salto de línea si el original no termina en uno.
  const writer = await startDelta(source, reader, input.random);

  // Modificadas: mismo número y generación; el resto de claves se conserva.
  for (const m of modified) {
    const original = await reader.getDict(toRef(m.origin));
    if (original === null) throw unreadable(`anotación ${m.a.id}`);
    writer.object(m.origin.num, m.origin.gen, updatedDict(original, m.a, { apRef: m.ap, now }));
    writer.object(m.ap.num, 0, buildAppearance(m.a).stream);
  }

  // Valores de formulario (PDF-042): tras las anotaciones modificadas y antes de las páginas.
  for (const w of fieldWrites) writer.object(w.num, w.gen, w.value);

  // Páginas tocadas, en orden para que la salida sea determinista.
  const pages = [...new Set([...addedByPage.keys(), ...removedByPage.keys()])].sort((x, y) => x - y);
  for (const index of pages) {
    await rewritePage(reader, writer, index, addedByPage.get(index) ?? [], removedByPage.get(index) ?? new Set(), now);
  }

  // 4. Sección xref con el mismo tipo que la última del original.
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  return { delta, expectedSize: source.size + delta.length, written };
}

/**
 * Reescribe la página `index`: quita las refs de las anotaciones borradas (y sus popups), añade las
 * nuevas y escribe las anotaciones nuevas con su apariencia y popup. Si `/Annots` es un array indirecto
 * se reescribe solo ese array; si es directo o no existe, se reescribe la página.
 */
async function rewritePage(
  reader: ObjectReader,
  writer: DeltaWriter,
  index: number,
  added: readonly AddedPlan[],
  removedNums: ReadonlySet<number>,
  now: string,
): Promise<void> {
  const pageRef = await reader.pageRef(index);
  const page = await reader.getDict(pageRef);
  if (page === null) throw unreadable(`página ${index + 1}`);
  const annots = await annotsOf(reader, page, index);

  const kept = annots.items.filter((item) => !(isRefValue(item) && removedNums.has(item.num)));
  const appended: PdfRef[] = [];
  for (const p of added) {
    appended.push(p.annot);
    if (p.popup !== null) appended.push(p.popup);
  }
  const newAnnots: readonly PdfValue[] = [...kept, ...appended];

  for (const p of added) {
    writer.object(p.annot.num, 0, annotationDict(p.a, { pageRef, apRef: p.ap, popupRef: p.popup, now }));
    writer.object(p.ap.num, 0, buildAppearance(p.a, p.extra[0]).stream);
    writeSignatureImage(writer, p.a, p.extra);
    if (p.popup !== null && p.a.type === 'note') {
      writer.object(p.popup.num, 0, popupDict(p.annot, p.a.rect, p.a.open));
    }
  }

  if (annots.indirect === null) {
    writer.object(pageRef.num, pageRef.gen, withEntries(page, { Annots: newAnnots }));
  } else {
    writer.object(annots.indirect.num, annots.indirect.gen, newAnnots);
  }
}

/** Objetos de imagen que necesita `a` además de su apariencia (ver `AddedPlan.extra`). */
function imageObjectCount(a: Annotation): number {
  if (a.type !== 'signature' || a.art.kind !== 'image') return 0;
  return a.art.format === 'rgba-deflate' ? 2 : 1;
}

/**
 * Escribe el Image XObject de una firma con imagen y, si la hay, su SMask. Una SMask que no hace falta
 * (todo el alfa a 255) se escribe como `null` en su número reservado. Un dato que no se puede decodificar
 * es una estructura no legible (`save-unreadable`).
 */
function writeSignatureImage(writer: DeltaWriter, a: Annotation, refs: readonly PdfRef[]): void {
  if (a.type !== 'signature' || a.art.kind !== 'image') return;
  const art = a.art;
  const [imageRef, smaskRef] = refs;
  if (imageRef === undefined || (art.format === 'rgba-deflate' && smaskRef === undefined)) {
    throw new RangeError(`faltan números de objeto para la firma ${a.id}`);
  }
  const bytes = fromBase64(art.data);
  if (bytes === null) throw unreadable(`firma ${a.id}`);

  if (art.format === 'jpeg') {
    const image = jpegImageObject(bytes);
    if (!image.ok) throw unreadable(`firma ${a.id}`);
    writer.object(imageRef.num, 0, image.value);
    return;
  }
  if (smaskRef === undefined) throw new RangeError(`falta el número de SMask de la firma ${a.id}`);
  let rgba: Uint8Array;
  try {
    rgba = inflateSync(bytes);
  } catch {
    throw unreadable(`firma ${a.id}`);
  }
  const objects = rgbaImageObjects({ width: art.pixelWidth, height: art.pixelHeight, rgba }, smaskRef);
  writer.object(imageRef.num, 0, objects.image);
  writer.object(smaskRef.num, 0, objects.smask);
}

/** Array `/Annots` de la página: directo, indirecto o ausente (`items` vacío). */
async function annotsOf(
  reader: ObjectReader,
  page: PdfDict,
  index: number,
): Promise<{ readonly items: readonly PdfValue[]; readonly indirect: PdfRef | null }> {
  const value = dictGet(page, 'Annots');
  if (value === undefined || value === null) return { items: [], indirect: null };
  if (isArrayValue(value)) return { items: value, indirect: null };
  if (isRefValue(value)) {
    const target = await reader.get(value);
    if (isArrayValue(target)) return { items: target, indirect: value };
  }
  throw unreadable(`/Annots de la página ${index + 1}`);
}


function fileOrigin(a: Annotation): { readonly ref: PdfObjRef; readonly popupRef: PdfObjRef | null } {
  if (a.origin.kind !== 'file') throw new RangeError(`la anotación ${a.id} no proviene del fichero`);
  return a.origin;
}

function toRef(r: PdfObjRef): PdfRef {
  return ref(r.num, r.gen);
}

function unreadable(where: string): PdfSyntaxError {
  return new PdfSyntaxError(`estructura no legible: ${where}`, 0);
}

function isRefValue(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isArrayValue(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}
