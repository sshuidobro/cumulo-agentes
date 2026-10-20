/** Píxeles máximos de un lienzo (4096 × 8192): límite de memoria de los navegadores. */
export const MAX_CANVAS_PIXELS = 33_554_432;
/** Lado máximo de un lienzo en la mayoría de navegadores. */
export const MAX_CANVAS_DIM = 32_767;

export interface CanvasPlan {
  /** Tamaño del lienzo en píxeles de dispositivo. */
  readonly width: number;
  readonly height: number;
  /** Factor entre el tamaño CSS y el del lienzo. */
  readonly outputScale: number;
  /** `true` si hubo que reducir la resolución por debajo de la densidad de la pantalla. */
  readonly capped: boolean;
}

/**
 * Tamaño del lienzo para una página de `cssWidth × cssHeight` píxeles CSS.
 * Usa la densidad de la pantalla y la reduce si el lienzo superaría los límites.
 */
export function planCanvas(cssWidth: number, cssHeight: number, devicePixelRatio: number): CanvasPlan {
  assertSize(cssWidth, 'cssWidth');
  assertSize(cssHeight, 'cssHeight');
  const dpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);

  let scale = dpr;
  if (cssWidth * scale * (cssHeight * scale) > MAX_CANVAS_PIXELS) {
    scale = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  }
  if (cssWidth * scale > MAX_CANVAS_DIM) scale = MAX_CANVAS_DIM / cssWidth;
  if (cssHeight * scale > MAX_CANVAS_DIM) scale = MAX_CANVAS_DIM / cssHeight;

  return {
    width: Math.max(1, Math.floor(cssWidth * scale)),
    height: Math.max(1, Math.floor(cssHeight * scale)),
    outputScale: scale,
    capped: scale < dpr,
  };
}

/** Tope del lienzo base cuando la página usa lienzo de detalle (32 MiB, ADR-0025 enmienda). */
export const CAPPED_BASE_PIXELS = 8_388_608;

/**
 * Como `planCanvas`, pero si el plan sale capado reduce la escala para no pasar de `CAPPED_BASE_PIXELS`.
 * Lo usa el lienzo base de las páginas que llevan lienzo de detalle (ADR-0025 enmienda).
 */
export function planBaseCanvas(cssWidth: number, cssHeight: number, devicePixelRatio: number): CanvasPlan {
  const plan = planCanvas(cssWidth, cssHeight, devicePixelRatio);
  if (!plan.capped) return plan;
  const scale = Math.min(plan.outputScale, Math.sqrt(CAPPED_BASE_PIXELS / (cssWidth * cssHeight)));
  return {
    width: Math.max(1, Math.floor(cssWidth * scale)),
    height: Math.max(1, Math.floor(cssHeight * scale)),
    outputScale: scale,
    capped: true,
  };
}

function assertSize(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} no válido: ${value}`);
}
