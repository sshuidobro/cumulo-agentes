import { createLogger } from '@suite/shared';
import { buildProperties, type DocumentProperties, type FileFacts, type PageSize, type RawProperties } from '../core/properties';
import { readPageDims } from './page-dims';
import type { PDFDocumentProxy } from './pdfjs';

export type { RawProperties } from '../core/properties';

const log = createLogger('properties');

/**
 * Lee `/Info`, el XMP y la marca de etiquetado. Nunca lanza: lo que no se puede leer queda vacío,
 * para que el diálogo muestre «—» en lugar de fallar.
 */
export async function readRawProperties(doc: PDFDocumentProxy): Promise<RawProperties> {
  let info: Record<string, unknown> = {};
  let xmpTitle: string | null = null;
  try {
    const meta = await doc.getMetadata();
    info = { ...meta.info };
    const xmp: unknown = meta.metadata?.get('dc:title');
    xmpTitle = typeof xmp === 'string' && xmp.trim() !== '' ? xmp : null;
  } catch (cause) {
    log.warn('getMetadata', cause);
  }

  let tagged: boolean | null = null;
  try {
    tagged = markedFlag(await doc.getMarkInfo());
  } catch (cause) {
    log.warn('getMarkInfo', cause);
  }

  return { info, xmpTitle, tagged };
}

/**
 * `/Marked` de `/MarkInfo`. pdf.js devuelve un `Map` (lo que llega del worker) y no un objeto:
 * se aceptan las dos formas. Sin `/MarkInfo` el resultado es `null`.
 */
function markedFlag(mark: unknown): boolean | null {
  if (mark instanceof Map) {
    const value: unknown = mark.get('Marked');
    return typeof value === 'boolean' ? value : null;
  }
  if (typeof mark === 'object' && mark !== null && 'Marked' in mark) {
    const value: unknown = mark.Marked;
    return typeof value === 'boolean' ? value : null;
  }
  return null;
}

/** Tamaño de la página `pageIndex` (0-based) con /Rotate aplicado. Si la página no se puede leer, 0 × 0. */
async function readPageSize(doc: PDFDocumentProxy, pageIndex: number): Promise<PageSize> {
  try {
    const dims = await readPageDims(await doc.getPage(pageIndex + 1));
    const quarterTurn = dims.rotation % 180 !== 0;
    return quarterTurn
      ? { widthPt: dims.height, heightPt: dims.width }
      : { widthPt: dims.width, heightPt: dims.height };
  } catch (cause) {
    log.warn('readPageSize', cause);
    return { widthPt: 0, heightPt: 0 };
  }
}

/**
 * Propiedades completas para el diálogo de PDF-045. El tamaño de página es el de `pageIndex`.
 * Nunca lanza.
 */
export async function readDocumentProperties(
  doc: PDFDocumentProxy,
  file: { readonly fileName: string; readonly path: string | null; readonly fileSize: number },
  pageIndex: number,
): Promise<DocumentProperties> {
  const [raw, pageSize] = await Promise.all([readRawProperties(doc), readPageSize(doc, pageIndex)]);
  const facts: FileFacts = {
    fileName: file.fileName,
    path: file.path,
    fileSize: file.fileSize,
    pageCount: doc.numPages,
    pageSize,
  };
  return buildProperties(raw, facts);
}
