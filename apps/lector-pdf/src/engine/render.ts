import { createLogger } from '@suite/shared';
import { AnnotationMode, RenderingCancelledException, type PDFPageProxy, type PageViewport } from './pdfjs';
import type { Rotation } from '../core/rotation';
import { applyNightMode, imageRects, multiply, type NightColors } from '../core/night';
import { asMatrix, toPaintSteps, type OperatorListLike } from './night-ops';

type RenderParams = Parameters<PDFPageProxy['render']>[0];

const log = createLogger('render');

export interface RenderPageOptions {
  /** Escala CSS del visor (puntos PDF → píxeles CSS), ver `zoomToScale`. */
  readonly scale: number;
  /** Rotación absoluta del viewport: `(rotación de la página + rotación de la vista) % 360`. */
  readonly rotation: Rotation;
  /** Densidad del lienzo respecto a su tamaño CSS (ver `planCanvas`). 1 = sin escalar. */
  readonly outputScale: number;
  readonly signal: AbortSignal;
  /** Modo noche (ADR-0015): si se pasa, los píxeles del lienzo se transforman con estos colores, salvo las imágenes. */
  readonly night?: NightColors;
}

/**
 * Dibuja `page` en `canvas` con pdf.js. Las anotaciones del fichero se pintan (`ENABLE_STORAGE`).
 * Con `night`, tras el dibujo se aplica el modo noche sobre los píxeles del lienzo.
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
  };

  // La lista de operadores se pide antes del dibujo para que pdf.js la analice en paralelo.
  const opsPromise = o.night
    ? page
        .getOperatorList({ intent: 'display', annotationMode: AnnotationMode.ENABLE_STORAGE })
        .catch(() => null)
    : null;

  const task = page.render(params);
  const onAbort = (): void => {
    task.cancel();
  };
  o.signal.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
    if (opsPromise !== null && o.night !== undefined) {
      const list = await opsPromise;
      if (o.signal.aborted) return 'cancelled';
      if (list === null) {
        log.warn('no se ha podido aplicar el modo noche', { error: 'sin lista de operadores' });
      } else {
        applyNightToCanvas(canvas, viewport, list, o.outputScale, o.night);
      }
    }
    return 'done';
  } catch (error: unknown) {
    if (error instanceof RenderingCancelledException) return 'cancelled';
    throw error;
  } finally {
    o.signal.removeEventListener('abort', onAbort);
  }
}

/** Transforma el lienzo ya dibujado al modo noche; las imágenes de la página se conservan. */
function applyNightToCanvas(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  list: OperatorListLike,
  outputScale: number,
  night: NightColors,
): void {
  const vt = asMatrix(viewport.transform);
  if (vt === null) throw new Error('viewport sin matriz'); // bug
  const base = multiply([outputScale, 0, 0, outputScale, 0, 0], vt);
  const rects = imageRects(toPaintSteps(list), base, canvas.width, canvas.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('lienzo sin contexto 2d'); // bug
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyNightMode(img.data, canvas.width, canvas.height, rects, night);
  ctx.putImageData(img, 0, 0);
}
