// Único punto del proyecto que importa pdfjs-dist (ADR-0007). El resto del motor importa desde aquí.
// Build legacy por ADR-0013 (polyfills para Chromium/webviews sin Map.getOrInsertComputed).
export type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask, PDFDocumentLoadingTask, PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { TextContent, TextItem, TextMarkedContent, RefProxy } from 'pdfjs-dist/types/src/display/api';

import type * as PdfjsNamespace from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfjsModule = typeof PdfjsNamespace;

let loaded: PdfjsModule | null = null;
let pending: Promise<PdfjsModule> | null = null;
let workerSrc: string | null = null;

/** URL del worker de pdf.js (solo en el navegador, desde `worker.ts`). Se aplica al cargar o al momento si ya está cargado. */
export function setPdfjsWorkerSrc(url: string): void {
  workerSrc = url;
  if (loaded !== null) loaded.GlobalWorkerOptions.workerSrc = url;
}

/** Carga pdf.js una sola vez (chunk diferido). Si la carga falla, la siguiente llamada lo reintenta. */
export function loadPdfjs(): Promise<PdfjsModule> {
  pending ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (mod) => {
      if (workerSrc !== null) mod.GlobalWorkerOptions.workerSrc = workerSrc;
      loaded = mod;
      return mod;
    },
    (cause: unknown) => {
      pending = null;
      throw cause;
    },
  );
  return pending;
}

/** pdf.js ya cargado. Solo se llama con un documento abierto (tras `loadPdf`); antes es un bug y lanza. */
export function pdfjs(): PdfjsModule {
  if (loaded === null) throw new Error('pdf.js no está cargado: llama antes a loadPdfjs()');
  return loaded;
}
