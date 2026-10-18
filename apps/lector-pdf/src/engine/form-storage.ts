import type { PDFDocumentProxy } from './pdfjs';

/**
 * Pone (o quita, con `undefined`) el valor de un widget en `doc.annotationStorage` (clave = id de pdf.js).
 * El lienzo lo pinta con `AnnotationMode.ENABLE_STORAGE` (ADR-0019). Único punto que toca ese storage para widgets.
 */
export function setWidgetStorageValue(
  doc: PDFDocumentProxy,
  widgetId: string,
  value: string | boolean | readonly string[] | undefined,
): void {
  if (value === undefined) doc.annotationStorage.remove(widgetId);
  else doc.annotationStorage.setValue(widgetId, { value });
}
