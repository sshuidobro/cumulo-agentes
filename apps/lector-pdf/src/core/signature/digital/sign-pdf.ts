/**
 * Firma PAdES B-B por actualización incremental (PDF-066, ADR-0040, ADR-0009). Escribe un diccionario de firma
 * con un hueco `/Contents` de 16 KiB, un campo y widget `/Sig` (visible o invisible) y, si hace falta, el
 * `/AcroForm` y la anotación de la página. Luego calcula el resumen de los rangos firmados y rellena el hueco
 * con el CMS. Lee el original por bloques: nunca lo carga entero.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { sha256 } from '@noble/hashes/sha2.js';
import { pdfError } from '../../errors';
import { HELV_FONT, nums, num, pdfText } from '../../annotations/appearance';
import type { RectPt } from '../../annotations/model';
import { wrapText } from '../../annotations/wrap';
import { finishDelta, reserveXref, startDelta } from '../../pdf/delta-writer';
import { toSaveError } from '../../pdf/save-error';
import { decodeTextString, encodeTextString, pdfDate } from '../../pdf/text-string';
import { serializeValue } from '../../pdf/serialize';
import type { ObjectReader } from '../../pdf/object-reader';
import {
  dict,
  dictGet,
  name,
  PdfSyntaxError,
  ref,
  stream,
  withEntries,
  type PdfDict,
  type PdfRef,
  type PdfStream,
  type PdfString,
  type PdfValue,
} from '../../pdf/objects';
import { buildCadesSignature } from './cms';
import type { SigningIdentity } from './p12';

/** Bytes reservados para el CMS en `/Contents` (el hueco tiene el doble en hexadecimal). */
export const SIGNATURE_CONTENTS_BYTES = 16384;
/** Caracteres hexadecimales del hueco. */
const HEX_DIGITS = SIGNATURE_CONTENTS_BYTES * 2;
/** Tamaño de cada lectura del original al calcular el resumen. */
const READ_BLOCK_BYTES = 1024 * 1024;
/** Flags del widget: Print (4) + Locked (128). */
const WIDGET_FLAGS = 132;
/** `/SigFlags`: SignaturesExist (1) + AppendOnly (2). */
const SIG_FLAGS = 3;
/** Placeholder de un número de `/ByteRange`: 10 caracteres, rellenados con espacios al escribirlos. */
const BYTE_RANGE_SLOT = 10;
const APPEARANCE_FONT_SIZE = 8;
const APPEARANCE_MARGIN = 2;
const APPEARANCE_LEADING = 1.15;
const APPEARANCE_FIELD_NAME_PREFIX = 'Firma';

const TEXT_ENCODER = new TextEncoder();

export interface SignInput {
  readonly source: ByteSource;
  readonly reader: ObjectReader;
  readonly identity: SigningIdentity;
  readonly pageIndex: number;
  /** `null` = firma invisible (`/Rect [0 0 0 0]`, sin apariencia). */
  readonly rect: RectPt | null;
  /** `''` = no se escribe. */
  readonly reason: string;
  /** `''` = no se escribe. */
  readonly location: string;
  /** ISO 8601; lo pasa quien llama (así el resultado es determinista). */
  readonly now: string;
}

/** Firma un PDF sin cifrar. Devuelve el incremento a anexar y su tamaño final. Nunca lanza. */
export async function buildSignatureUpdate(
  input: SignInput,
): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>> {
  try {
    return await writeSignature(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

/** Trozos de bytes que forman el diccionario de firma, con la posición de sus dos huecos. */
interface SigDictLayout {
  readonly bytes: Uint8Array;
  /** Offset del `[` de `/ByteRange` dentro de `bytes`. */
  readonly byteRangeAt: number;
  /** Offset del `<` de `/Contents` dentro de `bytes`. */
  readonly contentsAt: number;
}

async function writeSignature(input: SignInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>> {
  const { source, reader, identity, pageIndex, rect, now } = input;
  if (reader.security !== null) return err(pdfError('sign-encrypted'));

  const root = dictGet(reader.xref.trailer, 'Root');
  if (!isRefValue(root)) throw unreadable('Root');
  const catalog = await reader.getDict(root);
  if (catalog === null) throw unreadable('catálogo');
  const pageRef = await reader.pageRef(pageIndex);
  const page = await reader.getDict(pageRef);
  if (page === null) throw unreadable(`página ${pageIndex + 1}`);

  // Números: diccionario de firma, campo+widget y apariencia (solo si es visible).
  let next = reader.xref.size;
  const sigRef = ref(next++);
  const fieldRef = ref(next++);
  const apRef = rect === null ? null : ref(next++);
  const { xrefNum, size } = reserveXref(reader, next);

  const acroValue = dictGet(catalog, 'AcroForm');
  const acro = await reader.resolve(acroValue);
  if (acro !== undefined && acro !== null && !isDictValue(acro)) throw unreadable('/AcroForm');
  const fieldsValue = isDictValue(acro) ? dictGet(acro, 'Fields') : undefined;
  const fields = await reader.resolve(fieldsValue);
  if (fields !== undefined && !isArrayValue(fields)) throw unreadable('/Fields');
  const fieldName = `${APPEARANCE_FIELD_NAME_PREFIX} ${firstFreeNumber(await fieldTitles(reader, fields ?? []))}`;

  const writer = await startDelta(source, reader);
  const layout = signatureDictionary(sigRef.num, input, identity.info.subject);
  const sigRel = writer.raw(sigRef.num, 0, layout.bytes);
  if (apRef !== null && rect !== null) writer.object(apRef.num, 0, appearance(rect, identity.info.subject, now));
  writer.object(fieldRef.num, 0, widgetDict({ fieldName, sigRef, pageRef, rect, apRef }));

  // /AcroForm: el campo en /Fields y /SigFlags 3, en el objeto que lo contiene.
  const fieldsWithNew = [...(fields ?? []), fieldRef];
  const catalogChanges: Record<string, PdfValue> = {};
  if (!isDictValue(acro)) {
    catalogChanges.AcroForm = dict({ Fields: [fieldRef], SigFlags: SIG_FLAGS });
  } else {
    const acroChanges: Record<string, PdfValue> = { SigFlags: SIG_FLAGS };
    if (isRefValue(fieldsValue)) writer.object(fieldsValue.num, fieldsValue.gen, fieldsWithNew);
    else acroChanges.Fields = fieldsWithNew;
    const updated = withEntries(acro, acroChanges);
    if (isRefValue(acroValue)) writer.object(acroValue.num, acroValue.gen, updated);
    else catalogChanges.AcroForm = updated;
  }

  // Anotación en /Annots de la página, como hace incremental.ts.
  const pageChanges: Record<string, PdfValue> = {};
  const annots = dictGet(page, 'Annots');
  if (annots === undefined || annots === null) {
    pageChanges.Annots = [fieldRef];
  } else if (Array.isArray(annots)) {
    pageChanges.Annots = [...annots, fieldRef];
  } else if (isRefValue(annots)) {
    const target = await reader.get(annots);
    if (!isArrayValue(target)) throw unreadable(`/Annots de la página ${pageIndex + 1}`);
    writer.object(annots.num, annots.gen, [...target, fieldRef]);
  } else {
    throw unreadable(`/Annots de la página ${pageIndex + 1}`);
  }
  if (Object.keys(pageChanges).length > 0) writer.object(pageRef.num, pageRef.gen, withEntries(page, pageChanges));
  if (Object.keys(catalogChanges).length > 0) writer.object(root.num, root.gen, withEntries(catalog, catalogChanges));

  // Delta completo. `/ByteRange` y el hueco se conocen solo ahora: se rellenan en el propio delta.
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  const sourceSize = source.size;
  const total = sourceSize + delta.length;
  const lt = sourceSize + sigRel + layout.contentsAt;       // posición absoluta del `<`
  const gt = lt + HEX_DIGITS + 2;                           // posición absoluta tras el `>`
  const brAt = sigRel + layout.byteRangeAt;                 // `[` de /ByteRange, relativo al delta
  const contentsAt = sigRel + layout.contentsAt;            // `<` de /Contents, relativo al delta
  writeByteRange(delta, brAt, [0, lt, gt, total - gt]);

  const hash = sha256.create();
  await feed(hash, source, 0, sourceSize);
  hash.update(delta.subarray(0, lt - sourceSize));
  hash.update(delta.subarray(gt - sourceSize));
  const cms = buildCadesSignature(identity, hash.digest());
  if (cms.length > SIGNATURE_CONTENTS_BYTES) return err(pdfError('sign-too-big'));
  writeHex(delta, contentsAt + 1, cms);
  return ok({ delta, expectedSize: total });
}

/** Diccionario de firma como texto fijo más el hueco. `/M` y los textos van con `serializeValue`. */
function signatureDictionary(num: number, input: SignInput, signerName: string): SigDictLayout {
  const parts: Uint8Array[] = [];
  let length = 0;
  const add = (bytes: Uint8Array): void => {
    parts.push(bytes);
    length += bytes.length;
  };
  const text = (s: string): void => add(TEXT_ENCODER.encode(s));

  text(`${num} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /M `);
  add(serializeValue(pdfDate(input.now)));
  text(' /Name ');
  add(serializeValue(encodeTextString(signerName)));
  if (input.reason !== '') {
    text(' /Reason ');
    add(serializeValue(encodeTextString(input.reason)));
  }
  if (input.location !== '') {
    text(' /Location ');
    add(serializeValue(encodeTextString(input.location)));
  }
  text(' /ByteRange ');
  const byteRangeAt = length;
  const slot = '0000000000';
  text(`[0 ${slot} ${slot} ${slot}]`);
  text(' /Contents ');
  const contentsAt = length;
  text(`<${'0'.repeat(HEX_DIGITS)}>`);
  text(' >>\nendobj\n');

  const bytes = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, byteRangeAt, contentsAt };
}

/** Escribe `[0 a b c]` en el hueco de `/ByteRange`: cada número ocupa 10 caracteres (relleno con espacios). */
function writeByteRange(delta: Uint8Array, bracketAt: number, values: readonly number[]): void {
  // `[` + `0 ` = 3 caracteres antes del primer hueco; cada hueco va seguido de un espacio.
  const firstSlot = bracketAt + 3;
  values.slice(1).forEach((value, i) => {
    const at = firstSlot + i * (BYTE_RANGE_SLOT + 1);
    const text = String(value).padEnd(BYTE_RANGE_SLOT, ' ');
    if (text.length !== BYTE_RANGE_SLOT) throw new RangeError('ByteRange desbordado');
    delta.set(TEXT_ENCODER.encode(text), at);
  });
}

/** Escribe `bytes` en hexadecimal a partir de `at` y rellena el resto del hueco con `0`. */
function writeHex(delta: Uint8Array, at: number, bytes: Uint8Array): void {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const padded = hex.padEnd(HEX_DIGITS, '0');
  delta.set(TEXT_ENCODER.encode(padded), at);
}

/** Alimenta `hash` con `source[begin, end)` en bloques. */
async function feed(hash: ReturnType<typeof sha256.create>, source: ByteSource, begin: number, end: number): Promise<void> {
  for (let at = begin; at < end; at += READ_BLOCK_BYTES) {
    hash.update(await source.read(at, Math.min(end, at + READ_BLOCK_BYTES)));
  }
}

interface WidgetParts {
  readonly fieldName: string;
  readonly sigRef: PdfRef;
  readonly pageRef: PdfRef;
  readonly rect: RectPt | null;
  readonly apRef: PdfRef | null;
}

function widgetDict(p: WidgetParts): PdfDict {
  const entries: Record<string, PdfValue> = {
    Type: name('Annot'),
    Subtype: name('Widget'),
    FT: name('Sig'),
    T: encodeTextString(p.fieldName),
    V: p.sigRef,
    F: WIDGET_FLAGS,
    P: p.pageRef,
    Rect: p.rect === null ? [0, 0, 0, 0] : [...p.rect],
  };
  if (p.apRef !== null) entries.AP = dict({ N: p.apRef });
  return dict(entries);
}

/** Primer número N ≥ 1 tal que «Firma N» no es el nombre de ningún campo. */
function firstFreeNumber(titles: ReadonlySet<string>): number {
  let n = 1;
  while (titles.has(`${APPEARANCE_FIELD_NAME_PREFIX} ${n}`)) n++;
  return n;
}

/** Todos los `/T` del árbol de campos (también los hijos): un nombre repetido en cualquier nivel cuenta. */
async function fieldTitles(reader: ObjectReader, fields: readonly PdfValue[]): Promise<ReadonlySet<string>> {
  const titles = new Set<string>();
  const seen = new Set<number>();
  const pending: PdfValue[] = [...fields];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let node: PdfDict | null;
    if (isRefValue(next)) {
      if (seen.has(next.num)) continue;
      seen.add(next.num);
      node = await reader.getDict(next);
    } else {
      node = isDictValue(next) ? next : null;
    }
    if (node === null) continue;
    const t = dictGet(node, 'T');
    if (isStringValue(t)) titles.add(decodeTextString(t));
    const kids = await reader.resolve(dictGet(node, 'Kids'));
    if (isArrayValue(kids)) pending.push(...kids);
  }
  return titles;
}

/**
 * Apariencia de una firma visible: recuadro con «Firmado digitalmente por», el titular y la fecha
 * `dd/mm/aaaa hh:mm` (hora local). Coordenadas relativas a `rect`.
 */
function appearance(rect: RectPt, signerName: string, now: string): PdfStream {
  const [x1, y1, x2, y2] = rect;
  const width = x2 - x1;
  const height = y2 - y1;
  const textWidth = width - 2 * APPEARANCE_MARGIN;
  const lines = [
    'Firmado digitalmente por',
    ...wrapText(signerName, textWidth, APPEARANCE_FONT_SIZE),
    formatLocalDate(now),
  ];
  const leading = APPEARANCE_FONT_SIZE * APPEARANCE_LEADING;
  let ops = `0.5 w ${nums([0.5, 0.5, width - 1, height - 1])} re S\n`;
  lines.forEach((line, i) => {
    const y = height - APPEARANCE_MARGIN - APPEARANCE_FONT_SIZE - i * leading;
    ops += `BT /Helv ${num(APPEARANCE_FONT_SIZE)} Tf ${nums([APPEARANCE_MARGIN, y])} Td ${pdfText(line)} Tj ET\n`;
  });
  return stream(
    {
      Type: name('XObject'),
      Subtype: name('Form'),
      BBox: [0, 0, width, height],
      Resources: dict({ Font: dict({ Helv: HELV_FONT }) }),
    },
    TEXT_ENCODER.encode(ops),
  );
}

/** `dd/mm/aaaa hh:mm` en hora local. Lanza `RangeError` si la fecha no es válida. */
function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`fecha no válida: ${iso}`);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Los fallos de estructura son de quien prepara el documento, no del usuario: se devuelven como `save-unreadable`. */
function unreadable(where: string): PdfSyntaxError {
  return new PdfSyntaxError(`estructura no legible: ${where}`, 0);
}

function isRefValue(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isArrayValue(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function isStringValue(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}
