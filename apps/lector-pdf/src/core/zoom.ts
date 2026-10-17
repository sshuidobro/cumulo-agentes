/** Puntos PDF (1/72 in) → píxeles CSS (1/96 in). 100 % = tamaño real. */
export const CSS_UNITS = 96 / 72;

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/** Pasos del botón «alejar/acercar» y de Ctrl+rueda por pasos. */
export const ZOOM_STEPS: readonly number[] = [
  0.1, 0.25, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8,
];

export type ZoomMode =
  | { readonly kind: 'auto' }
  | { readonly kind: 'fit-width' }
  | { readonly kind: 'fit-page' }
  | { readonly kind: 'custom'; readonly zoom: number };

export const DEFAULT_ZOOM_MODE: ZoomMode = { kind: 'auto' };

/** Límite del modo automático: nunca amplía más de 125 % por encima del tamaño real. */
export const AUTO_MAX_ZOOM = 1.25;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Tolerancia para comparar pasos de zoom en coma flotante. */
const STEP_EPSILON = 1e-6;

/** Factor exponencial de la rueda según la unidad de `deltaMode` (0 píxeles, 1 líneas, 2 páginas). */
const WHEEL_K: Readonly<Record<0 | 1 | 2, number>> = {
  0: 0.002,
  1: 0.05,
  2: 0.5,
};

/** Acotar a [MIN_ZOOM, MAX_ZOOM]. Un valor no finito es un bug del llamante. */
export function clampZoom(z: number): number {
  assertFinite(z, 'zoom');
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function zoomToScale(z: number): number {
  return z * CSS_UNITS;
}

/** Siguiente (`1`) o anterior (`-1`) paso estrictamente mayor o menor que `current`; en el extremo devuelve el extremo. */
export function nextZoom(current: number, direction: 1 | -1): number {
  assertFinite(current, 'zoom');
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > current + STEP_EPSILON) ?? MAX_ZOOM;
  }
  let previous: number | undefined;
  for (const step of ZOOM_STEPS) {
    if (step < current - STEP_EPSILON) previous = step;
  }
  return previous ?? MIN_ZOOM;
}

/**
 * Zoom que ajusta el ancho, o la página completa, al visor descontando el margen.
 * `pagePt` es el tamaño ya rotado de la página de referencia, en puntos PDF.
 */
export function fitZoom(kind: 'fit-width' | 'fit-page', pagePt: Size, viewport: Size, margin: Size): number {
  const fitWidth = (viewport.width - margin.width) / (pagePt.width * CSS_UNITS);
  if (kind === 'fit-width') return clampZoom(fitWidth);
  const fitHeight = (viewport.height - margin.height) / (pagePt.height * CSS_UNITS);
  return clampZoom(Math.min(fitWidth, fitHeight));
}

/** Zoom efectivo de un modo. `auto` ajusta al ancho sin pasar de `AUTO_MAX_ZOOM`. */
export function resolveZoom(mode: ZoomMode, pagePt: Size, viewport: Size, margin: Size): number {
  switch (mode.kind) {
    case 'auto':
      return clampZoom(Math.min(fitZoom('fit-width', pagePt, viewport, margin), AUTO_MAX_ZOOM));
    case 'fit-width':
    case 'fit-page':
      return fitZoom(mode.kind, pagePt, viewport, margin);
    case 'custom':
      return clampZoom(mode.zoom);
  }
}

/** Texto para la barra de zoom: `1.25` → `"125 %"`. */
export function formatZoom(z: number): string {
  return `${Math.round(z * 100)} %`;
}

const ZOOM_INPUT = /^(\d+(?:[.,]\d+)?)\s*%?$/;

/**
 * Interpreta lo que escribe el usuario en la barra de zoom (siempre en porcentaje):
 * `"150"`, `"150%"`, `"150 %"` o `"150,5"`. Devuelve `null` si no es un número; fuera de rango, lo acota.
 */
export function parseZoomInput(text: string): number | null {
  const match = ZOOM_INPUT.exec(text.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const percent = Number(digits.replace(',', '.'));
  // toFixed evita el ruido de coma flotante (150,5 / 100 debe ser 1.505).
  return clampZoom(Number((percent / 100).toFixed(10)));
}

/** Zoom tras un evento de rueda: cada unidad de `deltaY` multiplica el zoom por `exp(-deltaY * k)`. */
export function wheelZoom(current: number, deltaY: number, deltaMode: 0 | 1 | 2): number {
  assertFinite(deltaY, 'deltaY');
  return clampZoom(current * Math.exp(-deltaY * WHEEL_K[deltaMode]));
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} no es finito: ${value}`);
}
