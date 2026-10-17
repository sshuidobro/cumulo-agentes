// Único punto del proyecto que importa pdfjs-dist (ADR-0007). El resto del motor importa desde aquí.
export { getDocument, PDFDataRangeTransport, AnnotationMode, TextLayer, InvalidPDFException, PasswordException,
  PasswordResponses, RenderingCancelledException, OPS } from 'pdfjs-dist';
export type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask, PDFDocumentLoadingTask } from 'pdfjs-dist';
export type { TextContent, TextItem, TextMarkedContent, RefProxy } from 'pdfjs-dist/types/src/display/api';
