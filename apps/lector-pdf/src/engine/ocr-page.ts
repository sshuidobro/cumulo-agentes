// Reconocimiento de una página escaneada (PDF-134). Dibujo y reconocimiento van fuera del hilo principal
// (documento y motor en Workers); aquí solo se coordina y se convierten las cajas al espacio de la página.
import type { OcrPage, OcrWord } from '../core/ocr/text-layer';
import type { PageRotation } from '../core/pdf/page-tree';
import { printScale } from '../core/print/plan';
import type { OcrEngine, OcrWordPx } from './ocr';
import type { PDFDocumentProxy } from './pdfjs';
import { renderPageImage } from './print-render';
import { createPageTextSource } from './search-source';

/** Resolución a la que se dibuja la página para reconocerla. */
export const OCR_DPI = 300;

/** Lo que de un viewport necesita la conversión: píxeles de la imagen → puntos de la página. */
interface PixelViewport {
  convertToPdfPoint(x: number, y: number): readonly number[];
}

/**
 * Reconoce la página `index` (0-based) de `doc` a `OCR_DPI`. Cada caja de píxeles se convierte a espacio de usuario
 * con el mismo viewport con el que se dibujó (dos esquinas, mínimos y máximos). `'cancelled'` si `signal` aborta.
 */
export async function recognizePage(
  doc: PDFDocumentProxy,
  index: number,
  engine: OcrEngine,
  signal: AbortSignal,
): Promise<OcrPage | 'cancelled'> {
  if (signal.aborted) return 'cancelled';
  const page = await doc.getPage(index + 1);
  let viewport: PixelViewport;
  let rotate: PageRotation;
  try {
    const base = page.getViewport({ scale: 1 });
    // Mismo cálculo que `renderPageImage` para la misma resolución: las coordenadas de píxel coinciden.
    viewport = page.getViewport({ scale: printScale(base.width, base.height, OCR_DPI) });
    rotate = toRotation(page.rotate);
  } finally {
    page.cleanup();
  }

  const image = await renderPageImage(doc, index, { dpi: OCR_DPI, withComments: false, signal, type: 'image/png' });
  if (image === 'cancelled' || signal.aborted) return 'cancelled';

  const words = await engine.recognize(image.blob, signal);
  if (words === 'cancelled' || signal.aborted) return 'cancelled';
  return { pageIndex: index, rotate, words: words.map((word) => toPdfWord(word, viewport)) };
}

/** `true` si la página tiene algún carácter no blanco en su capa de texto. */
export async function pageHasText(doc: PDFDocumentProxy, index: number): Promise<boolean> {
  const items = await createPageTextSource(doc).getPageItems(index, new AbortController().signal);
  return items.some((item) => item.str.trim() !== '');
}

function toPdfWord(word: OcrWordPx, viewport: PixelViewport): OcrWord {
  const { x0, y0, x1, y1 } = word.bbox;
  const [ax, ay] = pdfPoint(viewport, x0, y0);
  const [bx, by] = pdfPoint(viewport, x1, y1);
  return {
    text: word.text,
    box: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
  };
}

function pdfPoint(viewport: PixelViewport, x: number, y: number): readonly [number, number] {
  const [px, py] = viewport.convertToPdfPoint(x, y);
  if (px === undefined || py === undefined) throw new TypeError('convertToPdfPoint no devolvió un punto.');
  return [px, py];
}

function toRotation(value: number): PageRotation {
  if (value === 0 || value === 90 || value === 180 || value === 270) return value;
  throw new RangeError(`Rotación de página no válida para el OCR: ${String(value)}`);
}
