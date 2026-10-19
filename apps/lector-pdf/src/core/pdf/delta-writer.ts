/**
 * Escritor genérico de incrementos (ISO 32000-1 §7.5.6): acumula el delta, cifra los objetos, y escribe
 * la sección xref (tabla o flujo), el trailer y `/ID`. No sabe nada de anotaciones ni formularios.
 */
import type { ByteSource } from '@suite/platform';
import type { RandomBytes } from './crypt-rules';
import type { SecurityHandler } from './crypto';
import { encryptValue } from './encrypt-value';
import { bytesString, dict, dictGet, name, stream, type PdfDict, type PdfRef, type PdfString, type PdfValue } from './objects';
import type { ObjectReader } from './object-reader';
import { serializeIndirect, serializeValue } from './serialize';

const TEXT_ENCODER = new TextEncoder();
const LF = 0x0a;
const CR = 0x0d;
/** Tamaño de cada fila de la xref de tabla y de `/W [1 4 2]`. */
const STREAM_ROW_BYTES = 7;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const ID_BYTES = 16;

export interface XrefRow {
  readonly offset: number;
  readonly gen: number;
}

/**
 * Acumula el delta y registra el offset absoluto (`base` + bytes escritos) de cada objeto. Con
 * manejador de seguridad, cifra cada objeto que escribe con `object` (la xref de flujo se escribe aparte).
 */
export class DeltaWriter {
  readonly offsets = new Map<number, XrefRow>();
  private readonly base: number;
  private readonly security: SecurityHandler | null;
  private readonly random: RandomBytes;
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  constructor(base: number, security: SecurityHandler | null, random: RandomBytes) {
    this.base = base;
    this.security = security;
    this.random = random;
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
    const out = this.security === null ? value : encryptValue(this.security, num, gen, value, this.random);
    this.offsets.set(num, { offset: this.offset, gen });
    this.write(serializeIndirect(num, gen, out));
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

/** Crea el escritor sobre `source` y escribe el LF inicial si el original no acaba en LF/CR. */
export async function startDelta(source: ByteSource, reader: ObjectReader, random?: RandomBytes): Promise<DeltaWriter> {
  const writer = new DeltaWriter(source.size, reader.security, random ?? reader.random);
  if (source.size > 0) {
    const [last = LF] = await source.read(source.size - 1, source.size);
    if (last !== LF && last !== CR) writer.write(Uint8Array.of(LF));
  }
  return writer;
}

export interface FinishDeltaOptions {
  readonly reader: ObjectReader;
  readonly root: PdfRef;
  /** `/Size` del nuevo trailer (siguiente número libre, incluido el de la xref de flujo si la hay). */
  readonly size: number;
  /** Número reservado para la xref de flujo, o `null` si la última sección del original es una tabla. */
  readonly xrefNum: number | null;
  /** ISO 8601: semilla de `/ID` junto con `sourceSize` y el número de objetos nuevos. */
  readonly now: string;
  readonly sourceSize: number;
}

/** Reserva el número de la xref de flujo si la última sección del original lo es. */
export function reserveXref(reader: ObjectReader, next: number): { readonly xrefNum: number | null; readonly size: number } {
  return reader.xref.lastKind === 'stream' ? { xrefNum: next, size: next + 1 } : { xrefNum: null, size: next };
}

/** Escribe la sección xref (tabla o flujo, como la última del original), el trailer y `%%EOF`; devuelve el delta completo. */
export function finishDelta(writer: DeltaWriter, o: FinishDeltaOptions): Uint8Array {
  const { reader, root, size, xrefNum } = o;
  const entries = new Map<number, XrefRow>(writer.offsets);
  const id = documentId(reader.xref.trailer, idSeed(o.now, o.sourceSize, size - reader.xref.size));
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
    writer.write(serializeIndirect(xrefNum, 0, stream(streamDict, streamRows(groups))));
    writer.write(text(`startxref\n${xrefOffset}\n%%EOF\n`));
  }
  return writer.toBytes();
}

/** Trailer del incremento. Sin `/ID` original, ambos identificadores son nuevos. */
function trailerDict(reader: ObjectReader, root: PdfRef, id: readonly [PdfString, PdfString], size: number): Record<string, PdfValue> {
  const entries: Record<string, PdfValue> = { Size: size, Root: root };
  const info = dictGet(reader.xref.trailer, 'Info');
  if (info !== undefined) entries.Info = info;
  if (reader.encryptRef !== null) entries.Encrypt = reader.encryptRef;
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

function text(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
}

function isArrayValue(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function isStringValue(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}
