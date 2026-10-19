import { importPageAnnotations, type ImportedPage } from '../core/annotations/import';
import { promoteShapes, SHAPE_SUBTYPES } from '../core/annotations/import-shapes';
import { readStampNames, withStampNames } from '../core/annotations/stamp-names';
import type { ObjectReader } from '../core/pdf/object-reader';
import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs';

/**
 * Anotaciones de una página, importadas al modelo (o como ajenas). Con `reader`, las formas y sellos ajenos que
 * encajan pasan a editables (PDF-107) y los `/Stamp` que siguen ajenos llevan su `/Name` (PDF-103): solo se lee el
 * diccionario de formas y sellos, nunca el resto de anotaciones.
 */
export async function readPageAnnotations(
  page: PDFPageProxy,
  fallbackDate: string,
  reader: ObjectReader | null = null,
): Promise<ImportedPage> {
  const raws = await page.getAnnotations({ intent: 'display' });
  const imported = importPageAnnotations(page.pageNumber - 1, raws, fallbackDate);
  if (reader === null) return imported;
  const shapes = imported.foreign.some((a) => SHAPE_SUBTYPES.has(a.subtype))
    ? await promoteShapes(reader, imported, fallbackDate)
    : imported;
  if (!shapes.foreign.some((a) => a.subtype === 'Stamp')) return shapes;
  return withStampNames(shapes, await readStampNames(reader, shapes.foreign));
}

/**
 * Recorre las páginas en orden por lotes y entrega sus anotaciones a `onBatch`.
 * Mismo patrón que `scanPageDims`: cede el hilo entre lotes. Devuelve `'cancelled'` si `signal` aborta.
 */
export async function scanAnnotations(doc: PDFDocumentProxy, opts: {
  /** Primera página a importar (0-based, por defecto 0). */
  readonly from?: number;
  readonly signal?: AbortSignal;
  readonly batchSize?: number;
  readonly fallbackDate: string;
  readonly onBatch: (pages: readonly ImportedPage[]) => void;
  readonly reader?: ObjectReader | null;
}): Promise<'done' | 'cancelled'> {
  const batchSize = opts.batchSize ?? 50;
  let batch: ImportedPage[] = [];

  for (let i = opts.from ?? 0; i < doc.numPages; i++) {
    if (opts.signal?.aborted) return 'cancelled';
    const page = await doc.getPage(i + 1);
    batch.push(await readPageAnnotations(page, opts.fallbackDate, opts.reader ?? null));
    if (batch.length >= batchSize) {
      const full = batch;
      batch = [];
      opts.onBatch(full);
      await yieldToEventLoop();
    }
  }

  if (batch.length > 0) opts.onBatch(batch);
  return 'done';
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}
