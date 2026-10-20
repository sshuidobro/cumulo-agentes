/**
 * Escritor de ficheros PDF completos (PDF-121, ADR-0028): cabecera, objetos, xref clásica desde 0 y trailer, sin
 * incremento previo. Lo usan la creación de documentos nuevos (`new-document.ts`), la reescritura (PDF-131) y la
 * creación desde imágenes (PDF-056). No sabe nada de páginas: recibe objetos ya construidos.
 */
import type { RandomBytes } from './crypt-rules';
import type { SecurityHandler } from './crypto';
import { DeltaWriter, groupsOf, newIdBytes, tableRow } from './delta-writer';
import { bytesString, dict, ref, type PdfDict, type PdfRef, type PdfValue } from './objects';
import { serializeIndirect, serializeValue } from './serialize';

export interface FileEncryption {
  readonly handler: SecurityHandler;
  /** Diccionario `/Encrypt` del original; se escribe sin cifrar como objeto N+1. */
  readonly encrypt: PdfDict;
  /** Generador de IV de AES. */
  readonly random: RandomBytes;
}

export interface CompleteFile {
  /** Objetos con números 1..N sin huecos, en orden de número. */
  readonly objects: readonly (readonly [number, PdfValue])[];
  readonly root: PdfRef;
  readonly info?: PdfRef;
  /** 16 bytes; si falta, `newIdBytes(seed)`. */
  readonly id0?: Uint8Array;
  readonly seed: string;
  readonly encryption?: FileEncryption;
}

/** `%PDF-1.7` seguido de la línea binaria recomendada por ISO 32000-1 §7.5.2 (cuatro bytes > 127). */
const HEADER = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);
/** Entrada 0 de la xref: objeto libre con generación 65535 (ISO 32000-1 §7.5.4). Exactamente 20 bytes. */
const FREE_ROW = '0000000000 65535 f \n';
const TEXT_ENCODER = new TextEncoder();

/** Sin cifrado no se generan IV: si algo lo pide, es un bug de quien llama. */
const NO_RANDOM: RandomBytes = () => {
  throw new RangeError('writeCompleteFile: no hay cifrado y se han pedido bytes aleatorios');
};

/** `%PDF-1.7` + binario, objetos (cifrados si hay `encryption`; el writer añade el `/Encrypt` como objeto N+1 sin cifrar), xref clásica desde 0, trailer y `%%EOF`. */
export function writeCompleteFile(f: CompleteFile): Uint8Array {
  const writer = new DeltaWriter(0, f.encryption?.handler ?? null, f.encryption?.random ?? NO_RANDOM);
  writer.write(HEADER);
  for (const [num, value] of f.objects) writer.object(num, 0, value);

  let size = f.objects.length + 1;
  let encryptRef: PdfRef | null = null;
  if (f.encryption !== undefined) {
    const num = size;
    writer.offsets.set(num, { offset: writer.offset, gen: 0 });
    writer.write(serializeIndirect(num, 0, f.encryption.encrypt));
    encryptRef = ref(num);
    size = num + 1;
  }

  const seed = f.seed;
  const id0 = f.id0 ?? newIdBytes(seed);
  const id1 = newIdBytes(`${seed}|1`);
  const trailer: Record<string, PdfValue> = { Size: size, Root: f.root };
  if (f.info !== undefined) trailer.Info = f.info;
  if (encryptRef !== null) trailer.Encrypt = encryptRef;
  trailer.ID = [bytesString(id0, true), bytesString(id1, true)];

  const xrefOffset = writer.offset;
  writer.write(text('xref\n0 1\n'));
  writer.write(text(FREE_ROW));
  for (const group of groupsOf(writer.offsets)) {
    writer.write(text(`${group.start} ${group.rows.length}\n`));
    for (const [, row] of group.rows) writer.write(text(tableRow(row)));
  }
  writer.write(text('trailer\n'));
  writer.write(serializeValue(dict(trailer)));
  writer.write(text(`\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return writer.toBytes();
}

function text(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
}
