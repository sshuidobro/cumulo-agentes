import type { PageTextSource } from '../core/search/session';
import type { PDFDocumentProxy } from './pdfjs';
import { getPageTextContent } from './text';

/** Fuente de texto para la búsqueda: ítems con `str` de pdf.js, en el mismo orden que `TextLayer.textDivs`. */
export function createPageTextSource(doc: PDFDocumentProxy): PageTextSource {
  return {
    async getPageItems(pageIndex, signal) {
      if (signal.aborted) throw new DOMException('Búsqueda cancelada.', 'AbortError');
      const page = await doc.getPage(pageIndex + 1);
      const content = await getPageTextContent(page);
      // Se conserva el ítem con su posición: la exportación a TXT la usa para deducir los párrafos.
      return content.items.filter((item) => 'str' in item);
    },
  };
}
