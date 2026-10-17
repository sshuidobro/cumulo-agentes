import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs';

export interface PageDimsEntry {
  readonly index: number;
  /** Ancho sin rotar, en puntos PDF. */
  readonly width: number;
  /** Alto sin rotar, en puntos PDF. */
  readonly height: number;
  /** Rotación declarada de la página (`/Rotate`). */
  readonly rotation: number;
}

/** Tamaño real de una página (sin escala ni rotación de la vista). */
export async function readPageDims(page: PDFPageProxy): Promise<PageDimsEntry> {
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  return {
    index: page.pageNumber - 1,
    width: viewport.width,
    height: viewport.height,
    rotation: page.rotate,
  };
}

/**
 * Recorre las páginas en orden por lotes y entrega sus dimensiones a `onBatch`.
 * Cede el hilo entre lotes para no bloquear la interfaz. Devuelve `'cancelled'` si `signal` aborta.
 */
export async function scanPageDims(doc: PDFDocumentProxy, opts: {
  readonly from?: number;
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  readonly onBatch: (entries: readonly PageDimsEntry[]) => void;
}): Promise<'done' | 'cancelled'> {
  const from = opts.from ?? 0;
  const batchSize = opts.batchSize ?? 50;
  let batch: PageDimsEntry[] = [];

  for (let i = from; i < doc.numPages; i++) {
    if (opts.signal?.aborted) return 'cancelled';
    const page = await doc.getPage(i + 1);
    batch.push(await readPageDims(page));
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
