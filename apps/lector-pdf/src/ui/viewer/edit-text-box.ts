import type { EditableLine, FontFamily, StandardFont } from '../../core/edit-text';
import { freeTextBox, type CssMatrix } from './freetext-box';

/**
 * Geometría del cuadro de «Editar texto» sobre la página (PDF-147). Puro: sin React ni pdf.js. La caja cubre
 * `line.bounds` y se gira con la matriz de la página; el texto va en la línea base `origin`.
 */

/** Pila CSS de cada familia estándar, con sustitutos habituales en Linux y Windows. */
export const FONT_STACK: Readonly<Record<FontFamily, string>> = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

/** Proporción aproximada de la línea base dentro del alto de la línea (ascendente de la fuente). */
const BASELINE_RATIO = 0.8;
/** Ancho medio aproximado de un carácter, en `em`, para que el cuadro de escritura crezca con el texto. */
const CHAR_EM = 0.6;

export interface LineBoxGeometry {
  /** Ancho y alto en píxeles CSS, sin girar. */
  readonly width: number;
  readonly height: number;
  /** `transform` CSS del contenedor, con origen en su esquina superior izquierda. */
  readonly matrix: CssMatrix;
  /** Tamaño de letra en píxeles CSS. */
  readonly fontSize: number;
  /** Distancia en píxeles desde el borde superior de la caja hasta la línea base del texto. */
  readonly baseline: number;
  /** Ancho mínimo en píxeles para un texto de `chars` caracteres (el cuadro de escritura crece con el texto). */
  readonly textWidth: (chars: number) => number;
}

/** Geometría de una línea en píxeles con la matriz de la página (`viewport.transform`). */
export function lineBoxGeometry(line: EditableLine, transform: readonly number[]): LineBoxGeometry {
  const box = freeTextBox(line.bounds, transform);
  const fontSize = line.style.fontSize * box.scale;
  const baseline = (line.bounds[3] - line.origin[1]) * box.scale;
  return {
    width: box.width,
    height: box.height,
    matrix: box.matrix,
    fontSize,
    baseline,
    textWidth: (chars: number): number => Math.max(box.width, chars * fontSize * CHAR_EM),
  };
}

/** Posición vertical del texto dentro de la caja: la línea base queda a `baseline` píxeles del borde superior. */
export function baselineTop(geometry: LineBoxGeometry): number {
  return geometry.baseline - geometry.fontSize * BASELINE_RATIO;
}

/** Estilo CSS de la letra estándar: familia, negrita y cursiva. */
export function fontCss(font: StandardFont): { readonly fontFamily: string; readonly fontWeight: 'normal' | 'bold'; readonly fontStyle: 'normal' | 'italic' } {
  return {
    fontFamily: FONT_STACK[font.family],
    fontWeight: font.bold ? 'bold' : 'normal',
    fontStyle: font.italic ? 'italic' : 'normal',
  };
}

/** Punto (puntos PDF) del centro de un rectángulo: sirve para reabrir una línea desde su caja. */
export function centerOf(rect: readonly [number, number, number, number]): readonly [number, number] {
  return [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
}
