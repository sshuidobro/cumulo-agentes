/**
 * Analizador y serializador del contenido de página (ISO 32000-1 §7.8.2 y §8.9.7). Cada operación es un operador
 * con sus operandos; las imágenes en línea (`BI … ID … EI`) son una sola operación con su diccionario y sus datos.
 * Sin E/S: trabaja sobre bytes.
 */
import { PdfLexer } from '../pdf/lexer';
import { parseValue } from '../pdf/parser';
import { dict, name, PdfSyntaxError, type PdfDict, type PdfValue } from '../pdf/objects';
import { serializeValue } from '../pdf/serialize';

export interface ContentOp {
  readonly op: string; // 'Tj', 'cm', 'BI'…
  readonly operands: readonly PdfValue[];
  /** Solo en 'BI': diccionario (claves abreviadas tal cual) y datos crudos entre ID y EI. */
  readonly inline?: { readonly dict: PdfDict; readonly data: Uint8Array };
}

/** Palabras clave que son valores, no operadores. */
const VALUE_KEYWORDS: ReadonlySet<string> = new Set(['true', 'false', 'null']);
const SPACE = 0x20;
const LETTER_E = 0x45;
const LETTER_I = 0x49;

function isBlank(c: number | undefined): boolean {
  return c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === SPACE;
}

function syntax(message: string, offset: number): PdfSyntaxError {
  return new PdfSyntaxError(message, offset);
}

/** Lanza `PdfSyntaxError` si la sintaxis no se entiende. Operadores desconocidos se conservan tal cual. */
export function parseContent(bytes: Uint8Array): readonly ContentOp[] {
  const ops: ContentOp[] = [];
  let operands: PdfValue[] = [];
  let pos = 0;
  for (;;) {
    const token = new PdfLexer(bytes, pos).next();
    if (token.kind === 'eof') break;
    if (token.kind === 'keyword' && !VALUE_KEYWORDS.has(token.value)) {
      if (token.value === 'BI') {
        const image = readInlineImage(bytes, token.end);
        ops.push({ op: 'BI', operands: [], inline: image.inline });
        pos = image.end;
      } else {
        ops.push({ op: token.value, operands });
        pos = token.end;
      }
      operands = [];
      continue;
    }
    const value = parseValue(bytes, pos);
    operands.push(value.value);
    pos = value.end;
  }
  if (operands.length > 0) throw syntax('operandos sin operador al final del contenido', pos);
  return ops;
}

/** Inverso: operandos con `serializeValue`, un operador por línea; 'BI' se escribe `BI <claves> ID <datos> EI`. */
export function serializeContent(ops: readonly ContentOp[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const op of ops) {
    if (op.op === 'BI') {
      if (op.inline === undefined) throw new RangeError('BI sin imagen en línea');
      parts.push(ascii('BI'));
      for (const [key, value] of op.inline.dict.entries) {
        parts.push(space(), serializeValue(name(key)), space(), serializeValue(value));
      }
      parts.push(ascii(' ID '), op.inline.data, ascii(' EI\n'));
      continue;
    }
    for (const value of op.operands) {
      parts.push(serializeValue(value), space());
    }
    parts.push(ascii(`${op.op}\n`));
  }
  return concatBytes(parts);
}

/**
 * Lee una imagen en línea desde `from` (justo después de `BI`). Tras `ID` se salta un blanco. Si el diccionario
 * trae `/L` o `/Length` y en esa distancia hay `EI` delimitado, se usa esa longitud; si no, el final es el primer
 * `EI` precedido de un blanco y seguido de un blanco o del final.
 */
function readInlineImage(
  bytes: Uint8Array,
  from: number,
): { readonly inline: { readonly dict: PdfDict; readonly data: Uint8Array }; readonly end: number } {
  const entries = new Map<string, PdfValue>();
  let pos = from;
  for (;;) {
    const token = new PdfLexer(bytes, pos).next();
    if (token.kind === 'eof') throw syntax('imagen en línea sin ID', pos);
    if (token.kind === 'keyword' && token.value === 'ID') {
      pos = token.end;
      break;
    }
    if (token.kind !== 'name') throw syntax('se esperaba una clave de imagen en línea', token.start);
    const value = parseValue(bytes, token.end);
    entries.set(token.value, value.value);
    pos = value.end;
  }
  if (!isBlank(bytes[pos])) throw syntax('se esperaba un blanco después de ID', pos);
  const start = pos + 1;
  const declared = lengthOf(entries);
  const byLength = declared === null ? null : endByLength(bytes, start, declared);
  const end = byLength ?? endByScan(bytes, start);
  if (end === null) throw syntax('imagen en línea sin EI', start);
  return { inline: { dict: dict(entries), data: bytes.slice(start, end.dataEnd) }, end: end.after };
}

function lengthOf(entries: ReadonlyMap<string, PdfValue>): number | null {
  const value = entries.get('L') ?? entries.get('Length');
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Fin de datos por longitud declarada, si va seguida de blancos y `EI` delimitado. */
function endByLength(
  bytes: Uint8Array,
  start: number,
  length: number,
): { readonly dataEnd: number; readonly after: number } | null {
  const dataEnd = start + length;
  if (dataEnd > bytes.length) return null;
  let j = dataEnd;
  while (isBlank(bytes[j])) j += 1;
  return isEiAt(bytes, j) ? { dataEnd, after: j + 2 } : null;
}

/** Fin de datos por búsqueda del primer `EI` delimitado por blancos. */
function endByScan(bytes: Uint8Array, start: number): { readonly dataEnd: number; readonly after: number } | null {
  for (let i = start + 1; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === LETTER_E && bytes[i + 1] === LETTER_I && i - 1 >= start && isBlank(bytes[i - 1])) {
      if (i + 2 === bytes.length || isBlank(bytes[i + 2])) return { dataEnd: i - 1, after: i + 2 };
    }
  }
  return null;
}

function isEiAt(bytes: Uint8Array, at: number): boolean {
  if (bytes[at] !== LETTER_E || bytes[at + 1] !== LETTER_I) return false;
  return at + 2 === bytes.length || isBlank(bytes[at + 2]);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function space(): Uint8Array {
  return Uint8Array.of(SPACE);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
