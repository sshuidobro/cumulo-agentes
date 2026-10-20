/**
 * Capa de texto invisible del OCR (ADR-0038, PDF-061): dadas las palabras reconocidas de cada página, escribe un
 * incremento que añade a esas páginas un bloque `BT…ET` por palabra con modo de renderizado 3 (`3 Tr`, invisible)
 * alineado con la imagen. Así el texto se busca, se selecciona y se copia sin cambiar el aspecto del lienzo.
 * Nunca lanza: los errores esperables vuelven como `Result`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import { HELV_FONT, num } from '../annotations/appearance';
import { textWidth } from '../annotations/helvetica-widths';
import { toWinAnsi } from '../annotations/winansi';
import type { RandomBytes } from '../pdf/crypt-rules';
import { finishDelta, reserveXref, startDelta } from '../pdf/delta-writer';
import { effectiveResources, freeResourceName, withResource, wrapStreams, wrappedContents } from '../pdf/page-content';
import { createAllocator, catalogRef, type PageRotation } from '../pdf/page-tree';
import type { ObjectReader } from '../pdf/object-reader';
import { withEntries } from '../pdf/objects';
import { toSaveError } from '../pdf/save-error';

/** Caja en espacio de usuario de la página (puntos): [x0, y0, x1, y1] con x0 < x1 y y0 < y1. */
export interface OcrWord {
  readonly text: string;
  readonly box: readonly [number, number, number, number];
}

export interface OcrPage {
  readonly pageIndex: number;
  readonly rotate: PageRotation;
  readonly words: readonly OcrWord[];
}

export interface OcrLayerInput {
  readonly source: ByteSource;
  /** Abierto sobre el mismo `source` (con la contraseña si la hay). */
  readonly reader: ObjectReader;
  readonly pages: readonly OcrPage[];
  /** ISO 8601 (semilla de `/ID`). */
  readonly now: string;
  readonly random?: RandomBytes;
  /** Abortada → `cancelled`. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface OcrLayerOutput {
  readonly delta: Uint8Array;
  /** Tamaño del fichero resultante: `source.size + delta.length`. */
  readonly expectedSize: number;
  /** Páginas con capa de texto escrita. */
  readonly pagesWritten: number;
}

/** Nombre base del recurso de fuente; `freeResourceName` le añade un sufijo si ya existe. */
const FONT_BASE = 'SuiteOcr';
/** Tamaño mínimo de fuente, en puntos. */
const MIN_FONT_SIZE = 1;
/** Escala horizontal mínima y máxima, en porcentaje. */
const MIN_SCALE = 10;
const MAX_SCALE = 1000;
/** Escala por defecto cuando la palabra no tiene ancho medible. */
const DEFAULT_SCALE = 100;
const PERCENT = 100;

/**
 * Operadores de la capa para una página: un bloque `BT…ET` por palabra (las vacías tras `trim` se omiten). `font`
 * es el nombre del recurso de fuente. Las cajas mal formadas son un bug de quien prepara las palabras: lanza `RangeError`.
 */
export function ocrOperators(page: OcrPage, font: string): string {
  let out = '';
  for (const word of page.words) {
    const text = word.text.trim();
    if (text === '') continue;
    out += wordBlock(word.box, page.rotate, text, font);
  }
  return out;
}

/** Bloque `BT…ET` de una palabra: tamaño = alto de la caja y escala horizontal para que ocupe su ancho. */
function wordBlock(box: OcrWord['box'], rotate: PageRotation, text: string, font: string): string {
  const [x0, y0, x1, y1] = box;
  if (![x0, y0, x1, y1].every(Number.isFinite) || !(x0 < x1) || !(y0 < y1)) {
    throw new RangeError(`caja OCR no válida para «${text}»`);
  }
  const { origin, width, height, matrix } = orientation(box, rotate);
  const [ox, oy] = origin;
  const fontSize = Math.max(MIN_FONT_SIZE, height);
  const scale = horizontalScale(text, width, fontSize);
  return `BT 3 Tr /${font} ${num(fontSize)} Tf ${num(scale)} Tz ${matrix} ${num(ox)} ${num(oy)} Tm (${pdfString(text)} ) Tj ET\n`;
}

interface Orientation {
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly height: number;
  /** Componentes `a b c d` de la matriz `Tm` (sin el origen). */
  readonly matrix: string;
}

/** Origen, ancho, alto y matriz `Tm` para que el texto se vea horizontal según el giro de la página. */
function orientation([x0, y0, x1, y1]: OcrWord['box'], rotate: PageRotation): Orientation {
  const horizontal = x1 - x0;
  const vertical = y1 - y0;
  switch (rotate) {
    case 0:
      return { origin: [x0, y0], width: horizontal, height: vertical, matrix: '1 0 0 1' };
    case 90:
      return { origin: [x1, y0], width: vertical, height: horizontal, matrix: '0 1 -1 0' };
    case 180:
      return { origin: [x1, y1], width: horizontal, height: vertical, matrix: '-1 0 0 -1' };
    case 270:
      return { origin: [x0, y1], width: vertical, height: horizontal, matrix: '0 -1 1 0' };
  }
}

/** Escala horizontal (`Tz`, en porcentaje) que hace que `text` a tamaño `fontSize` ocupe `width` puntos. */
function horizontalScale(text: string, width: number, fontSize: number): number {
  const natural = textWidth(text, fontSize);
  const raw = natural === 0 ? DEFAULT_SCALE : (PERCENT * width) / natural;
  const rounded = Math.round(raw * PERCENT) / PERCENT;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, rounded));
}

/**
 * Cadena PDF (sin delimitadores exteriores) en WinAnsi. Escapa `(`, `)` y `\`; los bytes fuera de ASCII imprimible
 * van en octal para que el flujo siga siendo ASCII (el escritor de flujos codifica en UTF-8).
 */
function pdfString(text: string): string {
  let out = '';
  for (const byte of toWinAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** Escribe la capa como un único incremento. Sin palabras que escribir, devuelve delta vacío. Nunca lanza. */
export async function buildOcrUpdate(input: OcrLayerInput): Promise<Result<OcrLayerOutput>> {
  try {
    return await writeOcrLayer(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeOcrLayer(input: OcrLayerInput): Promise<Result<OcrLayerOutput>> {
  const { source, reader, now, signal, onProgress } = input;
  const n = await reader.pageCount();
  const pages = [...input.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  if (!isValidPages(pages, n)) return err(pdfError('organize-invalid'));
  if (signal?.aborted === true) return err(pdfError('cancelled'));

  const withText = pages.filter((page) => page.words.some((word) => word.text.trim() !== ''));
  if (withText.length === 0) return ok({ delta: new Uint8Array(0), expectedSize: source.size, pagesWritten: 0 });

  const alloc = createAllocator(reader.xref.size);
  const fontRef = alloc.next();
  const writer = await startDelta(source, reader, input.random);
  writer.object(fontRef.num, 0, HELV_FONT);

  for (const [index, page] of withText.entries()) {
    if (isAborted(signal)) return err(pdfError('cancelled'));
    const pageRef = await reader.pageRef(page.pageIndex);
    const pageDict = await reader.getDict(pageRef);
    if (pageDict === null) throw new Error(`página ${String(page.pageIndex + 1)} ilegible`);

    const inherited = await effectiveResources(reader, pageDict);
    const fontName = freeResourceName(inherited, 'Font', FONT_BASE);
    const resources = withResource(inherited, 'Font', fontName, fontRef);
    const streams = wrapStreams(ocrOperators(page, fontName));
    const open = alloc.next();
    const close = alloc.next();
    writer.object(open.num, 0, streams.open);
    writer.object(close.num, 0, streams.close);
    writer.object(pageRef.num, pageRef.gen, withEntries(pageDict, {
      Contents: wrappedContents(pageDict, open, close),
      Resources: resources,
    }));
    onProgress?.(index + 1, withText.length);
  }

  const root = await catalogRef(reader);
  const { xrefNum, size } = reserveXref(reader, alloc.nextNum);
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length, pagesWritten: withText.length });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/** Índices de página en [0, n), sin repetir. Cualquier otro caso es un plan inválido. */
function isValidPages(pages: readonly OcrPage[], n: number): boolean {
  const seen = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex >= n) return false;
    if (seen.has(page.pageIndex)) return false;
    seen.add(page.pageIndex);
  }
  return true;
}
