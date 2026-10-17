import type { PDFPageProxy, TextContent } from './pdfjs';

/**
 * Parámetros de texto fijos para toda la app (PDF-013). La búsqueda (PDF-017) usa los mismos,
 * así los índices de los ítems coinciden con los de `TextLayer.textDivs`.
 */
export const TEXT_CONTENT_PARAMS = { includeMarkedContent: true, disableNormalization: true } as const;

/** Texto de una página con los parámetros fijos de la app. */
export function getPageTextContent(page: PDFPageProxy): Promise<TextContent> {
  return page.getTextContent(TEXT_CONTENT_PARAMS);
}
