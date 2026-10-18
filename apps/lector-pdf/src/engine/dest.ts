import { destZoomMode, parseExplicitDest, type ParsedDest } from '../core/dest';
import type { PdfDest } from '../core/links';
import type { ZoomMode } from '../core/zoom';
import type { PDFDocumentProxy } from './pdfjs';

/** Destino resuelto a una página del documento y a una posición dentro de ella (fracciones de la página en [0, 1]). */
export interface ResolvedDest {
  readonly pageIndex: number;
  /** Fracción desde el borde superior de la página, o null si el destino no fija la vertical. */
  readonly yFraction: number | null;
  /** Fracción desde el borde izquierdo de la página, o null si el destino no fija la horizontal. */
  readonly xFraction: number | null;
  /** Zoom que pide el destino, o null si no lo cambia. */
  readonly zoom: ZoomMode | null;
}

/**
 * Resuelve un destino del PDF: nombrado (`getDestination`), explícito con referencia a página (`getPageIndex`)
 * o con índice entero. Las coordenadas en puntos se pasan a fracciones de la página con su rotación propia.
 * Cualquier fallo (destino inexistente, página fuera de rango) devuelve `null`.
 */
export async function resolveDest(doc: PDFDocumentProxy, dest: PdfDest): Promise<ResolvedDest | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const parsed = parseExplicitDest(explicit);
    if (parsed === null) return null;
    const pageIndex = await pageIndexOf(doc, parsed.pageRef);
    if (pageIndex === null || pageIndex < 0 || pageIndex >= doc.numPages) return null;

    const { xFraction, yFraction } = await fractionsOf(doc, pageIndex, parsed);
    return { pageIndex, yFraction, xFraction, zoom: destZoomMode(parsed) };
  } catch {
    return null;
  }
}

async function pageIndexOf(doc: PDFDocumentProxy, pageRef: unknown): Promise<number | null> {
  if (typeof pageRef === 'number') return Number.isInteger(pageRef) ? pageRef : null;
  if (typeof pageRef === 'object' && pageRef !== null && 'num' in pageRef && 'gen' in pageRef) {
    return doc.getPageIndex({ num: Number(pageRef.num), gen: Number(pageRef.gen) });
  }
  return null;
}

/**
 * Pasa las coordenadas del destino (puntos, origen abajo-izquierda) a fracciones de la página ya rotada.
 * Una coordenada que el destino no fija da null (el llamante decide el valor por defecto).
 */
async function fractionsOf(
  doc: PDFDocumentProxy,
  pageIndex: number,
  parsed: ParsedDest,
): Promise<{ xFraction: number | null; yFraction: number | null }> {
  if (parsed.left === null && parsed.top === null) return { xFraction: null, yFraction: null };
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const point = viewport.convertToViewportPoint(parsed.left ?? 0, parsed.top ?? 0) as readonly number[];
  const [x = 0, y = 0] = point;
  return {
    xFraction: parsed.left === null || viewport.width <= 0 ? null : clamp01(x / viewport.width),
    yFraction: parsed.top === null || viewport.height <= 0 ? null : clamp01(y / viewport.height),
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
