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
import { jpegImageObject, rgbaImageObjects } from './image';
import {
  bytesString,
  dict,
  dictGet,
  name,
  PdfSyntaxError,
  ref,
  stream,
  withEntries,
  type PdfDict,
  type PdfRef,
  type PdfString,
  type PdfValue,
} from './objects';
import { ObjectReader } from './object-reader';
import { serializeIndirect, serializeValue } from './serialize';

export interface IncrementalInput {
  readonly source: ByteSource;
  /** Abierto sobre el mismo `source`. */
  readonly reader: ObjectReader;
  readonly diff: AnnotationDiff;
  /** ISO 8601; lo pasa quien llama (así el resultado es determinista). */
  readonly now: string;
}

export interface IncrementalOutput {
  /** Bytes a anexar al original. */
  readonly delta: Uint8Array;
  /** Tamaño del fichero resultante: `source.size + delta.length`. */
  readonly expectedSize: number;
  /** Id de anotación → objeto escrito. */
  readonly written: ReadonlyMap<string, PdfObjRef>;
}

interface XrefRow {
  readonly offset: number;
  readonly gen: number;
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

const TEXT_ENCODER = new TextEncoder();
const LF = 0x0a;
const CR = 0x0d;
/** Tamaño de cada fila de la xref de tabla y de `/W [1 4 2]`. */
const STREAM_ROW_BYTES = 7;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const ID_BYTES = 16;

/**
 * Escribe el incremento. Diff vacío → `delta` vacío. Cualquier fallo se devuelve como `Result`:
 * cifrado → `save-encrypted`; cualquier otra lectura o estructura dañada → `save-unreadable`.
 */
export async function buildIncrementalUpdate(input: IncrementalInput): Promise<Result<IncrementalOutput>> {
  try {
    return ok(await writeUpdate(input));
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

function toSaveError(error: unknown): AppError {
  if (error instanceof PdfSyntaxError && error.message === 'encrypted') return pdfError('save-encrypted', error);
  return pdfError('save-unreadable', error);
}

/**
 * Abre el lector para guardar: única forma en que la app abre un lector para escribir (PDF-037).
 * Nunca lanza: cifrado → `save-encrypted`; cualquier otro fallo → `save-unreadable`.
 */
export async function openForSave(source: ByteSource): Promise<Result<ObjectReader>> {
  try {
    return ok(await ObjectReader.open(source));
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeUpdate(input: IncrementalInput): Promise<IncrementalOutput> {
  const { source, reader, diff, now } = input;
  if (isEmptyDiff(diff)) {
    return { delta: new Uint8Array(0), expectedSize: source.size, written: new Map() };
  }

  const trailer = reader.xref.trailer;
  if (dictGet(trailer, 'Encrypt') !== undefined) throw new PdfSyntaxError('encrypted', 0);
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
  const xrefNum = reader.xref.lastKind === 'stream' ? next++ : null;
  const size = next;
  const objectCount = size - reader.xref.size;

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
  const writer = new DeltaWriter(source.size);
  if (source.size > 0) {
    const [last = LF] = await source.read(source.size - 1, source.size);
    if (last !== LF && last !== CR) writer.write(Uint8Array.of(LF));
  }

  // Modificadas: mismo número y generación; el resto de claves se conserva.
  for (const m of modified) {
    const original = await reader.getDict(toRef(m.origin));
    if (original === null) throw unreadable(`anotación ${m.a.id}`);
    writer.object(m.origin.num, m.origin.gen, updatedDict(original, m.a, { apRef: m.ap, now }));
    writer.object(m.ap.num, 0, buildAppearance(m.a).stream);
  }

  // Páginas tocadas, en orden para que la salida sea determinista.
  const pages = [...new Set([...addedByPage.keys(), ...removedByPage.keys()])].sort((x, y) => x - y);
  for (const index of pages) {
    await rewritePage(reader, writer, index, addedByPage.get(index) ?? [], removedByPage.get(index) ?? new Set(), now);
  }

  // 4. Sección xref con el mismo tipo que la última del original.
  const entries = new Map<number, XrefRow>(writer.offsets);
  const id = documentId(trailer, idSeed(now, source.size, objectCount));
  const trailerEntries = trailerDict(reader, root, id, size);

  if (xrefNum === null) {
    const xrefOffset = writer.offset;
    writer.write(text('xref\n'));
    for (const group of groupsOf(entries)) {
      writer.write(text(`${group.start} ${group.rows.length}\n`));
      for (const [, row] of group.rows) writer.write(text(tableRow(row)));
    }
    writer.write(text('trailer\n'));
    writer.write(serializeValue(dict(trailerEntries)));
    writer.write(text(`\nstartxref\n${xrefOffset}\n%%EOF\n`));
  } else {
    const xrefOffset = writer.offset;
    entries.set(xrefNum, { offset: xrefOffset, gen: 0 });
    const groups = groupsOf(entries);
    const streamDict: Record<string, PdfValue> = {
      Type: name('XRef'),
      W: [1, 4, 2],
      Index: groups.flatMap((g) => [g.start, g.rows.length]),
      ...trailerEntries,
    };
    const data = streamRows(groups);
    writer.write(serializeIndirect(xrefNum, 0, stream(streamDict, data)));
    writer.write(text(`startxref\n${xrefOffset}\n%%EOF\n`));
  }

  const delta = writer.toBytes();
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

/** Trailer del incremento. Sin `/ID` original, ambos identificadores son nuevos. */
function trailerDict(reader: ObjectReader, root: PdfRef, id: readonly [PdfString, PdfString], size: number): Record<string, PdfValue> {
  const entries: Record<string, PdfValue> = { Size: size, Root: root };
  const info = dictGet(reader.xref.trailer, 'Info');
  if (info !== undefined) entries.Info = info;
  entries.ID = [id[0], id[1]];
  entries.Prev = reader.xref.lastXrefOffset;
  return entries;
}

/**
 * `/ID` del incremento: `[id0 original, id1 nuevo]`. `id1` es determinista (16 bytes FNV-1a de `seed`).
 * Si el original no tiene `/ID` válido, `id0` también es nuevo.
 */
function documentId(trailer: PdfDict, seed: string): readonly [PdfString, PdfString] {
  const id1 = bytesString(idBytes(seed), true);
  const original = dictGet(trailer, 'ID');
  if (isArrayValue(original) && original.length === 2) {
    const [first, second] = original;
    if (isStringValue(first) && isStringValue(second)) return [first, id1];
  }
  return [id1, id1];
}

function idSeed(now: string, sourceSize: number, objectCount: number): string {
  return `${now}|${sourceSize}|${objectCount}`;
}

/** 16 bytes: cuatro pasadas de FNV-1a de 32 bits con bases distintas. */
function idBytes(seed: string): Uint8Array {
  const data = TEXT_ENCODER.encode(seed);
  const out = new Uint8Array(ID_BYTES);
  for (let lane = 0; lane < ID_BYTES / 4; lane++) {
    let h = (FNV_OFFSET_BASIS ^ Math.imul(lane + 1, 0x9e3779b1)) >>> 0;
    for (const b of data) {
      h = Math.imul(h ^ b, FNV_PRIME) >>> 0;
    }
    out[lane * 4] = (h >>> 24) & 0xff;
    out[lane * 4 + 1] = (h >>> 16) & 0xff;
    out[lane * 4 + 2] = (h >>> 8) & 0xff;
    out[lane * 4 + 3] = h & 0xff;
  }
  return out;
}

interface Group {
  readonly start: number;
  readonly rows: readonly (readonly [number, XrefRow])[];
}

/** Subsecciones de números consecutivos, ordenadas. */
function groupsOf(entries: ReadonlyMap<number, XrefRow>): Group[] {
  const nums = [...entries.keys()].sort((x, y) => x - y);
  const groups: Array<{ start: number; rows: Array<readonly [number, XrefRow]> }> = [];
  for (const num of nums) {
    const row = entries.get(num);
    if (row === undefined) continue;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.start + last.rows.length === num) {
      last.rows.push([num, row]);
    } else {
      groups.push({ start: num, rows: [[num, row]] });
    }
  }
  return groups;
}

/** Fila de una xref de tabla: 20 bytes exactos. */
function tableRow(row: XrefRow): string {
  return `${String(row.offset).padStart(10, '0')} ${String(row.gen).padStart(5, '0')} n \n`;
}

/** Filas de `/W [1 4 2]`: tipo 1 (objeto en offset), offset de 4 bytes y generación de 2. */
function streamRows(groups: readonly Group[]): Uint8Array {
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const out = new Uint8Array(count * STREAM_ROW_BYTES);
  let at = 0;
  for (const group of groups) {
    for (const [, row] of group.rows) {
      const { offset, gen } = row;
      out[at] = 1;
      out[at + 1] = (offset >>> 24) & 0xff;
      out[at + 2] = (offset >>> 16) & 0xff;
      out[at + 3] = (offset >>> 8) & 0xff;
      out[at + 4] = offset & 0xff;
      out[at + 5] = (gen >>> 8) & 0xff;
      out[at + 6] = gen & 0xff;
      at += STREAM_ROW_BYTES;
    }
  }
  return out;
}

/** Acumula el delta y registra el offset absoluto (`base` + bytes escritos) de cada objeto. */
class DeltaWriter {
  readonly offsets = new Map<number, XrefRow>();
  private readonly base: number;
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  constructor(base: number) {
    this.base = base;
  }

  /** Offset absoluto en el fichero resultante del próximo byte. */
  get offset(): number {
    return this.base + this.length;
  }

  write(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  object(num: number, gen: number, value: PdfValue): void {
    this.offsets.set(num, { offset: this.offset, gen });
    this.write(serializeIndirect(num, gen, value));
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

function fileOrigin(a: Annotation): { readonly ref: PdfObjRef; readonly popupRef: PdfObjRef | null } {
  if (a.origin.kind !== 'file') throw new RangeError(`la anotación ${a.id} no proviene del fichero`);
  return a.origin;
}

function toRef(r: PdfObjRef): PdfRef {
  return ref(r.num, r.gen);
}

function text(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
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

function isStringValue(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}
