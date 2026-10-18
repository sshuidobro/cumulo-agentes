import { nextZoom, wheelZoom, type ZoomMode } from '../core/zoom';
import { normalizeRotation } from '../core/rotation';
import { useViewer, type ViewTool } from './viewer-store';

/** Pasos de rueda pendientes de aplicar en el próximo fotograma. */
interface WheelStep {
  readonly deltaY: number;
  readonly deltaMode: 0 | 1 | 2;
}

let pendingSteps: WheelStep[] = [];
let pendingFocusY: number = 0;
let wheelFrame: number | null = null;

/**
 * Cambia el modo de zoom. `focusY` (px desde el borde superior del visor) es el punto que no se mueve;
 * sin él, el centro del visor. El visor aplica el foco en el próximo cambio de layout.
 */
export function setZoomMode(mode: ZoomMode, focusY?: number): void {
  useViewer.setState({ zoomMode: mode, zoomFocusY: focusY ?? 'center' });
}

/** Siguiente paso de zoom hacia arriba, como zoom personalizado. */
export function zoomIn(focusY?: number): void {
  setZoomMode({ kind: 'custom', zoom: nextZoom(useViewer.getState().zoom, 1) }, focusY);
}

/** Siguiente paso de zoom hacia abajo, como zoom personalizado. */
export function zoomOut(focusY?: number): void {
  setZoomMode({ kind: 'custom', zoom: nextZoom(useViewer.getState().zoom, -1) }, focusY);
}

/**
 * Zoom con la rueda (Ctrl+rueda). Las ruedas del mismo fotograma se acumulan y se aplican
 * en un único cambio de zoom, en `requestAnimationFrame`.
 */
export function zoomWithWheel(deltaY: number, deltaMode: 0 | 1 | 2, focusY: number): void {
  pendingSteps.push({ deltaY, deltaMode });
  pendingFocusY = focusY;
  if (wheelFrame !== null) return;
  wheelFrame = requestAnimationFrame(flushWheel);
}

function flushWheel(): void {
  wheelFrame = null;
  let zoom = useViewer.getState().zoom;
  for (const step of pendingSteps) {
    zoom = wheelZoom(zoom, step.deltaY, step.deltaMode);
  }
  pendingSteps = [];
  setZoomMode({ kind: 'custom', zoom }, pendingFocusY);
}

/** Gira la vista 90° (`1` a la derecha, `-1` a la izquierda) respecto al centro del visor. */
export function rotateView(direction: 1 | -1): void {
  const rotation = normalizeRotation(useViewer.getState().rotation + 90 * direction);
  useViewer.setState({ rotation, zoomFocusY: 'center' });
}

/** Cambia la herramienta del puntero (seleccionar o mano). */
export function setViewTool(tool: ViewTool): void {
  useViewer.setState({ tool });
}
