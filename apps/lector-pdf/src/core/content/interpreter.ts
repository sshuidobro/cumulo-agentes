/**
 * Intérprete del contenido de página (ISO 32000-1 §8.4, §9.3, §9.4, §8.9.7 y §8.10): calcula la caja de cada glifo de
 * texto y de cada imagen en coordenadas de página, sin dibujar nada. Las operaciones de texto que no se pueden medir
 * (fuente no soportada, `Tf` sin fuente) se listan en `unmeasured`. Los Form XObjects no se recorren.
 */
import { decodeStreamData } from '../pdf/filters';
import type { ObjectReader } from '../pdf/object-reader';
import { effectiveResources } from '../pdf/page-content';
import { dictGet, PdfSyntaxError, type PdfDict, type PdfName, type PdfStream, type PdfString, type PdfValue } from '../pdf/objects';
import { parseContent, type ContentOp } from './content-parser';
import { loadFontMetrics, type FontMetrics } from './font-metrics';

export type Quad = readonly [number, number, number, number, number, number, number, number]; // 4 esquinas en espacio de usuario
export interface GlyphBox {
  readonly op: number; // índice en ops
  readonly code: number; // índice del código dentro de la operación (en TJ, contando todos sus strings en orden)
  readonly quad: Quad;
}
export interface ImageBox {
  readonly op: number;
  readonly name: string | null; // null = imagen en línea
  readonly quad: Quad;
}
export interface FormBox {
  readonly op: number;
  readonly name: string;
  readonly quad: Quad; // /BBox transformada
}
export interface PageContent {
  readonly ops: readonly ContentOp[];
  readonly glyphs: readonly GlyphBox[];
  readonly images: readonly ImageBox[];
  readonly forms: readonly FormBox[];
  /** Operaciones de texto que no se han podido medir (fuente no soportada, Tf sin fuente): su índice. */
  readonly unmeasured: readonly number[];
}

/** [a b c d e f] en convención de fila: un punto `(x, y)` se transforma como `[x y 1] × M`. */
type Matrix = readonly [number, number, number, number, number, number];
type Point = readonly [number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const UNIT_SQUARE: readonly Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
/** Profundidad máxima de la pila `q`/`Q`. */
const MAX_SAVED_STATES = 64;
const SPACE_CODE = 32;
const GLYPH_SCALE = 1000;
const PERCENT = 100;

interface TextState {
  charSpacing: number; // Tc
  wordSpacing: number; // Tw
  horizontalScale: number; // Th (Tz / 100)
  leading: number; // TL
  rise: number; // Ts
  fontSize: number; // Tfs
  font: FontMetrics | null; // null = sin fuente medible
}

interface GraphicsState {
  ctm: Matrix;
  text: TextState;
}

/** Estado mutable de una pasada por el contenido. */
interface Machine {
  graphics: GraphicsState;
  stack: GraphicsState[];
  tm: Matrix;
  tlm: Matrix;
}

type Piece = { readonly bytes: Uint8Array } | { readonly adjust: number };

/** Caja, contenido y recursos de una página. Lanza `PdfSyntaxError` si el contenido tiene sintaxis rota. */
export async function interpretPage(reader: ObjectReader, page: PdfDict): Promise<PageContent> {
  const ops = parseContent(await pageContentBytes(reader, page));
  const resources = await effectiveResources(reader, page);
  const fontsDict = asDict(dictGet(resources, 'Font'));
  const xobjects = asDict(dictGet(resources, 'XObject'));
  const fontCache = new Map<string, FontMetrics | null>();
  const glyphs: GlyphBox[] = [];
  const images: ImageBox[] = [];
  const forms: FormBox[] = [];
  const unmeasured: number[] = [];
  const machine: Machine = {
    graphics: { ctm: IDENTITY, text: initialText() },
    stack: [],
    tm: IDENTITY,
    tlm: IDENTITY,
  };

  const loadFont = async (fontName: string, size: number): Promise<void> => {
    if (!fontCache.has(fontName)) {
      const entry = fontsDict === null ? undefined : fontsDict.entries.get(fontName);
      const fontDict = asDict(await reader.resolve(entry));
      fontCache.set(fontName, fontDict === null ? null : await loadFontMetrics(reader, fontDict));
    }
    machine.graphics.text.font = fontCache.get(fontName) ?? null;
    machine.graphics.text.fontSize = size;
  };

  const showOp = (index: number, pieces: readonly Piece[]): void => {
    const { text } = machine.graphics;
    const font = text.font;
    if (font === null) {
      unmeasured.push(index);
      return;
    }
    let code = 0;
    for (const piece of pieces) {
      if ('adjust' in piece) {
        moveText(machine, -(piece.adjust / GLYPH_SCALE) * text.fontSize * text.horizontalScale, 0);
        continue;
      }
      const { bytes } = piece;
      let i = 0;
      while (i < bytes.length) {
        const value = codeAt(bytes, i, font.bytesPerCode);
        const width = font.width(value.code);
        glyphs.push({ op: index, code, quad: glyphQuad(machine, text, font, width) });
        const wordSpace = font.bytesPerCode === 1 && value.code === SPACE_CODE ? text.wordSpacing : 0;
        const tx = (width / GLYPH_SCALE * text.fontSize + text.charSpacing + wordSpace) * text.horizontalScale;
        moveText(machine, tx, 0);
        code += 1;
        i += value.length;
      }
    }
  };

  for (const [index, op] of ops.entries()) {
    switch (op.op) {
      case 'q': {
        if (machine.stack.length >= MAX_SAVED_STATES) throw syntaxError('demasiados niveles de q');
        machine.stack.push({ ctm: machine.graphics.ctm, text: { ...machine.graphics.text } });
        break;
      }
      case 'Q': {
        const saved = machine.stack.pop();
        if (saved !== undefined) machine.graphics = saved;
        break;
      }
      case 'cm': {
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = numbers(op, 6);
        machine.graphics.ctm = multiply([a, b, c, d, e, f], machine.graphics.ctm);
        break;
      }
      case 'BT':
        machine.tm = IDENTITY;
        machine.tlm = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Tc':
        machine.graphics.text.charSpacing = numbers(op, 1)[0] ?? 0;
        break;
      case 'Tw':
        machine.graphics.text.wordSpacing = numbers(op, 1)[0] ?? 0;
        break;
      case 'Tz':
        machine.graphics.text.horizontalScale = (numbers(op, 1)[0] ?? PERCENT) / PERCENT;
        break;
      case 'TL':
        machine.graphics.text.leading = numbers(op, 1)[0] ?? 0;
        break;
      case 'Ts':
        machine.graphics.text.rise = numbers(op, 1)[0] ?? 0;
        break;
      case 'Td': {
        const [tx = 0, ty = 0] = numbers(op, 2);
        moveLine(machine, tx, ty);
        break;
      }
      case 'TD': {
        const [tx = 0, ty = 0] = numbers(op, 2);
        machine.graphics.text.leading = -ty;
        moveLine(machine, tx, ty);
        break;
      }
      case 'Tm': {
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = numbers(op, 6);
        machine.tlm = [a, b, c, d, e, f];
        machine.tm = machine.tlm;
        break;
      }
      case 'T*':
        moveLine(machine, 0, -machine.graphics.text.leading);
        break;
      case 'Tf': {
        const [fontName, size] = fontOperands(op);
        await loadFont(fontName, size);
        break;
      }
      case 'Tj':
        showOp(index, [{ bytes: stringOperand(op, 0) }]);
        break;
      case "'":
        moveLine(machine, 0, -machine.graphics.text.leading);
        showOp(index, [{ bytes: stringOperand(op, 0) }]);
        break;
      case '"': {
        const [aw = 0, ac = 0] = numbers({ op: op.op, operands: op.operands.slice(0, 2) }, 2);
        machine.graphics.text.wordSpacing = aw;
        machine.graphics.text.charSpacing = ac;
        moveLine(machine, 0, -machine.graphics.text.leading);
        showOp(index, [{ bytes: stringOperand(op, 2) }]);
        break;
      }
      case 'TJ':
        showOp(index, arrayPieces(op));
        break;
      case 'Do': {
        const xobjectName = nameOperand(op);
        const xobject = await xobjectStream(reader, xobjects, xobjectName);
        if (xobject === null) break;
        const subtype = nameValue(dictGet(xobject.dict, 'Subtype'));
        if (subtype === 'Image') {
          images.push({ op: index, name: xobjectName, quad: quadOf(machine.graphics.ctm, UNIT_SQUARE) });
        } else if (subtype === 'Form') {
          const box = rectangleOf(dictGet(xobject.dict, 'BBox'));
          if (box !== null) {
            const formMatrix = matrixOf(dictGet(xobject.dict, 'Matrix')) ?? IDENTITY;
            forms.push({ op: index, name: xobjectName, quad: quadOf(multiply(formMatrix, machine.graphics.ctm), box) });
          }
        }
        break;
      }
      case 'BI':
        images.push({ op: index, name: null, quad: quadOf(machine.graphics.ctm, UNIT_SQUARE) });
        break;
      default:
        break;
    }
  }

  return { ops, glyphs, images, forms, unmeasured };
}

/** Caja envolvente de un cuadrilátero: `[xmin, ymin, xmax, ymax]`. */
export function quadBounds(q: Quad): readonly [number, number, number, number] {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Intersección por la caja envolvente de `q` (`rect` en cualquier orden de esquinas): el área común debe ser > 0. */
export function intersects(q: Quad, rect: readonly [number, number, number, number]): boolean {
  const [x0, y0, x1, y1] = quadBounds(q);
  const rx0 = Math.min(rect[0], rect[2]);
  const rx1 = Math.max(rect[0], rect[2]);
  const ry0 = Math.min(rect[1], rect[3]);
  const ry1 = Math.max(rect[1], rect[3]);
  return Math.min(x1, rx1) - Math.max(x0, rx0) > 0 && Math.min(y1, ry1) - Math.max(y0, ry0) > 0;
}

function initialText(): TextState {
  return { charSpacing: 0, wordSpacing: 0, horizontalScale: 1, leading: 0, rise: 0, fontSize: 0, font: null };
}

/** Caja de un glifo: `[0, descent] – [w0, ascent]` en espacio de glifo, transformada por `Trm`. */
function glyphQuad(machine: Machine, text: TextState, font: FontMetrics, width: number): Quad {
  const fs = text.fontSize;
  const hs = text.horizontalScale;
  const trm = multiply(
    [fs * hs, 0, 0, fs, 0, text.rise],
    multiply(machine.tm, machine.graphics.ctm),
  );
  const w = width / GLYPH_SCALE;
  const corners: readonly Point[] = [
    [0, font.descent / GLYPH_SCALE],
    [w, font.descent / GLYPH_SCALE],
    [w, font.ascent / GLYPH_SCALE],
    [0, font.ascent / GLYPH_SCALE],
  ];
  return quadOf(trm, corners);
}

/** Código de `bytes` en `i`: `length` bytes consumidos (un byte suelto al final de un código de 2 bytes). */
function codeAt(bytes: Uint8Array, i: number, perCode: 1 | 2): { readonly code: number; readonly length: number } {
  const first = bytes[i] ?? 0;
  if (perCode === 1 || i + 1 >= bytes.length) return { code: first, length: 1 };
  const second = bytes[i + 1] ?? 0;
  return { code: (first << 8) | second, length: 2 };
}

function moveText(machine: Machine, tx: number, ty: number): void {
  machine.tm = multiply([1, 0, 0, 1, tx, ty], machine.tm);
}

function moveLine(machine: Machine, tx: number, ty: number): void {
  machine.tlm = multiply([1, 0, 0, 1, tx, ty], machine.tlm);
  machine.tm = machine.tlm;
}

/** `m × n` en convención de fila: primero se aplica `m` y después `n`. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function transform(m: Matrix, p: Point): Point {
  return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]];
}

function quadOf(m: Matrix, points: readonly Point[]): Quad {
  const [p0 = [0, 0], p1 = [0, 0], p2 = [0, 0], p3 = [0, 0]] = points;
  const [x0, y0] = transform(m, p0);
  const [x1, y1] = transform(m, p1);
  const [x2, y2] = transform(m, p2);
  const [x3, y3] = transform(m, p3);
  return [x0, y0, x1, y1, x2, y2, x3, y3];
}

/** Contenido de la página: sus `/Contents` decodificados y unidos con «\n». */
export async function pageContentBytes(reader: ObjectReader, page: PdfDict): Promise<Uint8Array> {
  const contents = await reader.resolve(dictGet(page, 'Contents'));
  const items: readonly (PdfValue | undefined)[] = isArray(contents) ? contents : [contents];
  const parts: Uint8Array[] = [];
  for (const item of items) {
    const stream = await reader.resolve(item);
    if (isStream(stream)) parts.push(decodeStreamData(stream));
  }
  return joinWithLineFeed(parts);
}

function joinWithLineFeed(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1);
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((part, index) => {
    if (index > 0) {
      out[at] = 0x0a;
      at += 1;
    }
    out.set(part, at);
    at += part.length;
  });
  return out;
}

async function xobjectStream(reader: ObjectReader, xobjects: PdfDict | null, name: string): Promise<PdfStream | null> {
  const entry = xobjects === null ? undefined : xobjects.entries.get(name);
  const resolved = await reader.resolve(entry);
  return isStream(resolved) ? resolved : null;
}

/** Esquinas de `/BBox` `[x0 y0 x1 y1]` en el orden de `Quad`. */
function rectangleOf(value: PdfValue | undefined): readonly Point[] | null {
  const numeric = numericArray(value, 4);
  if (numeric === null) return null;
  const [a = 0, b = 0, c = 0, d = 0] = numeric;
  return [
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ];
}

function matrixOf(value: PdfValue | undefined): Matrix | null {
  const numeric = numericArray(value, 6);
  if (numeric === null) return null;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = numeric;
  return [a, b, c, d, e, f];
}

/** Array de exactamente `count` números; `null` si no lo es. */
function numericArray(value: PdfValue | undefined, count: number): readonly number[] | null {
  if (!isArray(value) || value.length !== count) return null;
  const numeric = value.filter((v): v is number => typeof v === 'number');
  return numeric.length === count ? numeric : null;
}

/** Operandos numéricos de exactamente `count` valores. */
function numbers(op: ContentOp, count: number): readonly number[] {
  if (op.operands.length !== count) throw syntaxError(`${op.op}: se esperaban ${count} operandos`);
  return op.operands.map((v) => {
    if (typeof v !== 'number') throw syntaxError(`${op.op}: operando numérico no válido`);
    return v;
  });
}

function fontOperands(op: ContentOp): readonly [string, number] {
  const [fontName, size] = op.operands;
  if (op.operands.length !== 2 || !isName(fontName) || typeof size !== 'number') {
    throw syntaxError('Tf: se esperaban un nombre y un tamaño');
  }
  return [fontName.value, size];
}

function nameOperand(op: ContentOp): string {
  const [value] = op.operands;
  if (op.operands.length !== 1 || !isName(value)) throw syntaxError(`${op.op}: se esperaba un nombre`);
  return value.value;
}

function stringOperand(op: ContentOp, index: number): Uint8Array {
  const value = op.operands[index];
  if (op.operands.length !== index + 1 || !isString(value)) throw syntaxError(`${op.op}: se esperaba una cadena`);
  return value.bytes;
}

/** Piezas de un `TJ`: cadenas y ajustes numéricos en orden. */
function arrayPieces(op: ContentOp): readonly Piece[] {
  const [items] = op.operands;
  if (op.operands.length !== 1 || !isArray(items)) throw syntaxError('TJ: se esperaba un array');
  return items.map((item): Piece => {
    if (typeof item === 'number') return { adjust: item };
    if (isString(item)) return { bytes: item.bytes };
    throw syntaxError('TJ: elemento no válido');
  });
}

function asDict(value: PdfValue | undefined): PdfDict | null {
  return isDict(value) ? value : null;
}

function nameValue(value: PdfValue | undefined): string | null {
  return isName(value) ? value.value : null;
}

function syntaxError(message: string): PdfSyntaxError {
  return new PdfSyntaxError(message, 0);
}

function isArray(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isStream(v: PdfValue | undefined): v is PdfStream {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'stream';
}

function isName(v: PdfValue | undefined): v is PdfName {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}

function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}
