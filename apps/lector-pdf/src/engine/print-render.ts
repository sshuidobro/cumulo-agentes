import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';
import { printScale } from '../core/print/plan';

/** `AnnotationType.WIDGET` de pdf.js: campos de formulario, que se imprimen aunque no haya comentarios. */
const WIDGET_ANNOTATION_TYPE = 20;

/** Parte de la anotación que devuelve pdf.js y que usa este módulo. */
interface PrintableAnnotation {
  readonly id?: unknown;
  readonly annotationType?: unknown;
}

export interface PrintRenderOptions {
  readonly dpi: number;
  /** `false`: las anotaciones que no son campos de formulario no se imprimen. */
  readonly withComments: boolean;
  readonly signal: AbortSignal;
}

/**
 * Dibuja la página `index` (0-based) para imprimir y devuelve un PNG. Libera el lienzo antes de resolver.
 * Con `withComments: false` marca `noPrint` en el `annotationStorage` del documento y deshace esas marcas al terminar.
 * Devuelve `'cancelled'` si `signal` aborta antes o durante el dibujo; otros errores se relanzan.
 */
export async function renderPageForPrint(
  doc: PDFDocumentProxy,
  index: number,
  o: PrintRenderOptions,
): Promise<Blob | 'cancelled'> {
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

    return await canvasToPng(canvas);
  } finally {
    restoreStorage(doc, touched);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
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

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('el lienzo no se ha podido codificar como PNG'));
      else resolve(blob);
    }, 'image/png');
  });
}
