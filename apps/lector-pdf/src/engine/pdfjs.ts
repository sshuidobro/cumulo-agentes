// Único punto del proyecto que importa pdfjs-dist (ADR-0007). El resto del motor importa desde aquí.
// Build legacy por ADR-0013 (polyfills para Chromium/webviews sin Map.getOrInsertComputed).
export { getDocument, PDFDataRangeTransport, AnnotationMode, TextLayer, InvalidPDFException, PasswordException,
  PasswordResponses, RenderingCancelledException, OPS, normalizeUnicode } from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask, PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { TextContent, TextItem, TextMarkedContent, RefProxy } from 'pdfjs-dist/types/src/display/api';
