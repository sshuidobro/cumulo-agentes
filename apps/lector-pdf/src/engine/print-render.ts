import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';
import { printScale } from '../core/print/plan';

/** `AnnotationType.WIDGET` de pdf.js: campos de formulario, que se imprimen aunque no haya comentarios. */
const WIDGET_ANNOTATION_TYPE = 20;

/** Parte de la anotación que devuelve pdf.js y que usa este módulo. */
interface PrintableAnnotation {
  readonly id?: unknown;
  readonly annotationType?: unknown;
}

export interface PageImageOptions {
  readonly dpi: number;
  /** `false`: las anotaciones que no son campos de formulario no se imprimen. */
  readonly withComments: boolean;
  readonly signal: AbortSignal;
  readonly type: 'image/png' | 'image/jpeg';
  /** Solo JPEG; por defecto 0.92. */
  readonly quality?: number;
}

export interface PageImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  /** dpi real (menor que el pedido si `printScale` recortó la escala). */
  readonly dpi: number;
}

export type PrintRenderOptions = Pick<PageImageOptions, 'dpi' | 'withComments' | 'signal'>;

const DEFAULT_JPEG_QUALITY = 0.92;

/**
 * Dibuja la página `index` (0-based) y la codifica como PNG o JPEG. Libera el lienzo antes de resolver.
 * Con `withComments: false` marca `noPrint` en el `annotationStorage` del documento y deshace esas marcas al terminar.
 * JPEG no tiene transparencia: el lienzo se rellena de blanco antes de dibujar.
 * Devuelve `'cancelled'` si `signal` aborta antes o durante el dibujo; otros errores se relanzan.
 */
export async function renderPageImage(
  doc: PDFDocumentProxy,
  index: number,
  o: PageImageOptions,
): Promise<PageImage | 'cancelled'> {
  if (o.signal.aborted) return 'cancelled';
  const page = await doc.getPage(index + 1);
  const canvas = document.createElement('canvas');
  const touched = new Map<string, { readonly had: boolean; readonly previous: object | undefined }>();
  try {
    if (!o.withComments) await hideComments(doc, page, touched);

    const viewport = page.getViewport({ scale: 1 });
    const scale = printScale(viewport.width, viewport.height, o.dpi);
    const pageViewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(pageViewport.width));
    canvas.height = Math.max(1, Math.floor(pageViewport.height));

    // Una cancelación llegada mientras se preparaba la página no tiene tarea a la que avisar.
    if (o.signal.aborted) return 'cancelled';
    if (o.type === 'image/jpeg') {
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('el lienzo no da contexto 2D');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const task = page.render({
      intent: 'print',
      annotationMode: pdfjs().AnnotationMode.ENABLE_STORAGE,
      canvas,
      viewport: pageViewport,
    });
    const onAbort = (): void => {
      task.cancel();
    };
    o.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } catch (error: unknown) {
      if (error instanceof pdfjs().RenderingCancelledException || o.signal.aborted) return 'cancelled';
      throw error;
    } finally {
      o.signal.removeEventListener('abort', onAbort);
    }
    if (o.signal.aborted) return 'cancelled';

    const blob = await canvasToBlob(canvas, o.type, o.quality ?? DEFAULT_JPEG_QUALITY);
    return { blob, width: canvas.width, height: canvas.height, dpi: Math.round(scale * 72) };
  } finally {
    restoreStorage(doc, touched);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/** Imprimir: la página como PNG. Ver `renderPageImage`. */
export async function renderPageForPrint(
  doc: PDFDocumentProxy,
  index: number,
  o: PrintRenderOptions,
): Promise<Blob | 'cancelled'> {
  const image = await renderPageImage(doc, index, { ...o, type: 'image/png' });
  return image === 'cancelled' ? 'cancelled' : image.blob;
}

/** Marca `noPrint` en cada anotación de la página que no sea un campo de formulario. Guarda lo que había antes. */
async function hideComments(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  touched: Map<string, { readonly had: boolean; readonly previous: object | undefined }>,
): Promise<void> {
  const annotations: readonly PrintableAnnotation[] = await page.getAnnotations({ intent: 'print' });
  const storage = doc.annotationStorage;
  for (const annotation of annotations) {
    if (annotation.annotationType === WIDGET_ANNOTATION_TYPE || typeof annotation.id !== 'string') continue;
    const id = annotation.id;
    if (touched.has(id)) continue;
    const had = storage.has(id);
    touched.set(id, { had, previous: had ? storage.getRawValue(id) : undefined });
    storage.setValue(id, { noPrint: true });
  }
}

/** Deshace las marcas de `hideComments`: restaura el valor previo o borra la clave. */
function restoreStorage(
  doc: PDFDocumentProxy,
  touched: ReadonlyMap<string, { readonly had: boolean; readonly previous: object | undefined }>,
): void {
  const storage = doc.annotationStorage;
  for (const [id, entry] of touched) {
    if (entry.had && entry.previous !== undefined) storage.setValue(id, entry.previous);
    else storage.remove(id);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const callback = (blob: Blob | null): void => {
      if (blob === null) reject(new Error(`el lienzo no se ha podido codificar como ${type}`));
      else resolve(blob);
    };
    if (type === 'image/jpeg') canvas.toBlob(callback, type, quality);
    else canvas.toBlob(callback, type);
  });
}
