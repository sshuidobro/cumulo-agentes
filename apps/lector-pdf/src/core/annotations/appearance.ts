/**
 * Apariencias normales (`/AP /N`) de las anotaciones (ISO 32000-1 §12.5.5). Cada apariencia es un
 * Form XObject cuyo `BBox` es el `rect` de la anotación y sin `/Matrix`: el contenido va en
 * coordenadas de página. Así Adobe, navegadores y móviles la dibujan igual que nosotros.
 */
import { flateEncode } from '../pdf/filters';
import { bytesString, dict, name, stream, type PdfDict, type PdfStream, type PdfValue } from '../pdf/objects';
import { serializeValue } from '../pdf/serialize';
import type { Annotation, FreeTextAnnotation, InkAnnotation, NoteAnnotation, Rgb, TextMarkupAnnotation } from './model';
import { wrapText } from './wrap';
import { toWinAnsi } from './winansi';

export interface Appearance {
  readonly stream: PdfStream;
  /** Mismo diccionario que `stream.dict.entries.get('Resources')`; se expone para tests. */
  readonly resources: PdfDict;
}

/** Icono de nota: caja de 20×20 pt anclada en la esquina superior izquierda de `rect`. */
const NOTE_SIZE = 20;
/** Margen interior del texto libre, en puntos. */
const FREETEXT_MARGIN = 2;
/** Interlineado del texto libre, en múltiplos del tamaño de fuente. */
const FREETEXT_LEADING = 1.15;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
export const HELV_FONT: PdfDict = dict({
  Type: name('Font'),
  Subtype: name('Type1'),
  BaseFont: name('Helvetica'),
  Encoding: name('WinAnsiEncoding'),
});

/** Partes de la apariencia: operadores, diccionario ExtGState `GS0` opcional y uso de la fuente Helv. */
interface Drawing {
  readonly ops: readonly string[];
  readonly gs?: PdfDict;
  readonly font?: boolean;
}

/** Número PDF con la misma serialización que el resto del escritor (4 decimales como máximo). */
export function num(n: number): string {
  return TEXT_DECODER.decode(serializeValue(n));
}

export function nums(values: readonly number[]): string {
  return values.map(num).join(' ');
}

function colorOp(c: Rgb, op: 'rg' | 'RG'): string {
  return `${nums(c)} ${op}`;
}

/** Cadena literal PDF en WinAnsi (`(...)`, con escapes). Siempre ASCII. */
export function pdfText(s: string): string {
  return TEXT_DECODER.decode(serializeValue(bytesString(toWinAnsi(s))));
}

/** Punto de un trazo `[x0, y0, x1, y1, ...]` en el índice `i`. */
function pointAt(p: readonly number[], i: number): readonly [number, number] {
  return [p[i] ?? 0, p[i + 1] ?? 0];
}

function gsDict(opacity: number, multiply: boolean): PdfDict {
  const entries: Record<string, PdfValue> = { Type: name('ExtGState') };
  if (multiply) entries.BM = name('Multiply');
  entries.CA = opacity;
  entries.ca = opacity;
  return dict(entries);
}

/** Añade `/GS0 gs` con la opacidad de la anotación si es menor que 1. */
function withOpacity(a: Annotation, ops: readonly string[]): Drawing {
  if (a.opacity >= 1) return { ops };
  return { ops: ['/GS0 gs', ...ops], gs: gsDict(a.opacity, false) };
}

/** Resaltado: polígono relleno por quad en modo de fusión Multiply. */
function highlightDrawing(a: TextMarkupAnnotation): Drawing {
  const ops = ['/GS0 gs', colorOp(a.color, 'rg')];
  for (const q of a.quads) {
    // Orden Z de los puntos: 1 = sup-izq, 2 = sup-der, 3 = inf-izq, 4 = inf-der.
    ops.push(`${nums([q[0], q[1]])} m ${nums([q[2], q[3]])} l ${nums([q[6], q[7]])} l ${nums([q[4], q[5]])} l f`);
  }
  return { ops, gs: gsDict(a.opacity, true) };
}

/** Subrayado (`mitad` = false) o tachado (`mitad` = true) de cada quad. */
function lineDrawing(a: TextMarkupAnnotation, middle: boolean): Drawing {
  const ops = [colorOp(a.color, 'RG')];
  for (const q of a.quads) {
    const yBottom = Math.min(q[1], q[3], q[5], q[7]);
    const yTop = Math.max(q[1], q[3], q[5], q[7]);
    const height = yTop - yBottom;
    const thickness = Math.max(1, height / 14);
    const y = middle ? yBottom + height / 2 : yBottom + thickness;
    const xLeft = Math.min(q[0], q[4]);
    const xRight = Math.max(q[2], q[6]);
    ops.push(`${num(thickness)} w ${num(xLeft)} ${num(y)} m ${num(xRight)} ${num(y)} l S`);
  }
  return withOpacity(a, ops);
}

/** Icono de nota: bocadillo de borde negro de 1 pt relleno del color, con tres líneas. Igual para todos los iconos. */
function noteDrawing(a: NoteAnnotation): Drawing {
  const originX = a.rect[0];
  const originY = a.rect[3] - NOTE_SIZE;
  const p = (u: number, v: number): string => nums([originX + u, originY + v]);
  const ops = [
    '1 w',
    '0 0 0 RG',
    colorOp(a.color, 'rg'),
    // Contorno del bocadillo con su cola (abajo a la izquierda), cerrado, relleno y trazado.
    `${p(1, 19)} m ${p(19, 19)} l ${p(19, 8)} l ${p(9, 8)} l ${p(4, 2)} l ${p(4, 8)} l ${p(1, 8)} l h b`,
    `${p(4, 16)} m ${p(16, 16)} l S`,
    `${p(4, 13)} m ${p(16, 13)} l S`,
    `${p(4, 10)} m ${p(16, 10)} l S`,
  ];
  return withOpacity(a, ops);
}

/** Texto libre: borde de 1 pt, texto Helvetica ajustado al rect y recortado a él. */
function freeTextDrawing(a: FreeTextAnnotation): Drawing {
  const [x1, y1, x2, y2] = a.rect;
  const width = x2 - x1;
  const height = y2 - y1;
  const fontSize = a.fontSize;
  const lines = wrapText(a.contents, width - 2 * FREETEXT_MARGIN, fontSize);
  const leading = FREETEXT_LEADING * fontSize;

  const ops = [
    '1 w',
    colorOp(a.color, 'RG'),
    `${num(x1 + 0.5)} ${num(y1 + 0.5)} ${num(width - 1)} ${num(height - 1)} re S`,
    'q',
    `${nums([x1, y1, width, height])} re W n`,
    colorOp(a.textColor, 'rg'),
  ];
  let baseline = y2 - FREETEXT_MARGIN - fontSize;
  for (const line of lines) {
    if (line !== '') {
      ops.push(
        `BT /Helv ${num(fontSize)} Tf ${nums([x1 + FREETEXT_MARGIN, baseline])} Td ${pdfText(line)} Tj ET`,
      );
    }
    baseline -= leading;
  }
  ops.push('Q');
  return { ...withOpacity(a, ops), font: true };
}

/** Dibujo a mano: trazos redondeados de `width` puntos. Un trazo de un punto es un segmento de longitud 0. */
function inkDrawing(a: InkAnnotation): Drawing {
  const ops = [`1 J 1 j ${num(a.width)} w`, colorOp(a.color, 'RG')];
  for (const p of a.paths) {
    const [x0, y0] = pointAt(p, 0);
    ops.push(`${nums([x0, y0])} m`);
    // Un único punto: segmento de longitud 0 (con extremos redondeados se ve como un punto).
    if (p.length === 2) ops.push(`${nums([x0, y0])} l`);
    for (let i = 2; i + 1 < p.length; i += 2) {
      const [x, y] = pointAt(p, i);
      ops.push(`${nums([x, y])} l`);
    }
    ops.push('S');
  }
  return withOpacity(a, ops);
}

function drawingOf(a: Annotation): Drawing {
  switch (a.type) {
    case 'highlight':
      return highlightDrawing(a);
    case 'underline':
      return lineDrawing(a, false);
    case 'strikeout':
      return lineDrawing(a, true);
    case 'note':
      return noteDrawing(a);
    case 'freetext':
      return freeTextDrawing(a);
    case 'ink':
      return inkDrawing(a);
  }
}

/** Genera el Form XObject de la apariencia normal de `a`. Función pura: mismo `a`, mismos bytes. */
export function buildAppearance(a: Annotation): Appearance {
  const drawing = drawingOf(a);
  const entries: Record<string, PdfValue> = {};
  if (drawing.gs !== undefined) entries.ExtGState = dict({ GS0: drawing.gs });
  if (drawing.font === true) entries.Font = dict({ Helv: HELV_FONT });
  const resources = dict(entries);

  const content = TEXT_ENCODER.encode(`${drawing.ops.join('\n')}\n`);
  const appearance = stream(
    {
      Type: name('XObject'),
      Subtype: name('Form'),
      BBox: [...a.rect],
      Resources: resources,
      Filter: name('FlateDecode'),
    },
    flateEncode(content),
  );
  return { stream: appearance, resources };
}
