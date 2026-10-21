import type { RectPt } from '../core/annotations/model';
import { pdfjs, type PDFDocumentProxy } from './pdfjs';

/** Resolución a la que se rasteriza una página redactada: 300 ppp (PDF-137). */
const RENDER_SCALE = 300 / 72;
const PAGE_JPEG_QUALITY = 0.9;
const IMAGE_JPEG_QUALITY = 0.92;

/**
 * Dibuja la página `index` (0-based) sin girar, sin anotaciones, y pinta de negro las zonas `areas` (en espacio de
 * usuario). Devuelve el JPEG de la página, o `'cancelled'` si `signal` aborta.
 */
export async function renderRedactedPage(
  doc: PDFDocumentProxy,
  index: number,
  areas: readonly RectPt[],
  signal: AbortSignal,
): Promise<Uint8Array | 'cancelled'> {
  if (signal.aborted) return 'cancelled';
  const page = await doc.getPage(index + 1);
  const canvas = document.createElement('canvas');
  try {
    const viewport = page.getViewport({ scale: RENDER_SCALE, rotation: 0 });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('el lienzo no da contexto 2D');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (signal.aborted) return 'cancelled';

    const task = page.render({
      annotationMode: pdfjs().AnnotationMode.DISABLE,
      canvas,
      viewport,
    });
    const onAbort = (): void => {
      task.cancel();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } catch (error: unknown) {
      if (error instanceof pdfjs().RenderingCancelledException || signal.aborted) return 'cancelled';
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) return 'cancelled';

    context.fillStyle = '#000000';
    for (const [x0, y0, x1, y1] of areas) {
      const [ax = 0, ay = 0] = viewport.convertToViewportPoint(x0, y0);
      const [bx = 0, by = 0] = viewport.convertToViewportPoint(x1, y1);
      context.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    }
    return await canvasToJpeg(canvas, PAGE_JPEG_QUALITY);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/**
 * Pinta de negro los rectángulos `pixelRects` (en píxeles de la imagen, origen arriba-izquierda, `[x0, y0, x1, y1)`)
 * de un JPEG, y devuelve el JPEG resultante con el mismo tamaño (PDF-137).
 */
export async function paintJpeg(bytes: Uint8Array, pixelRects: readonly RectPt[]): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), {
    imageOrientation: 'none',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('el lienzo no da contexto 2D');
    context.drawImage(bitmap, 0, 0);
    context.fillStyle = '#000000';
    for (const [x0, y0, x1, y1] of pixelRects) {
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const out = await canvasToJpeg(canvas, IMAGE_JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } finally {
    bitmap.close();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('el lienzo no se ha podido codificar como image/jpeg'));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => {
            resolve(new Uint8Array(buffer));
          }, reject);
      },
      'image/jpeg',
      quality,
    );
  });
}
