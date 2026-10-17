import { RenderQueue } from '../core/render-queue';

/** Cola única de render de páginas: como mucho dos dibujos en curso a la vez. */
export const renderQueue = new RenderQueue(2);

/** Libera la memoria de un lienzo desmontado. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
