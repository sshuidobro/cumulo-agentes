/**
 * Texto libre (PDF-034): reglas de tamaño, ajuste y creación. Puro: sin React ni pdf.js. Coordenadas en puntos PDF.
 * Los valores de margen e interlineado son los de la apariencia (PDF-027) y los del dibujo en pantalla, para que
 * el texto se vea igual en el visor y en otros programas.
 */
import type { FreeTextAnnotation, RectPt, Rgb } from './model';
import { wrapText } from './wrap';

/** Margen interior del texto, en puntos. */
export const FREETEXT_MARGIN_PT = 2;
/** Interlineado, en múltiplos del tamaño de letra. */
export const FREETEXT_LEADING = 1.15;
/** Ancho del cuadro que crea un clic, en puntos. */
export const FREETEXT_CLICK_WIDTH_PT = 200;
/** Ancho mínimo del cuadro al arrastrar, crear o redimensionar, en puntos. */
export const FREETEXT_MIN_WIDTH_PT = 20;

/** Alto de una línea de texto más los márgenes: `fontSize × 1,15 + 4`. */
export function freeTextOneLineHeight(fontSize: number): number {
  return fontSize * FREETEXT_LEADING + 2 * FREETEXT_MARGIN_PT;
}

/** Alto mínimo de un cuadro: `fontSize + 4`. */
export function freeTextMinHeight(fontSize: number): number {
  return fontSize + 2 * FREETEXT_MARGIN_PT;
}

/** Alto que necesita `text` dentro de un cuadro de ancho `width`: líneas de `wrapText` × interlineado + márgenes. */
export function freeTextRequiredHeight(text: string, width: number, fontSize: number): number {
  const lines = wrapText(text, width - 2 * FREETEXT_MARGIN_PT, fontSize).length;
  return lines * fontSize * FREETEXT_LEADING + 2 * FREETEXT_MARGIN_PT;
}

/** Texto sin caracteres visibles: no se crea ni se conserva una anotación. */
export function isBlankText(text: string): boolean {
  return text.trim() === '';
}

/**
 * Cuadro de un clic: 200 pt de ancho y alto de una línea, con la esquina superior izquierda en (x, y). Como las notas,
 * se desplaza hacia dentro si el punto cae cerca del borde de la página (`bounds`).
 */
export function freeTextClickRect(x: number, y: number, fontSize: number, bounds: RectPt): RectPt {
  const [bx1, by1, bx2, by2] = bounds;
  const width = FREETEXT_CLICK_WIDTH_PT;
  const height = freeTextOneLineHeight(fontSize);
  const x1 = clamp(x, bx1, bx2 - width);
  const top = clamp(y, by1 + height, by2);
  return [x1, top - height, x1 + width, top];
}

/**
 * Cuadro arrastrado entre dos esquinas (en puntos PDF, en cualquier orden). Nunca más pequeño que el mínimo.
 */
export function freeTextDragRect(x1: number, y1: number, x2: number, y2: number, fontSize: number): RectPt {
  const left = Math.min(x1, x2);
  const top = Math.max(y1, y2);
  const width = Math.max(Math.abs(x2 - x1), FREETEXT_MIN_WIDTH_PT);
  const height = Math.max(Math.abs(y2 - y1), freeTextMinHeight(fontSize));
  return [left, top - height, left + width, top];
}

/**
 * Redimensiona un cuadro manteniendo su esquina superior izquierda. `dw` cambia el ancho (positivo, hacia la derecha) y
 * `dh` el alto (positivo, hacia abajo de la página). No baja de los mínimos.
 */
export function resizeFreeTextRect(rect: RectPt, dw: number, dh: number, fontSize: number): RectPt {
  const [x1, y1, x2, y2] = rect;
  const right = Math.max(x2 + dw, x1 + FREETEXT_MIN_WIDTH_PT);
  const bottom = Math.min(y1 - dh, y2 - freeTextMinHeight(fontSize));
  return [x1, bottom, right, y2];
}

/**
 * Cuadro que muestra `text`: si el texto no cabe, crece hacia abajo (la esquina superior no se mueve) sin pasar de
 * `floor`, el borde inferior de la página. Nunca se encoge: si ya cabe, devuelve `rect` tal cual.
 */
export function fitFreeTextRect(rect: RectPt, text: string, fontSize: number, floor: number): RectPt {
  const [x1, y1, x2, y2] = rect;
  const needed = freeTextRequiredHeight(text, x2 - x1, fontSize);
  if (y2 - y1 >= needed) return rect;
  return [x1, Math.min(y1, Math.max(floor, y2 - needed)), x2, y2];
}

export interface NewFreeTextInput {
  readonly id: string;
  readonly pageIndex: number;
  readonly rect: RectPt;
  readonly fontSize: number;
  /** Color del borde. */
  readonly color: Rgb;
  readonly textColor: Rgb;
  readonly author: string;
  /** Instante de creación en ISO 8601. */
  readonly now: string;
  /** Texto inicial; por defecto, vacío. */
  readonly contents?: string;
  /** Sin rectángulo de borde (PDF-130). Si no se pasa, el texto lleva borde. */
  readonly borderless?: true;
}

/** Texto libre nuevo: borde del color indicado, opacidad plena, sin texto salvo que se pase `contents`. */
export function newFreeTextAnnotation(input: NewFreeTextInput): FreeTextAnnotation {
  return {
    id: input.id,
    type: 'freetext',
    pageIndex: input.pageIndex,
    rect: input.rect,
    fontSize: input.fontSize,
    textColor: input.textColor,
    color: input.color,
    opacity: 1,
    contents: input.contents ?? '',
    author: input.author,
    modified: input.now,
    created: input.now,
    origin: { kind: 'new' },
    ...(input.borderless === true ? { borderless: true as const } : {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
