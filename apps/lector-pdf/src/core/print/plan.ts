import { MAX_CANVAS_DIM, MAX_CANVAS_PIXELS } from '../canvas-size';

export interface SheetPlan {
  readonly sheetWidthPt: number;
  readonly sheetHeightPt: number;
}

export interface PagePrintPlan {
  readonly rotate: 0 | 90;
  /** Tamaño ya girado (para la hoja). */
  readonly widthPt: number;
  readonly heightPt: number;
}

export const PRINT_DPI = { normal: 150, high: 300 } as const;

type Size = { readonly widthPt: number; readonly heightPt: number };

/** Hoja = tamaño (con /Rotate) de la primera página del rango. */
export function sheetFor(first: Size): SheetPlan {
  return { sheetWidthPt: first.widthPt, sheetHeightPt: first.heightPt };
}

/**
 * Con autoRotate, gira 90° si la orientación de la página no coincide con la de la hoja.
 * Las páginas cuadradas nunca giran: girarlas cambiaría el sentido del contenido sin ganar nada.
 */
export function planPage(page: Size, sheet: SheetPlan, autoRotate: boolean): PagePrintPlan {
  const pageOrientation = orientation(page.widthPt, page.heightPt);
  const sheetOrientation = orientation(sheet.sheetWidthPt, sheet.sheetHeightPt);
  const mismatch = pageOrientation !== null && sheetOrientation !== null && pageOrientation !== sheetOrientation;
  if (autoRotate && mismatch) {
    return { rotate: 90, widthPt: page.heightPt, heightPt: page.widthPt };
  }
  return { rotate: 0, widthPt: page.widthPt, heightPt: page.heightPt };
}

function orientation(width: number, height: number): 'landscape' | 'portrait' | null {
  if (width > height) return 'landscape';
  if (width < height) return 'portrait';
  return null;
}

/**
 * Escala de render para `dpi` (dpi/72 puntos → píxeles), reducida si hace falta para que el lienzo
 * no pase de MAX_CANVAS_PIXELS ni de MAX_CANVAS_DIM por lado.
 */
export function printScale(widthPt: number, heightPt: number, dpi: number): number {
  for (const [value, name] of [[widthPt, 'widthPt'], [heightPt, 'heightPt'], [dpi, 'dpi']] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} no válido: ${String(value)}`);
  }
  let scale = dpi / 72;
  if (widthPt * scale * (heightPt * scale) > MAX_CANVAS_PIXELS) {
    scale = Math.sqrt(MAX_CANVAS_PIXELS / (widthPt * heightPt));
  }
  return Math.min(scale, MAX_CANVAS_DIM / widthPt, MAX_CANVAS_DIM / heightPt);
}
