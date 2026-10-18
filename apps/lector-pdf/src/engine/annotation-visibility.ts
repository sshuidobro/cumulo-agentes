import type { PdfObjRef } from '../core/annotations/model';
import type { PDFDocumentProxy } from './pdfjs';

/**
 * Clave de `annotationStorage` de pdf.js para una anotación del fichero: `<num>R`, o `<num>R<gen>` si la
 * generación es mayor que 0.
 */
export function annotationStorageKey(ref: PdfObjRef): string {
  return ref.gen === 0 ? `${ref.num}R` : `${ref.num}R${ref.gen}`;
}

/**
 * Oculta (o vuelve a mostrar) en el lienzo una anotación del fichero que se ha editado o borrado. Las
 * dibuja la capa de anotaciones (PDF-031). Requiere renderizar con `AnnotationMode.ENABLE_STORAGE`.
 */
export function setFileAnnotationHidden(doc: PDFDocumentProxy, ref: PdfObjRef, hidden: boolean): void {
  const key = annotationStorageKey(ref);
  if (hidden) doc.annotationStorage.setValue(key, { noView: true });
  else doc.annotationStorage.remove(key);
}
