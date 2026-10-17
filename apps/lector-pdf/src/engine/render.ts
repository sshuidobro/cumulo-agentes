import { AnnotationMode, RenderingCancelledException, type PDFPageProxy } from './pdfjs';
import type { Rotation } from '../core/rotation';

type RenderParams = Parameters<PDFPageProxy['render']>[0];

export interface RenderPageOptions {
  /** Escala CSS del visor (puntos PDF → píxeles CSS), ver `zoomToScale`. */
  readonly scale: number;
  /** Rotación absoluta del viewport: `(rotación de la página + rotación de la vista) % 360`. */
  readonly rotation: Rotation;
  /** Densidad del lienzo respecto a su tamaño CSS (ver `planCanvas`). 1 = sin escalar. */
  readonly outputScale: number;
  readonly signal: AbortSignal;
  readonly pageColors?: { readonly background: string; readonly foreground: string };
}

/**
 * Dibuja `page` en `canvas` con pdf.js. Las anotaciones del fichero se pintan (`ENABLE_STORAGE`).
 * Devuelve `'cancelled'` si `signal` aborta antes o durante el dibujo; otros errores se relanzan.
 */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  o: RenderPageOptions,
): Promise<'done' | 'cancelled'> {
  if (o.signal.aborted) return 'cancelled';

  const viewport = page.getViewport({ scale: o.scale, rotation: o.rotation });
  const params: RenderParams = {
    canvas,
    viewport,
    annotationMode: AnnotationMode.ENABLE_STORAGE,
    ...(o.outputScale !== 1 ? { transform: [o.outputScale, 0, 0, o.outputScale, 0, 0] } : {}),
    ...(o.pageColors !== undefined ? { pageColors: o.pageColors } : {}),
  };

  const task = page.render(params);
  const onAbort = (): void => {
    task.cancel();
  };
  o.signal.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
    return 'done';
  } catch (error: unknown) {
    if (error instanceof RenderingCancelledException) return 'cancelled';
    throw error;
  } finally {
    o.signal.removeEventListener('abort', onAbort);
  }
}
