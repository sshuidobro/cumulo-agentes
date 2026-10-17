/**
 * Analizador de objetos PDF (ISO 32000-1 §7.3) sobre `Uint8Array`.
 * Errores de sintaxis → `PdfSyntaxError` con el offset. Nunca bucla sin consumir bytes.
 */
import { CHAR, isWhitespace, PdfLexer, type Token } from './lexer';
import { dictGet, name, PdfSyntaxError, ref, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from './objects';

/** Anidamiento máximo de arrays y diccionarios. */
const MAX_DEPTH = 100;

const ENDSTREAM = encodeAscii('endstream');

/** Resuelve `/Length` indirecto (`N G R`). Devuelve `null` si no se puede. */
export type LengthResolver = (r: PdfRef) => number | null;

export interface ParsedValue {
  readonly value: PdfValue;
  /** Offset justo después del último byte del valor. */
  readonly end: number;
}

export interface ParsedIndirectObject {
  readonly num: number;
  readonly gen: number;
  readonly value: PdfValue;
  /** Offset justo después de `endobj`. */
  readonly end: number;
}

function encodeAscii(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function syntax(message: string, offset: number): PdfSyntaxError {
  return new PdfSyntaxError(message, offset);
}

function checkDepth(depth: number, offset: number): void {
  if (depth > MAX_DEPTH) throw syntax(`anidamiento demasiado profundo (más de ${MAX_DEPTH} niveles)`, offset);
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function lengthOf(v: PdfValue | undefined, resolve: LengthResolver | undefined): number | null {
  if (typeof v === 'number') return v;
  if (isRef(v) && resolve !== undefined) return resolve(v);
  return null;
}

function skipWhitespace(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i < bytes.length && isWhitespace(bytes[i] ?? 0)) i++;
  return i;
}

function matchesAt(bytes: Uint8Array, at: number, pattern: Uint8Array): boolean {
  if (at + pattern.length > bytes.length) return false;
  return pattern.every((b, k) => bytes[at + k] === b);
}

function indexOfBytes(bytes: Uint8Array, pattern: Uint8Array, from: number): number {
  for (let i = from; i + pattern.length <= bytes.length; i++) {
    if (matchesAt(bytes, i, pattern)) return i;
  }
  return -1;
}

/** Quita el fin de línea que precede a `endstream` (CRLF, LF o CR). */
function stripEol(bytes: Uint8Array, start: number, end: number): number {
  if (end - 2 >= start && bytes[end - 2] === CHAR.CR && bytes[end - 1] === CHAR.LF) return end - 2;
  if (end - 1 >= start && (bytes[end - 1] === CHAR.LF || bytes[end - 1] === CHAR.CR)) return end - 1;
  return end;
}

class Parser {
  private readonly bytes: Uint8Array;
  private lex: PdfLexer;
  private buffer: Token[] = [];
  /** Offset justo después del último token consumido. */
  private last: number;

  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes;
    this.lex = new PdfLexer(bytes, offset);
    this.last = offset;
  }

  private peek(i = 0): Token {
    while (this.buffer.length <= i) this.buffer.push(this.lex.next());
    const t = this.buffer[i];
    if (t === undefined) throw new Error('bug: lookahead fuera de rango');
    return t;
  }

  private take(): Token {
    const t = this.peek(0);
    this.buffer.shift();
    this.last = t.end;
    return t;
  }

  expectKeyword(word: string): Token {
    const t = this.peek();
    if (t.kind === 'keyword' && t.value === word) return this.take();
    throw syntax(`se esperaba "${word}"`, t.start);
  }

  expectInteger(): number {
    const t = this.peek();
    if (t.kind === 'number' && t.integer && t.value >= 0) {
      this.take();
      return t.value;
    }
    throw syntax('se esperaba un entero no negativo', t.start);
  }

  /** Valor completo; si es un diccionario seguido de `stream`, devuelve el flujo. */
  parseTop(resolveLength?: LengthResolver): ParsedValue {
    if (this.peek().kind === '<<') {
      const d = this.parseDict(1);
      const next = this.peek();
      if (next.kind === 'keyword' && next.value === 'stream') {
        const s = this.parseStream(d, resolveLength);
        return { value: s, end: this.last };
      }
      return { value: d, end: this.last };
    }
    const value = this.parseObject(0);
    return { value, end: this.last };
  }

  /** `depth` es el nivel del contenedor que llama (0 en la raíz). */
  private parseObject(depth: number): PdfValue {
    const t = this.peek();
    switch (t.kind) {
      case 'number': {
        const second = this.peek(1);
        const third = this.peek(2);
        if (
          t.integer && t.value >= 0 &&
          second.kind === 'number' && second.integer && second.value >= 0 &&
          third.kind === 'keyword' && third.value === 'R'
        ) {
          this.take();
          this.take();
          this.take();
          return ref(t.value, second.value);
        }
        this.take();
        return t.value;
      }
      case 'name':
        this.take();
        return name(t.value);
      case 'string':
        this.take();
        return { kind: 'string', bytes: t.bytes, hex: t.hex };
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') {
          this.take();
          return t.value === 'true';
        }
        if (t.value === 'null') {
          this.take();
          return null;
        }
        throw syntax(`palabra clave inesperada "${t.value}"`, t.start);
      case '[':
        return this.parseArray(depth + 1);
      case '<<':
        return this.parseDict(depth + 1);
      case 'eof':
        throw syntax('fin de datos inesperado', t.start);
      default:
        throw syntax(`token inesperado "${t.kind}"`, t.start);
    }
  }

  private parseArray(depth: number): readonly PdfValue[] {
    checkDepth(depth, this.peek().start);
    this.take();
    const items: PdfValue[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === ']') {
        this.take();
        return items;
      }
      if (t.kind === 'eof') throw syntax('array sin cerrar: falta "]"', t.start);
      items.push(this.parseObject(depth));
    }
  }

  private parseDict(depth: number): PdfDict {
    checkDepth(depth, this.peek().start);
    this.take();
    const entries = new Map<string, PdfValue>();
    for (;;) {
      const t = this.peek();
      if (t.kind === '>>') {
        this.take();
        return { kind: 'dict', entries };
      }
      if (t.kind === 'eof') throw syntax('diccionario sin cerrar: falta ">>"', t.start);
      if (t.kind !== 'name') throw syntax('se esperaba un nombre como clave de diccionario', t.start);
      this.take();
      entries.set(t.value, this.parseObject(depth));
    }
  }

  /** Lee los datos de un flujo; `stream` es el siguiente token. */
  private parseStream(d: PdfDict, resolveLength: LengthResolver | undefined): PdfStream {
    const { bytes } = this;
    const keyword = this.take();
    let start = keyword.end;
    const c = bytes[start];
    if (c === CHAR.CR && bytes[start + 1] === CHAR.LF) start += 2;
    else if (c === CHAR.LF || c === CHAR.CR) start += 1;
    else throw syntax('se esperaba fin de línea tras "stream"', start);

    const declared = lengthOf(dictGet(d, 'Length'), resolveLength);
    let dataEnd = -1;
    let after = -1;
    if (declared !== null && Number.isInteger(declared) && declared >= 0 && start + declared <= bytes.length) {
      const q = skipWhitespace(bytes, start + declared);
      if (matchesAt(bytes, q, ENDSTREAM)) {
        dataEnd = start + declared;
        after = q + ENDSTREAM.length;
      }
    }
    if (after < 0) {
      // /Length ausente o erróneo: se busca "endstream" y se recorta el fin de línea previo.
      const idx = indexOfBytes(bytes, ENDSTREAM, start);
      if (idx < 0) throw syntax('no se encuentra "endstream"', start);
      dataEnd = stripEol(bytes, start, idx);
      after = idx + ENDSTREAM.length;
    }

    const data = bytes.slice(start, dataEnd);
    this.buffer = [];
    this.lex = new PdfLexer(bytes, after);
    this.last = after;
    return { kind: 'stream', dict: d, data };
  }
}

/** Analiza un valor PDF que empieza en `offset` (se saltan blancos y comentarios previos). */
export function parseValue(bytes: Uint8Array, offset: number): ParsedValue {
  return new Parser(bytes, offset).parseTop();
}

/**
 * Analiza `num gen obj <valor> [stream...] endobj` en `offset`.
 * `resolveLength` resuelve `/Length N G R`; si devuelve `null` se busca `endstream`.
 */
export function parseIndirectObject(
  bytes: Uint8Array,
  offset: number,
  resolveLength?: LengthResolver,
): ParsedIndirectObject {
  const p = new Parser(bytes, offset);
  const num = p.expectInteger();
  const gen = p.expectInteger();
  p.expectKeyword('obj');
  const { value } = p.parseTop(resolveLength);
  const endobj = p.expectKeyword('endobj');
  return { num, gen, value, end: endobj.end };
}
