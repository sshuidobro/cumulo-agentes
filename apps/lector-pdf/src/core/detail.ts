import { planCanvas, type CanvasPlan } from './canvas-size';

export interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PxSize {
  readonly width: number;
  readonly height: number;
}

/** Margen añadido a cada lado de la zona visible, como fracción de su tamaño. */
export const DETAIL_MARGIN = 0.25;

/**
 * Zona del marco de página (px CSS, origen arriba-izquierda del marco) visible en el visor; null si no se ve.
 * `frame` y `viewport` deben estar en las mismas coordenadas. Un rectángulo de tamaño 0 no lanza: no se ve nada.
 */
export function visibleInFrame(frame: PxRect, viewport: PxRect): PxRect | null {
  assertRect(frame, 'frame');
  assertRect(viewport, 'viewport');
  const left = Math.max(frame.x, viewport.x);
  const top = Math.max(frame.y, viewport.y);
  const right = Math.min(frame.x + frame.width, viewport.x + viewport.width);
  const bottom = Math.min(frame.y + frame.height, viewport.y + viewport.height);
  if (right <= left || bottom <= top) return null;
  return { x: left - frame.x, y: top - frame.y, width: right - left, height: bottom - top };
}

/**
 * Zona a dibujar en detalle: `visible` ampliada DETAIL_MARGIN por lado, recortada al marco y redondeada hacia fuera
 * a píxeles enteros.
 */
export function detailRect(frameSize: PxSize, visible: PxRect): PxRect {
  assertSize(frameSize, 'frameSize');
  assertRect(visible, 'visible');
  const marginX = visible.width * DETAIL_MARGIN;
  const marginY = visible.height * DETAIL_MARGIN;
  const left = clamp(visible.x - marginX, 0, frameSize.width);
  const top = clamp(visible.y - marginY, 0, frameSize.height);
  const right = clamp(visible.x + visible.width + marginX, 0, frameSize.width);
  const bottom = clamp(visible.y + visible.height + marginY, 0, frameSize.height);
  const x = Math.floor(left);
  const y = Math.floor(top);
  return { x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
}

/**
 * Plan completo de la zona de detalle. Devuelve null si el lienzo base no está limitado
 * (`base.capped === false`) o si la página no se ve en el visor.
 * `frame` y `viewport` en las mismas coordenadas (px de contenido del visor).
 */
export function planDetail(
  base: CanvasPlan,
  frame: PxRect,
  viewport: PxRect,
  devicePixelRatio: number,
): { readonly rect: PxRect; readonly canvas: CanvasPlan } | null {
  if (!base.capped) return null;
  const visible = visibleInFrame(frame, viewport);
  if (visible === null) return null;
  const rect = detailRect({ width: frame.width, height: frame.height }, visible);
  const canvas = planCanvas(rect.width, rect.height, devicePixelRatio);
  return { rect, canvas };
}

/** `true` si `visible` no está contenida por completo en `drawn` (hay que redibujar). */
export function needsRedraw(drawn: PxRect, visible: PxRect): boolean {
  assertRect(drawn, 'drawn');
  assertRect(visible, 'visible');
  const contained =
    drawn.x <= visible.x &&
    drawn.y <= visible.y &&
    drawn.x + drawn.width >= visible.x + visible.width &&
    drawn.y + drawn.height >= visible.y + visible.height;
  return !contained;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertRect(rect: PxRect, name: string): void {
  assertFiniteValue(rect.x, `${name}.x`);
  assertFiniteValue(rect.y, `${name}.y`);
  assertSize(rect, name);
}

function assertSize(size: PxSize, name: string): void {
  assertFiniteValue(size.width, `${name}.width`);
  assertFiniteValue(size.height, `${name}.height`);
  if (size.width < 0 || size.height < 0) {
    throw new RangeError(`${name} con tamaño negativo: ${size.width} × ${size.height}`);
  }
}

function assertFiniteValue(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} no es finito: ${value}`);
}
