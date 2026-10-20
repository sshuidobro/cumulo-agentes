/**
 * Apariencias normales (`/AP /N`) de las anotaciones (ISO 32000-1 §12.5.5). Cada apariencia es un
 * Form XObject cuyo `BBox` es el `rect` de la anotación y sin `/Matrix`: el contenido va en
 * coordenadas de página. Así Adobe, navegadores y móviles la dibujan igual que nosotros.
 */
import { flateEncode } from '../pdf/filters';
import { bytesString, dict, name, stream, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from '../pdf/objects';
import { serializeValue } from '../pdf/serialize';
import type {
  Annotation,
  BoxShapeAnnotation,
  FreeTextAnnotation,
  InkAnnotation,
  LineShapeAnnotation,
  NoteAnnotation,
  PolygonAnnotation,
  Rgb,
  SignatureAnnotation,
  StampAnnotation,
  TextMarkupAnnotation,
} from './model';
import { arrowWings, stampTextBox, STAMP_LABELS } from './shapes';
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
/** Constante de Bézier para aproximar un cuarto de elipse o de círculo (ISO 32000-1 §8.5.2.2). */
const BEZIER_K = 0.5523;
/** Radio de las esquinas redondeadas del sello, en puntos. */
const STAMP_RADIUS = 4;
/** Distancia del borde del sello a su contorno, en puntos. */
const STAMP_INSET = 1;

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
  /** Recursos `/XObject` (la imagen de una firma). */
  readonly xobject?: PdfDict;
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

/**
 * Texto libre: borde de 1 pt (salvo `borderless`, PDF-149), texto Helvetica ajustado al rect y recortado a él.
 */
function freeTextDrawing(a: FreeTextAnnotation): Drawing {
  const [x1, y1, x2, y2] = a.rect;
  const width = x2 - x1;
  const height = y2 - y1;
  const fontSize = a.fontSize;
  const lines = wrapText(a.contents, width - 2 * FREETEXT_MARGIN, fontSize);
  const leading = FREETEXT_LEADING * fontSize;

  const border =
    a.borderless === true
      ? []
      : [
          '1 w',
          colorOp(a.color, 'RG'),
          `${num(x1 + 0.5)} ${num(y1 + 0.5)} ${num(width - 1)} ${num(height - 1)} re S`,
        ];
  const ops = [
    ...border,
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

/** Trazos (`[x0, y0, x1, y1, ...]` cada uno) como operadores de trazo; sin fijar color ni grosor. */
function strokeOps(paths: readonly (readonly number[])[]): string[] {
  const ops: string[] = [];
  for (const p of paths) {
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
  return ops;
}

/** Dibujo a mano: trazos redondeados de `width` puntos. Un trazo de un punto es un segmento de longitud 0. */
function inkDrawing(a: InkAnnotation): Drawing {
  return withOpacity(a, [`1 J 1 j ${num(a.width)} w`, colorOp(a.color, 'RG'), ...strokeOps(a.paths)]);
}

/**
 * Firma (ADR-0020). `ink`: trazos escalados de su caja al `rect` (`q sx 0 0 sy x1 y1 cm`), así el grosor también
 * se escala como en el visor. `image`: la imagen ocupa todo el `rect`.
 */
function signatureDrawing(a: SignatureAnnotation, imageRef: PdfRef | undefined): Drawing {
  const [x1, y1, x2, y2] = a.rect;
  const art = a.art;
  if (art.kind === 'ink') {
    const [boxW, boxH] = art.box;
    const sx = (x2 - x1) / boxW;
    const sy = (y2 - y1) / boxH;
    const ops = [
      `q ${num(sx)} 0 0 ${num(sy)} ${nums([x1, y1])} cm`,
      `1 J 1 j ${num(art.width)} w`,
      colorOp(a.color, 'RG'),
      ...strokeOps(art.paths),
      'Q',
    ];
    return withOpacity(a, ops);
  }
  if (imageRef === undefined) {
    // Quien escribe una firma con imagen debe reservar y pasar su referencia (PDF-085, incremental.ts).
    throw new Error(`firma ${a.id} con imagen sin referencia de XObject`);
  }
  const ops = [`q ${num(x2 - x1)} 0 0 ${num(y2 - y1)} ${nums([x1, y1])} cm /Im0 Do Q`];
  return { ...withOpacity(a, ops), xobject: dict({ Im0: imageRef }) };
}

/** Operador de pintado de una forma: relleno y trazo si hay relleno (`B`), solo trazo si no (`S`). */
function paintOp(interior: Rgb | null): string {
  return interior === null ? 'S' : 'B';
}

/** Operadores del relleno, si lo hay. */
function fillOps(interior: Rgb | null): string[] {
  return interior === null ? [] : [colorOp(interior, 'rg')];
}

/** Rectángulo: el trazo de `width` va por dentro de `rect`. */
function squareDrawing(a: BoxShapeAnnotation): Drawing {
  const [x1, y1, x2, y2] = a.rect;
  const w = a.width;
  const ops = [
    `${num(w)} w`,
    colorOp(a.color, 'RG'),
    ...fillOps(a.interior),
    `${nums([x1 + w / 2, y1 + w / 2, x2 - x1 - w, y2 - y1 - w])} re`,
    paintOp(a.interior),
  ];
  return withOpacity(a, ops);
}

/** Elipse inscrita en `rect` reducido `width / 2` a cada lado: cuatro curvas de Bézier. */
function circleDrawing(a: BoxShapeAnnotation): Drawing {
  const [x1, y1, x2, y2] = a.rect;
  const w = a.width;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1 - w) / 2;
  const ry = (y2 - y1 - w) / 2;
  const kx = BEZIER_K * rx;
  const ky = BEZIER_K * ry;
  const ops = [
    `${num(w)} w`,
    colorOp(a.color, 'RG'),
    ...fillOps(a.interior),
    `${nums([cx + rx, cy])} m`,
    `${nums([cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry])} c`,
    `${nums([cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy])} c`,
    `${nums([cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry])} c`,
    `${nums([cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy])} c`,
    'h',
    paintOp(a.interior),
  ];
  return withOpacity(a, ops);
}

/**
 * Punta de flecha en `tip`, con las alas a ±30° hacia atrás (hacia `other`). Abierta: dos segmentos.
 * Cerrada: triángulo que se rellena si hay `interior`. Un segmento de longitud 0 no tiene dirección: sin punta.
 */
function arrowHeadOps(
  tip: readonly [number, number],
  other: readonly [number, number],
  width: number,
  closed: boolean,
  interior: Rgb | null,
): string[] {
  const wings = arrowWings(tip, other, width);
  if (wings === null) return [];
  const path = `${nums(wings[0])} m ${nums(tip)} l ${nums(wings[1])} l`;
  if (!closed) return [`${path} S`];
  return [interior === null ? `${path} s` : `${path} h B`];
}

/** Línea o flecha: trazo de `width` con uniones y extremos redondeados; puntas según `endings`. */
function lineShapeDrawing(a: LineShapeAnnotation): Drawing {
  const [x1, y1, x2, y2] = a.points;
  const [start, end] = a.endings;
  const ops = [
    '1 J 1 j',
    `${num(a.width)} w`,
    colorOp(a.color, 'RG'),
    ...fillOps(a.interior),
    `${nums([x1, y1])} m ${nums([x2, y2])} l S`,
  ];
  if (start !== 'None') {
    ops.push(...arrowHeadOps([x1, y1], [x2, y2], a.width, start === 'ClosedArrow', a.interior));
  }
  if (end !== 'None') {
    ops.push(...arrowHeadOps([x2, y2], [x1, y1], a.width, end === 'ClosedArrow', a.interior));
  }
  return withOpacity(a, ops);
}

/** Polígono cerrado: `m`, `l`… y `h` con uniones redondeadas. */
function polygonDrawing(a: PolygonAnnotation): Drawing {
  const v = a.vertices;
  const ops = [`${num(a.width)} w`, '1 j', colorOp(a.color, 'RG'), ...fillOps(a.interior), `${nums(pointAt(v, 0))} m`];
  for (let i = 2; i + 1 < v.length; i += 2) ops.push(`${nums(pointAt(v, i))} l`);
  ops.push('h', paintOp(a.interior));
  return withOpacity(a, ops);
}

/** Rectángulo de esquinas redondeadas (radio `r`) con cuatro curvas de Bézier; sin pintar. */
function roundedRectOps(x1: number, y1: number, x2: number, y2: number, r: number): string[] {
  const k = BEZIER_K * r;
  return [
    `${nums([x1 + r, y1])} m`,
    `${nums([x2 - r, y1])} l`,
    `${nums([x2 - r + k, y1, x2, y1 + r - k, x2, y1 + r])} c`,
    `${nums([x2, y2 - r])} l`,
    `${nums([x2, y2 - r + k, x2 - r + k, y2, x2 - r, y2])} c`,
    `${nums([x1 + r, y2])} l`,
    `${nums([x1 + r - k, y2, x1, y2 - r + k, x1, y2 - r])} c`,
    `${nums([x1, y1 + r])} l`,
    `${nums([x1, y1 + r - k, x1 + r - k, y1, x1 + r, y1])} c`,
    'h',
  ];
}

/**
 * Sello: contorno redondeado del color del sello (a 1 pt del borde) y su texto en Helvetica, reducido si no cabe
 * y centrado en la caja.
 */
function stampDrawing(a: StampAnnotation): Drawing {
  const [x1, y1, x2, y2] = a.rect;
  const { x, y, fontSize } = stampTextBox(a.name, a.rect);
  const label = STAMP_LABELS[a.name];
  const ops = [
    colorOp(a.color, 'RG'),
    colorOp(a.color, 'rg'),
    '2 w',
    ...roundedRectOps(x1 + STAMP_INSET, y1 + STAMP_INSET, x2 - STAMP_INSET, y2 - STAMP_INSET, STAMP_RADIUS),
    'S',
    `BT /Helv ${num(fontSize)} Tf ${nums([x, y])} Td ${pdfText(label)} Tj ET`,
  ];
  return { ...withOpacity(a, ops), font: true };
}

function drawingOf(a: Annotation, imageRef: PdfRef | undefined): Drawing {
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
    case 'signature':
      return signatureDrawing(a, imageRef);
    case 'square':
    case 'circle':
      return a.type === 'square' ? squareDrawing(a) : circleDrawing(a);
    case 'line':
      return lineShapeDrawing(a);
    case 'polygon':
      return polygonDrawing(a);
    case 'stamp':
      return stampDrawing(a);
    case 'reply':
    case 'review':
      // Respuestas y estados (PDF-058): Form XObject vacío; ningún visor pinta un icono.
      return { ops: [] };
  }
}

/**
 * Genera el Form XObject de la apariencia normal de `a`. Función pura: mismo `a`, mismos bytes.
 * `imageRef` es el Image XObject de una firma con imagen (obligatorio en ese caso; se ignora en el resto).
 */
export function buildAppearance(a: Annotation, imageRef?: PdfRef): Appearance {
  const drawing = drawingOf(a, imageRef);
  const entries: Record<string, PdfValue> = {};
  if (drawing.gs !== undefined) entries.ExtGState = dict({ GS0: drawing.gs });
  if (drawing.font === true) entries.Font = dict({ Helv: HELV_FONT });
  if (drawing.xobject !== undefined) entries.XObject = drawing.xobject;
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
