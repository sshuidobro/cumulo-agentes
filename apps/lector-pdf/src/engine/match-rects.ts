import type { RectPt } from '../core/annotations/model';
import type { SearchMatch } from '../core/search/find';
import type { PDFDocumentProxy, TextItem } from './pdfjs';
import { getPageTextContent } from './text';

/** Altura por encima de la línea base, en fracción del tamaño del ítem (PDF-137). */
const ASCENT = 0.8;
/** Altura por debajo de la línea base, en fracción del tamaño del ítem (PDF-137). */
const DESCENT = 0.25;
/** Margen que se añade a cada lado de la zona, en puntos. */
const PAD_PT = 1;

/**
 * Rectángulos (en espacio de usuario de la página) que cubren el texto de una coincidencia (PDF-137).
 *
 * Por cada ítem tocado se toma la parte proporcional de su ancho (`offset / str.length`), se sitúa con su
 * `transform` y se le da la altura de ascendente y descendente. Los índices de `match` son los de los ítems con
 * `str`, en el mismo orden que la búsqueda (ver `engine/search-source.ts`).
 */
export async function matchRects(doc: PDFDocumentProxy, match: SearchMatch): Promise<readonly RectPt[]> {
  const page = await doc.getPage(match.pageIndex + 1);
  const content = await getPageTextContent(page);
  const items = content.items.filter((item): item is TextItem => 'str' in item);
  const rects: RectPt[] = [];
  for (let k = match.start.item; k <= match.end.item; k++) {
    const item = items[k];
    if (item === undefined) continue;
    const length = item.str.length;
    if (length === 0) continue;
    const from = clamp(k === match.start.item ? match.start.offset : 0, 0, length);
    const to = clamp(k === match.end.item ? match.end.offset : length, 0, length);
    if (to <= from) continue;
    rects.push(rectForSpan(item, from / length, to / length));
  }
  return rects;
}

/** Rectángulo de la fracción `[f0, f1]` del ítem, con su orientación (`transform`) y su altura. */
function rectForSpan(item: TextItem, f0: number, f1: number): RectPt {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
  const along = Math.hypot(a, b) || 1;
  const ux = a / along;
  const uy = b / along;
  // Normal a la línea de texto: hacia arriba del glifo.
  const nx = -uy;
  const ny = ux;
  const height = item.height > 0 ? item.height : Math.hypot(c, d);
  const s0 = item.width * f0;
  const s1 = item.width * f1;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of [s0, s1]) {
    for (const v of [-DESCENT * height, ASCENT * height]) {
      xs.push(e + ux * s + nx * v);
      ys.push(f + uy * s + ny * v);
    }
  }
  return [
    Math.min(...xs) - PAD_PT,
    Math.min(...ys) - PAD_PT,
    Math.max(...xs) + PAD_PT,
    Math.max(...ys) + PAD_PT,
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
