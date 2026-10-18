/**
 * Apariencia normal (`/AP /N`) de los widgets de texto, combo y lista (ISO 32000-1 §12.7.3.3).
 * Cada apariencia es un Form XObject con el valor ya dibujado, para que Adobe y cualquier visor
 * muestren lo guardado sin regenerarlo. Función pura: mismos datos, mismos bytes.
 */
import { HELV_FONT, num, nums, pdfText } from '../annotations/appearance';
import type { Rgb } from '../annotations/model';
import { textWidth } from '../annotations/helvetica-widths';
import { wrapText } from '../annotations/wrap';
import { flateEncode } from '../pdf/filters';
import { dict, name, stream, type PdfStream, type PdfValue } from '../pdf/objects';
import type { FieldValue, FormField, FormWidget } from './model';

/** Tamaño por defecto del texto multilínea y de las listas, en puntos. */
const DEFAULT_FONT_SIZE = 12;
/** Tope del tamaño automático de una línea. */
const AUTO_MAX_FONT_SIZE = 12;
/** Tamaño automático mínimo de una línea, en puntos. */
const MIN_FONT_SIZE = 4;
/** Margen horizontal interior, en puntos. */
const PADDING = 2;
/** Interlineado, en múltiplos del tamaño de fuente. */
const LEADING = 1.15;
/** Fondo de las opciones seleccionadas en una lista (azul claro). */
const SELECTION_COLOR: Rgb = [0.6, 0.75, 0.87];
const PASSWORD_MASK = '*';

type Align = FormField['align'];

/** Valor de selección de un combo o lista; vacío si el valor no es de tipo elección. */
function selectedOf(value: FieldValue): readonly string[] {
  return value.kind === 'choice' ? value.selected : [];
}

/** Texto mostrado de un combo: el `displayValue` de la opción elegida, o el propio valor si no hay opción. */
function comboText(field: FormField, selected: readonly string[]): string {
  const first = selected[0];
  if (first === undefined) return '';
  return field.options.find((o) => o.exportValue === first)?.displayValue ?? first;
}

/** Tamaño de una línea: el del campo, o el automático ajustado al ancho (con mínimo 4 pt). */
function lineFontSize(text: string, requested: number, bw: number, bh: number): number {
  if (requested > 0) return requested;
  let size = Math.min(AUTO_MAX_FONT_SIZE, (bh - 4) / LEADING);
  // El ancho es lineal en el tamaño: el mayor tamaño que cabe es (bw − 4) / ancho a 1 pt.
  const unitWidth = textWidth(text, 1);
  if (unitWidth > 0) size = Math.min(size, (bw - 4) / unitWidth);
  // Se trunca a 4 decimales, como se escribe en el PDF, para que el texto siga cabiendo tras serializar.
  return Math.max(MIN_FONT_SIZE, Math.floor(size * 10000) / 10000);
}

/** Línea base para centrar verticalmente una línea de tamaño `size` en una caja de alto `bh`. */
function baselineOf(bh: number, size: number): number {
  return (bh - 0.925 * size) / 2 + 0.207 * size;
}

/** Coordenada x de un texto de ancho `lineWidth` según la alineación del campo. */
function alignedX(align: Align, bw: number, lineWidth: number): number {
  if (align === 1) return (bw - lineWidth) / 2;
  if (align === 2) return bw - PADDING - lineWidth;
  return PADDING;
}

function singleLineOps(text: string, size: number, align: Align, bw: number, bh: number, color: Rgb): string[] {
  const x = alignedX(align, bw, textWidth(text, size));
  const y = baselineOf(bh, size);
  return [`BT /Helv ${num(size)} Tf ${nums(color)} rg ${nums([x, y])} Td ${pdfText(text)} Tj ET`];
}

function multilineOps(field: FormField, text: string, bw: number, bh: number): string[] {
  const size = field.fontSize > 0 ? field.fontSize : DEFAULT_FONT_SIZE;
  const ops = [`BT /Helv ${num(size)} Tf ${nums(field.textColor)} rg`];
  wrapText(text, bw - 2 * PADDING, size).forEach((line, i) => {
    if (line === '') return;
    const x = alignedX(field.align, bw, textWidth(line, size));
    const y = bh - PADDING - size - i * LEADING * size;
    ops.push(`1 0 0 1 ${nums([x, y])} Tm ${pdfText(line)} Tj`);
  });
  ops.push('ET');
  return ops;
}

/** Peine: cada carácter centrado en su celda (`bw / maxLen`), con posición absoluta. */
function combOps(field: FormField, chars: readonly string[], size: number, bw: number, bh: number): string[] {
  const cell = bw / field.maxLen;
  const y = baselineOf(bh, size);
  const ops = [`BT /Helv ${num(size)} Tf ${nums(field.textColor)} rg`];
  chars.forEach((ch, i) => {
    const x = i * cell + (cell - textWidth(ch, size)) / 2;
    ops.push(`1 0 0 1 ${nums([x, y])} Tm ${pdfText(ch)} Tj`);
  });
  ops.push('ET');
  return ops;
}

function textOps(field: FormField, value: FieldValue, bw: number, bh: number): string[] {
  const raw = value.kind === 'text' ? value.text : '';
  const text = field.password ? PASSWORD_MASK.repeat([...raw].length) : raw;
  if (text === '') return [];
  if (field.multiline) return multilineOps(field, text, bw, bh);
  const size = lineFontSize(text, field.fontSize, bw, bh);
  if (field.comb && field.maxLen > 0) {
    return combOps(field, [...text].slice(0, field.maxLen), size, bw, bh);
  }
  return singleLineOps(text, size, field.align, bw, bh, field.textColor);
}

function comboOps(field: FormField, value: FieldValue, bw: number, bh: number): string[] {
  const text = comboText(field, selectedOf(value));
  if (text === '') return [];
  const size = lineFontSize(text, field.fontSize, bw, bh);
  return singleLineOps(text, size, field.align, bw, bh, field.textColor);
}

/** Lista: todas las opciones de arriba abajo; las seleccionadas con fondo azul. Las que no caben no se dibujan. */
function listOps(field: FormField, value: FieldValue, bw: number, bh: number): string[] {
  const size = field.fontSize > 0 ? field.fontSize : DEFAULT_FONT_SIZE;
  const rowHeight = LEADING * size;
  const selected = selectedOf(value);
  const ops: string[] = [];
  for (let i = 0; i < field.options.length; i++) {
    const option = field.options[i];
    const yInf = bh - 1 - (i + 1) * rowHeight;
    if (option === undefined || yInf < 0) break;
    if (selected.includes(option.exportValue)) {
      ops.push(`${nums(SELECTION_COLOR)} rg ${nums([1, yInf, bw - 2, rowHeight])} re f`);
    }
    const x = PADDING;
    const y = yInf + 0.25 * size;
    ops.push(
      `BT /Helv ${num(size)} Tf ${nums(field.textColor)} rg 1 0 0 1 ${nums([x, y])} Tm ${pdfText(option.displayValue)} Tj ET`,
    );
  }
  return ops;
}

function contentOps(field: FormField, value: FieldValue, bw: number, bh: number): string[] {
  switch (field.type) {
    case 'text':
      return textOps(field, value, bw, bh);
    case 'combo':
      return comboOps(field, value, bw, bh);
    case 'list':
      return listOps(field, value, bw, bh);
    default:
      return [];
  }
}

/** Matriz que deja la apariencia en la orientación del widget (las mismas que pdf.js). */
function rotationMatrix(rotation: FormWidget['rotation'], w: number, h: number): readonly number[] | null {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, w, 0];
    case 180:
      return [-1, 0, 0, -1, w, h];
    case 270:
      return [0, -1, 1, 0, 0, h];
    default:
      return null;
  }
}

/**
 * Apariencia normal del widget con `value`, o `null` si el tipo de campo no se regenera
 * (casilla, opción, firma y botón). Función pura y determinista.
 */
export function buildFieldAppearance(field: FormField, widget: FormWidget, value: FieldValue): PdfStream | null {
  if (field.type !== 'text' && field.type !== 'combo' && field.type !== 'list') return null;

  const [x1, y1, x2, y2] = widget.rect;
  const w = x2 - x1;
  const h = y2 - y1;
  const sideways = widget.rotation === 90 || widget.rotation === 270;
  const bw = sideways ? h : w;
  const bh = sideways ? w : h;

  const ops = ['/Tx BMC', 'q'];
  if (widget.background !== null) ops.push(`${nums(widget.background)} rg ${nums([0, 0, bw, bh])} re f`);
  if (widget.border !== null) ops.push(`${nums(widget.border)} RG 1 w ${nums([0.5, 0.5, bw - 1, bh - 1])} re S`);
  ops.push(`${nums([1, 1, bw - 2, bh - 2])} re W n`);
  ops.push(...contentOps(field, value, bw, bh));
  ops.push('Q', 'EMC');

  const entries: Record<string, PdfValue> = {
    Type: name('XObject'),
    Subtype: name('Form'),
    BBox: [0, 0, bw, bh],
  };
  const matrix = rotationMatrix(widget.rotation, w, h);
  if (matrix !== null) entries.Matrix = matrix;
  entries.Resources = dict({ Font: dict({ Helv: HELV_FONT }) });
  entries.Filter = name('FlateDecode');

  const content = new TextEncoder().encode(`${ops.join('\n')}\n`);
  return stream(entries, flateEncode(content));
}
