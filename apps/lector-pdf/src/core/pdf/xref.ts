/**
 * Lector de la tabla de referencias cruzadas (ISO 32000-1 §7.5.4 a §7.5.8): tabla clásica,
 * *xref stream*, híbridos (`/XRefStm`) y cadena `/Prev`. Lee por rangos del `ByteSource`;
 * nunca lee los objetos del documento.
 */
import type { ByteSource } from '@suite/platform';
import { isWhitespace } from './lexer';
import { decodeStreamData, MAX_DECODED_BYTES } from './filters';
import { dictGet, PdfSyntaxError, type PdfDict, type PdfStream, type PdfValue } from './objects';
import { parseIndirectObject, parseValue } from './parser';

export type XrefEntry =
  | { readonly type: 'free' }
  | { readonly type: 'offset'; readonly offset: number; readonly gen: number }
  | { readonly type: 'compressed'; readonly objStm: number; readonly index: number };

export interface XrefInfo {
  /** Vista fusionada: la sección más nueva gana. */
  readonly entries: ReadonlyMap<number, XrefEntry>;
  /** Trailer de la última sección (para xref stream, su diccionario). */
  readonly trailer: PdfDict;
  /** Valor del último `startxref`. */
  readonly lastXrefOffset: number;
  readonly lastKind: 'table' | 'stream';
  /** `/Size` del último trailer. */
  readonly size: number;
  /** Número de secciones leídas. */
  readonly sections: number;
}

type NumberedEntry = readonly [number, XrefEntry];

interface Section {
  readonly kind: 'table' | 'stream';
  readonly trailer: PdfDict;
  /** En orden de precedencia dentro de la sección (la tabla antes que su `/XRefStm`). */
  readonly entries: readonly NumberedEntry[];
}

/** Lo que se lee de una vez; las ventanas crecen si una estructura no cabe. */
const BLOCK = 64 * 1024;
const TAIL_BYTES = 2048;
/** Tope de crecimiento de una ventana: por encima, un error de sintaxis es un error real. */
const MAX_WINDOW = 16 * 1024 * 1024;
const MAX_SECTIONS = 1000;
/** Margen mínimo antes del final de la ventana para analizar una entrada de la tabla. */
const ENTRY_MARGIN = 64;
const MAX_FIELD_WIDTH = 8;

const STARTXREF = asciiBytes('startxref');
const XREF = asciiBytes('xref');
const TRAILER = asciiBytes('trailer');

/** Ventana insuficiente: el analizador necesita más bytes. Es interno. */
class NeedMore extends Error {
  constructor() {
    super('ventana insuficiente');
    this.name = 'NeedMore';
  }
}

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function xrefError(offset: number): PdfSyntaxError {
  return new PdfSyntaxError('xref-unreadable', offset);
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isStream(v: PdfValue): v is PdfStream {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'stream';
}

function isArray(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function isXrefType(v: PdfValue | undefined): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' && v.value === 'XRef';
}

/** Entero no negativo de un diccionario, o `undefined` si falta o no es válido. */
function intValue(d: PdfDict, key: string): number | undefined {
  const v = dictGet(d, key);
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/** Ventana de bytes desde una posición absoluta. Lee a lo sumo `len` bytes. */
interface View {
  readonly buf: Uint8Array;
  readonly eof: boolean;
}

async function view(src: ByteSource, pos: number, len: number): Promise<View> {
  if (pos >= src.size) return { buf: new Uint8Array(0), eof: true };
  const end = Math.min(src.size, pos + len);
  return { buf: await src.read(pos, end), eof: end >= src.size };
}

/**
 * Ejecuta `parse` sobre la ventana que empieza en `pos`. Si la ventana no basta
 * (`NeedMore` o error de sintaxis sin llegar al final del fichero), la duplica y reintenta.
 */
async function withView<T>(src: ByteSource, pos: number, parse: (buf: Uint8Array, eof: boolean) => T): Promise<T> {
  let len = BLOCK;
  for (;;) {
    const { buf, eof } = await view(src, pos, len);
    try {
      return parse(buf, eof);
    } catch (error) {
      const growable = !eof && len < MAX_WINDOW
        && (error instanceof NeedMore || error instanceof PdfSyntaxError);
      if (!growable) throw error;
      len *= 2;
    }
  }
}

function byteAt(buf: Uint8Array, i: number): number {
  return buf[i] ?? 0;
}

function skipWhitespace(buf: Uint8Array, from: number, eof: boolean): number {
  let i = from;
  while (i < buf.length && isWhitespace(byteAt(buf, i))) i++;
  if (i >= buf.length && !eof) throw new NeedMore();
  return i;
}

/** Comprueba `word` en `i`. Si la ventana acaba antes, pide más bytes. */
function matchWord(buf: Uint8Array, i: number, word: Uint8Array, eof: boolean): boolean {
  if (i + word.length > buf.length && !eof) {
    for (let k = 0; k < buf.length - i; k++) {
      if (byteAt(buf, i + k) !== word[k]) return false;
    }
    throw new NeedMore();
  }
  return word.every((b, k) => byteAt(buf, i + k) === b);
}

/** Entero decimal sin signo tras saltar blancos. Devuelve el valor y el índice siguiente. */
function readInt(buf: Uint8Array, from: number, eof: boolean): { readonly value: number; readonly next: number } {
  const start = skipWhitespace(buf, from, eof);
  let i = start;
  let value = 0;
  while (i < buf.length && byteAt(buf, i) >= 0x30 && byteAt(buf, i) <= 0x39) {
    value = value * 10 + (byteAt(buf, i) - 0x30);
    i++;
  }
  if (i >= buf.length && !eof) throw new NeedMore();
  if (i === start) throw new PdfSyntaxError('se esperaba un entero en xref', start);
  return { value, next: i };
}

/** Busca la última aparición de `pattern` en `buf`. Devuelve -1 si no está. */
function lastIndexOf(buf: Uint8Array, pattern: Uint8Array): number {
  for (let i = buf.length - pattern.length; i >= 0; i--) {
    if (pattern.every((b, k) => byteAt(buf, i + k) === b)) return i;
  }
  return -1;
}

/** Localiza el último `startxref` en los últimos 2 048 bytes y lee su valor. */
async function findStartxref(src: ByteSource): Promise<number> {
  const tailStart = Math.max(0, src.size - TAIL_BYTES);
  const buf = await src.read(tailStart, src.size);
  const at = lastIndexOf(buf, STARTXREF);
  if (at < 0) throw xrefError(tailStart);
  try {
    return readInt(buf, at + STARTXREF.length, true).value;
  } catch {
    throw xrefError(tailStart + at);
  }
}

/** Tabla clásica: subsecciones `inicio cantidad` y entradas de 20 bytes (tolera 19 y 21). */
function parseEntries(
  buf: Uint8Array,
  eof: boolean,
  firstNum: number,
  max: number,
): { readonly entries: readonly NumberedEntry[]; readonly consumed: number } {
  const entries: NumberedEntry[] = [];
  let i = 0;
  while (entries.length < max && (eof || buf.length - i >= ENTRY_MARGIN)) {
    const offset = readInt(buf, i, eof);
    const gen = readInt(buf, offset.next, eof);
    const kindAt = skipWhitespace(buf, gen.next, eof);
    const kind = byteAt(buf, kindAt);
    if (kindAt >= buf.length) throw new PdfSyntaxError('entrada de xref incompleta', kindAt);
    const num = firstNum + entries.length;
    if (kind === 0x6e) {
      // 'n': una entrada en el offset 0 no apunta a ningún objeto; se trata como libre.
      entries.push([num, offset.value === 0 ? { type: 'free' } : { type: 'offset', offset: offset.value, gen: gen.value }]);
    } else if (kind === 0x66) {
      entries.push([num, { type: 'free' }]);
    } else {
      throw new PdfSyntaxError('entrada de xref no válida (se esperaba n o f)', kindAt);
    }
    i = skipWhitespace(buf, kindAt + 1, eof);
  }
  if (entries.length === 0 && !eof) throw new NeedMore();
  return { entries, consumed: i };
}

interface SubsectionHeader {
  readonly trailer: boolean;
  /** Si `trailer`, índice de la palabra `trailer`; si no, de las entradas. */
  readonly at: number;
  readonly start: number;
  readonly count: number;
}

function parseSubsectionHeader(buf: Uint8Array, eof: boolean): SubsectionHeader {
  const i = skipWhitespace(buf, 0, eof);
  if (matchWord(buf, i, TRAILER, eof)) return { trailer: true, at: i, start: 0, count: 0 };
  const start = readInt(buf, i, eof);
  const count = readInt(buf, start.next, eof);
  return { trailer: false, at: count.next, start: start.value, count: count.value };
}

async function readTable(src: ByteSource, offset: number): Promise<Section> {
  let pos = offset + XREF.length;
  const entries: NumberedEntry[] = [];
  let trailerAt: number;
  for (;;) {
    const header = await withView(src, pos, parseSubsectionHeader);
    if (header.trailer) {
      trailerAt = pos + header.at;
      break;
    }
    pos += header.at;
    let firstNum = header.start;
    let remaining = header.count;
    while (remaining > 0) {
      const batchAt = pos;
      const batch = await withView(src, batchAt, (buf, eof) => parseEntries(buf, eof, firstNum, remaining));
      for (const entry of batch.entries) entries.push(entry);
      firstNum += batch.entries.length;
      remaining -= batch.entries.length;
      pos = batchAt + batch.consumed;
    }
  }
  const trailer = await withView(src, trailerAt, (buf, eof) => {
    const i = skipWhitespace(buf, 0, eof);
    if (!matchWord(buf, i, TRAILER, eof)) throw new PdfSyntaxError('se esperaba "trailer"', i);
    return parseValue(buf, i + TRAILER.length).value;
  });
  if (!isDict(trailer)) throw xrefError(offset);
  return { kind: 'table', trailer, entries };
}

/** Ejecuta un análisis; si falla por sintaxis o por ventana, el error es `xref-unreadable` en `offset`. */
async function parsing<T>(offset: number, parse: () => Promise<T>): Promise<T> {
  try {
    return await parse();
  } catch (error) {
    if (error instanceof PdfSyntaxError || error instanceof NeedMore) throw xrefError(offset);
    throw error;
  }
}

/** Lee el objeto de xref stream en `offset` y comprueba que es `/Type /XRef`. */
async function readXrefStreamObject(src: ByteSource, offset: number): Promise<PdfStream> {
  const value = await parsing(offset, () => withView(src, offset, (buf) => parseIndirectObject(buf, 0).value));
  if (!isStream(value) || !isXrefType(dictGet(value.dict, 'Type'))) throw xrefError(offset);
  return value;
}

function readBigEndian(data: Uint8Array, at: number, width: number): number {
  let value = 0;
  for (let k = 0; k < width; k++) value = value * 256 + (data[at + k] ?? 0);
  return value;
}

/** Entradas de un xref stream decodificado: `/W` (3 anchos), `/Index` y filas consecutivas. */
function parseStreamEntries(stream: PdfStream, size: number, data: Uint8Array, offset: number): NumberedEntry[] {
  const widths = dictGet(stream.dict, 'W');
  if (!isArray(widths) || widths.length !== 3) throw xrefError(offset);
  const [w0, w1, w2] = widths.map((w) => (typeof w === 'number' && Number.isSafeInteger(w) && w >= 0 ? w : -1));
  if (w0 === undefined || w1 === undefined || w2 === undefined || w0 < 0 || w1 < 0 || w2 < 0) throw xrefError(offset);
  if (w0 > MAX_FIELD_WIDTH || w1 > MAX_FIELD_WIDTH || w2 > MAX_FIELD_WIDTH) throw xrefError(offset);
  const rowLength = w0 + w1 + w2;
  if (rowLength === 0) throw xrefError(offset);

  const indexValue = dictGet(stream.dict, 'Index');
  let index: number[];
  if (indexValue === undefined) {
    index = [0, size];
  } else if (isArray(indexValue) && indexValue.length % 2 === 0) {
    index = indexValue.map((n) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : -1));
    if (index.some((n) => n < 0)) throw xrefError(offset);
  } else {
    throw xrefError(offset);
  }

  const out: NumberedEntry[] = [];
  let row = 0;
  for (let p = 0; p < index.length; p += 2) {
    const first = index[p] ?? 0;
    const count = index[p + 1] ?? 0;
    for (let k = 0; k < count; k++) {
      const at = row * rowLength;
      // Filas incompletas al final del flujo: se ignoran (datos dañados, pero el resto sirve).
      if (at + rowLength > data.length) return out;
      const type = w0 === 0 ? 1 : readBigEndian(data, at, w0);
      const f2 = readBigEndian(data, at + w0, w1);
      const f3 = readBigEndian(data, at + w0 + w1, w2);
      let entry: XrefEntry;
      if (type === 0) entry = { type: 'free' };
      else if (type === 1) entry = { type: 'offset', offset: f2, gen: f3 };
      else if (type === 2) entry = { type: 'compressed', objStm: f2, index: f3 };
      else entry = { type: 'free' };
      out.push([first + k, entry]);
      row++;
    }
  }
  return out;
}

/**
 * Tope de bytes descomprimidos para un xref stream: una fila de `/W` (más el byte de filtro
 * de predictor) por entrada de `/Index` (o de `/Size`). Sin `/W` o `/Index` válidos se usa el tope general.
 */
function xrefOutputLimit(dict: PdfDict, size: number): number {
  const widths = dictGet(dict, 'W');
  const indexValue = dictGet(dict, 'Index');
  if (!isArray(widths) || widths.length !== 3) return MAX_DECODED_BYTES;
  if (!widths.every((w) => typeof w === 'number' && Number.isSafeInteger(w) && w >= 0)) return MAX_DECODED_BYTES;
  const rowLength = widths.reduce<number>((n, w) => n + (typeof w === 'number' ? w : 0), 0) + 1;
  let count = size;
  if (indexValue !== undefined) {
    if (!isArray(indexValue)) return MAX_DECODED_BYTES;
    count = 0;
    for (let p = 1; p < indexValue.length; p += 2) {
      const n = indexValue[p];
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return MAX_DECODED_BYTES;
      count += n;
    }
  }
  return Math.min(MAX_DECODED_BYTES, rowLength * count + rowLength);
}

/** Sección en xref stream: analiza el objeto, decodifica el flujo (los errores de filtro se conservan) y lo convierte en entradas. */
async function readXrefStreamSection(src: ByteSource, offset: number): Promise<Section> {
  const stream = await readXrefStreamObject(src, offset);
  const size = intValue(stream.dict, 'Size');
  if (size === undefined) throw xrefError(offset);
  const data = decodeStreamData(stream, xrefOutputLimit(stream.dict, size));
  return { kind: 'stream', trailer: stream.dict, entries: parseStreamEntries(stream, size, data, offset) };
}

/** Lee una sección en `offset`: tabla clásica (con su `/XRefStm` híbrido) o xref stream. */
async function readSection(src: ByteSource, offset: number): Promise<Section> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= src.size) throw xrefError(offset);
  const isTable = await parsing(offset, () =>
    withView(src, offset, (buf, eof) => matchWord(buf, skipWhitespace(buf, 0, eof), XREF, eof)));
  if (!isTable) return readXrefStreamSection(src, offset);

  const table = await parsing(offset, () => readTable(src, offset));
  const xrefStm = intValue(table.trailer, 'XRefStm');
  if (xrefStm === undefined) return table;
  const stm = await readXrefStreamSection(src, xrefStm);
  // La tabla va antes que su /XRefStm: en la vista fusionada gana la tabla.
  return { kind: 'table', trailer: table.trailer, entries: [...table.entries, ...stm.entries] };
}

/**
 * Lee la cadena de secciones xref de un PDF sin leer sus objetos. La sección más nueva
 * gana en la vista fusionada. Lanza `PdfSyntaxError('xref-unreadable')` si la cadena es
 * ilegible y `PdfSyntaxError('encrypted')` si el trailer final tiene `/Encrypt`.
 */
export async function readXref(src: ByteSource): Promise<XrefInfo> {
  const lastXrefOffset = await findStartxref(src);
  const entries = new Map<number, XrefEntry>();
  const visited = new Set<number>();
  let offset: number | null = lastXrefOffset;
  let first: Section | null = null;
  let sections = 0;

  while (offset !== null) {
    if (visited.has(offset)) break;
    if (sections === MAX_SECTIONS) throw xrefError(offset);
    visited.add(offset);
    const section = await readSection(src, offset);
    if (first === null) {
      if (dictGet(section.trailer, 'Encrypt') !== undefined) throw new PdfSyntaxError('encrypted', 0);
      first = section;
    }
    for (const [num, entry] of section.entries) {
      if (!entries.has(num)) entries.set(num, entry);
    }
    sections++;
    const prev = dictGet(section.trailer, 'Prev');
    if (prev === undefined) {
      offset = null;
    } else if (typeof prev === 'number' && Number.isSafeInteger(prev) && prev >= 0) {
      offset = prev;
    } else {
      throw xrefError(offset);
    }
  }

  if (first === null) throw xrefError(lastXrefOffset);
  const size = intValue(first.trailer, 'Size');
  if (size === undefined) throw xrefError(lastXrefOffset);
  return {
    entries,
    trailer: first.trailer,
    lastXrefOffset,
    lastKind: first.kind,
    size,
    sections,
  };
}
