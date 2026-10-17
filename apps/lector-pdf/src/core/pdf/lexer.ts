/**
 * Léxico PDF (ISO 32000-1 §7.2). Trabaja sobre bytes; nunca convierte el fichero a texto.
 */
import { PdfSyntaxError } from './objects';

export type Token = TokenPosition &
  (
    | { readonly kind: 'number'; readonly value: number; readonly integer: boolean }
    | { readonly kind: 'name'; readonly value: string }
    | { readonly kind: 'string'; readonly bytes: Uint8Array; readonly hex: boolean }
    | { readonly kind: 'keyword'; readonly value: string }
    | { readonly kind: '[' | ']' | '<<' | '>>' | 'eof' }
  );

interface TokenPosition {
  /** Offset del primer byte del token. */
  readonly start: number;
  /** Offset justo después del último byte del token. */
  readonly end: number;
}

export const CHAR = {
  TAB: 0x09,
  LF: 0x0a,
  FF: 0x0c,
  CR: 0x0d,
  SPACE: 0x20,
  HASH: 0x23,
  PERCENT: 0x25,
  LPAREN: 0x28,
  RPAREN: 0x29,
  SLASH: 0x2f,
  ZERO: 0x30,
  SEVEN: 0x37,
  LT: 0x3c,
  GT: 0x3e,
  LBRACKET: 0x5b,
  BACKSLASH: 0x5c,
  RBRACKET: 0x5d,
  LBRACE: 0x7b,
  RBRACE: 0x7d,
  NUL: 0x00,
} as const;

/** Blancos (ISO 32000-1 §7.2.2). */
export function isWhitespace(c: number): boolean {
  return c === CHAR.NUL || c === CHAR.TAB || c === CHAR.LF || c === CHAR.FF || c === CHAR.CR || c === CHAR.SPACE;
}

/** Delimitadores (ISO 32000-1 §7.2.2). */
export function isDelimiter(c: number): boolean {
  switch (c) {
    case CHAR.LPAREN:
    case CHAR.RPAREN:
    case CHAR.LT:
    case CHAR.GT:
    case CHAR.LBRACKET:
    case CHAR.RBRACKET:
    case CHAR.LBRACE:
    case CHAR.RBRACE:
    case CHAR.SLASH:
    case CHAR.PERCENT:
      return true;
    default:
      return false;
  }
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

function asciiText(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/** Convierte bytes UTF-8 de un nombre a texto (rápido si son ASCII). */
export function decodeNameBytes(raw: readonly number[]): string {
  if (raw.every((b) => b < 0x80)) return String.fromCharCode(...raw);
  return new TextDecoder('utf-8').decode(Uint8Array.from(raw));
}

export class PdfLexer {
  private readonly bytes: Uint8Array;
  private pos: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.pos = offset;
  }

  /** Posición actual (justo después del último token leído). */
  get offset(): number {
    return this.pos;
  }

  /** Lee el siguiente token. Tras el final de los datos devuelve `eof` (repetidamente). */
  next(): Token {
    this.skipBlanksAndComments();
    const { bytes } = this;
    const start = this.pos;
    if (start >= bytes.length) return { kind: 'eof', start, end: start };
    const c = bytes[start] ?? 0;
    switch (c) {
      case CHAR.SLASH:
        return this.readName();
      case CHAR.LPAREN:
        return this.readLiteralString();
      case CHAR.LT:
        if (bytes[start + 1] === CHAR.LT) return this.punct('<<', 2);
        return this.readHexString();
      case CHAR.GT:
        if (bytes[start + 1] === CHAR.GT) return this.punct('>>', 2);
        throw new PdfSyntaxError('">" suelto: se esperaba ">>"', start);
      case CHAR.LBRACKET:
        return this.punct('[', 1);
      case CHAR.RBRACKET:
        return this.punct(']', 1);
      case CHAR.RPAREN:
      case CHAR.LBRACE:
      case CHAR.RBRACE:
        throw new PdfSyntaxError(`delimitador inesperado "${String.fromCharCode(c)}"`, start);
      default:
        return this.readRegular();
    }
  }

  private punct(kind: '<<' | '>>' | '[' | ']', length: number): Token {
    const start = this.pos;
    this.pos += length;
    return { kind, start, end: this.pos };
  }

  private skipBlanksAndComments(): void {
    const { bytes } = this;
    while (this.pos < bytes.length) {
      const c = bytes[this.pos] ?? 0;
      if (isWhitespace(c)) {
        this.pos++;
      } else if (c === CHAR.PERCENT) {
        while (this.pos < bytes.length && bytes[this.pos] !== CHAR.LF && bytes[this.pos] !== CHAR.CR) this.pos++;
      } else {
        return;
      }
    }
  }

  /** Números, palabras clave `true`/`false`/`null`/`obj`/`R`... (cualquier carácter regular). */
  private readRegular(): Token {
    const { bytes } = this;
    const start = this.pos;
    let end = start;
    while (end < bytes.length) {
      const c = bytes[end] ?? 0;
      if (isWhitespace(c) || isDelimiter(c)) break;
      end++;
    }
    this.pos = end;
    const number = parseNumber(bytes, start, end);
    if (number !== null) return { kind: 'number', value: number.value, integer: number.integer, start, end };
    return { kind: 'keyword', value: asciiText(bytes, start, end), start, end };
  }

  private readName(): Token {
    const { bytes } = this;
    const start = this.pos;
    let i = start + 1;
    const raw: number[] = [];
    while (i < bytes.length) {
      const c = bytes[i] ?? 0;
      if (isWhitespace(c) || isDelimiter(c)) break;
      if (c === CHAR.HASH) {
        const hi = hexValue(bytes[i + 1] ?? -1);
        const lo = hexValue(bytes[i + 2] ?? -1);
        if (hi >= 0 && lo >= 0) {
          raw.push(hi * 16 + lo);
          i += 3;
          continue;
        }
      }
      raw.push(c);
      i++;
    }
    this.pos = i;
    return { kind: 'name', value: decodeNameBytes(raw), start, end: i };
  }

  private readHexString(): Token {
    const { bytes } = this;
    const start = this.pos;
    let i = start + 1;
    const out: number[] = [];
    let high = -1;
    for (;;) {
      if (i >= bytes.length) throw new PdfSyntaxError('cadena hexadecimal sin cerrar', start);
      const c = bytes[i] ?? 0;
      i++;
      if (c === CHAR.GT) break;
      if (isWhitespace(c)) continue;
      const v = hexValue(c);
      if (v < 0) throw new PdfSyntaxError('dígito hexadecimal no válido en <...>', i - 1);
      if (high < 0) {
        high = v;
      } else {
        out.push(high * 16 + v);
        high = -1;
      }
    }
    if (high >= 0) out.push(high * 16); // número impar de dígitos: el último va seguido de 0
    this.pos = i;
    return { kind: 'string', bytes: Uint8Array.from(out), hex: true, start, end: i };
  }

  private readLiteralString(): Token {
    const { bytes } = this;
    const start = this.pos;
    let i = start + 1;
    let depth = 1;
    const out: number[] = [];
    for (;;) {
      if (i >= bytes.length) throw new PdfSyntaxError('cadena literal sin cerrar', start);
      const c = bytes[i] ?? 0;
      i++;
      if (c === CHAR.LPAREN) {
        depth++;
        out.push(c);
      } else if (c === CHAR.RPAREN) {
        depth--;
        if (depth === 0) break;
        out.push(c);
      } else if (c === CHAR.CR) {
        // Fin de línea sin escapar: se lee como LF (un CRLF cuenta una vez).
        if (bytes[i] === CHAR.LF) i++;
        out.push(CHAR.LF);
      } else if (c === CHAR.LF) {
        out.push(CHAR.LF);
      } else if (c === CHAR.BACKSLASH) {
        i = this.readEscape(i, out);
      } else {
        out.push(c);
      }
    }
    this.pos = i;
    return { kind: 'string', bytes: Uint8Array.from(out), hex: false, start, end: i };
  }

  /** Lee un escape de cadena literal cuyo `\` ya se ha consumido; devuelve el nuevo índice. */
  private readEscape(i: number, out: number[]): number {
    const { bytes } = this;
    if (i >= bytes.length) throw new PdfSyntaxError('cadena literal sin cerrar', i);
    const c = bytes[i] ?? 0;
    switch (c) {
      case 0x6e: // n
        out.push(CHAR.LF);
        return i + 1;
      case 0x72: // r
        out.push(CHAR.CR);
        return i + 1;
      case 0x74: // t
        out.push(CHAR.TAB);
        return i + 1;
      case 0x62: // b
        out.push(0x08);
        return i + 1;
      case 0x66: // f
        out.push(CHAR.FF);
        return i + 1;
      case CHAR.LPAREN:
      case CHAR.RPAREN:
      case CHAR.BACKSLASH:
        out.push(c);
        return i + 1;
      case CHAR.CR:
        // Continuación de línea: `\` + CR, CR LF o LF no añade nada.
        return bytes[i + 1] === CHAR.LF ? i + 2 : i + 1;
      case CHAR.LF:
        return i + 1;
      default:
        break;
    }
    if (c >= CHAR.ZERO && c <= CHAR.SEVEN) {
      let value = 0;
      let j = i;
      while (j < bytes.length && j < i + 3) {
        const d = bytes[j] ?? 0;
        if (d < CHAR.ZERO || d > CHAR.SEVEN) break;
        value = value * 8 + (d - CHAR.ZERO);
        j++;
      }
      out.push(value & 0xff);
      return j;
    }
    // Escape desconocido: el barra se ignora y se conserva el carácter.
    out.push(c);
    return i + 1;
  }
}

/** Número PDF (`[+-]?digitos[.digitos]`, también `.5` o `5.`). Devuelve `null` si el texto no lo es. */
function parseNumber(bytes: Uint8Array, start: number, end: number): { value: number; integer: boolean } | null {
  let i = start;
  if (i < end && (bytes[i] === 0x2b || bytes[i] === 0x2d)) i++;
  let digits = 0;
  let integer = true;
  while (i < end && (bytes[i] ?? 0) >= CHAR.ZERO && (bytes[i] ?? 0) <= 0x39) {
    i++;
    digits++;
  }
  if (i < end && bytes[i] === 0x2e) {
    integer = false;
    i++;
    while (i < end && (bytes[i] ?? 0) >= CHAR.ZERO && (bytes[i] ?? 0) <= 0x39) {
      i++;
      digits++;
    }
  }
  if (i !== end || digits === 0) return null;
  return { value: Number(asciiText(bytes, start, end)), integer };
}
