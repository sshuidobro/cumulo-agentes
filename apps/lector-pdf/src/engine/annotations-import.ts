import { importPageAnnotations, type ImportedPage } from '../core/annotations/import';
import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs';

/** Anotaciones de una página, importadas al modelo (o como ajenas). */
export async function readPageAnnotations(page: PDFPageProxy, fallbackDate: string): Promise<ImportedPage> {
  const raws = await page.getAnnotations({ intent: 'display' });
  return importPageAnnotations(page.pageNumber - 1, raws, fallbackDate);
}

/**
 * Recorre las páginas en orden por lotes y entrega sus anotaciones a `onBatch`.
 * Mismo patrón que `scanPageDims`: cede el hilo entre lotes. Devuelve `'cancelled'` si `signal` aborta.
 */
export async function scanAnnotations(doc: PDFDocumentProxy, opts: {
  readonly signal?: AbortSignal;
  readonly batchSize?: number;
  readonly fallbackDate: string;
  readonly onBatch: (pages: readonly ImportedPage[]) => void;
}): Promise<'done' | 'cancelled'> {
  const batchSize = opts.batchSize ?? 50;
  let batch: ImportedPage[] = [];

  for (let i = 0; i < doc.numPages; i++) {
    if (opts.signal?.aborted) return 'cancelled';
    const page = await doc.getPage(i + 1);
    batch.push(await readPageAnnotations(page, opts.fallbackDate));
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
