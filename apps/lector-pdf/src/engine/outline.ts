import { createLogger } from '@suite/shared';
import { toOutlineNodes, type OutlineNode } from '../core/outline';
import type { PDFDocumentProxy } from './pdfjs';

const log = createLogger('outline');

/**
 * Índice del documento (PDF-016). Nunca lanza: un fallo de lectura se registra y el índice queda vacío,
 * para que el panel muestre «no tiene marcadores» en lugar de romperse.
 */
export async function getOutline(doc: PDFDocumentProxy): Promise<readonly OutlineNode[]> {
  try {
    return toOutlineNodes(await doc.getOutline());
  } catch (cause) {
    log.warn('getOutline', cause);
    return [];
  }
}
