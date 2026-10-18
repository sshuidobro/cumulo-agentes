import type { RectPt } from '../../core/annotations/model';
import type { TextLayerHandle } from '../../engine/text';
import * as registry from './text-layer-registry';

/**
 * Rectángulos de una selección del navegador, por página y en puntos PDF (PDF-032).
 *
 * Solo cuentan los nodos de texto que están dentro del contenedor de una capa de texto registrada: el número de
 * página, los marcos y los demás elementos de la página no son texto del PDF y se ignoran. Cada nodo se recorta a
 * los extremos del rango y se piden sus `getClientRects`, así que nunca aparecen las cajas de contenedores que el
 * rango contiene por completo. Los fragmentos que caen fuera de la caja de su capa, y los de área nula, se descartan.
 * Los rectángulos salen normalizados (x1 <= x2, y1 <= y2).
 */
export function selectionPageRects(sel: Selection): Map<number, RectPt[]> {
  const pages = new Map<number, RectPt[]>();
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    for (const node of textNodesIn(range.commonAncestorContainer)) {
      const layer = layerOf(node);
      if (layer === undefined || !range.intersectsNode(node)) continue;
      const [pageIndex, handle] = layer;
      for (const rect of pieceRects(range, node)) {
        if (rect.width <= 0 || rect.height <= 0 || !centerInside(rect, handle)) continue;
        const list = pages.get(pageIndex) ?? [];
        list.push(toPdfRect(handle, rect));
        pages.set(pageIndex, list);
      }
    }
  }
  return pages;
}

/** Fragmentos de línea del nodo de texto, con el rango recortado a sus extremos. */
function pieceRects(range: Range, node: Text): DOMRect[] {
  const piece = node.ownerDocument.createRange();
  piece.selectNodeContents(node);
  if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0) {
    piece.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0) {
    piece.setEnd(range.endContainer, range.endOffset);
  }
  return Array.from(piece.getClientRects());
}

/** Nodos de texto descendientes de `root` (o el propio `root` si es un nodo de texto), en orden de documento. */
function textNodesIn(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker?.nextNode(); node !== null && node !== undefined; node = walker?.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

/** Capa de texto registrada cuyo contenedor contiene el nodo, o `undefined` si está fuera de todas. */
function layerOf(node: Node): readonly [number, TextLayerHandle] | undefined {
  for (const [pageIndex, handle] of registry.all()) {
    if (handle.container.contains(node)) return [pageIndex, handle];
  }
  return undefined;
}

/** `true` si el centro del rectángulo (coordenadas de ventana) cae dentro de la caja de la capa. */
function centerInside(rect: DOMRect, handle: TextLayerHandle): boolean {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const box = handle.container.getBoundingClientRect();
  return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
}

/** Pasa un rectángulo de ventana a puntos PDF con el viewport de la capa. */
function toPdfRect(handle: TextLayerHandle, rect: DOMRect): RectPt {
  const box = handle.container.getBoundingClientRect();
  const viewport = handle.viewport;
  const [ax = 0, ay = 0] = viewport.convertToPdfPoint(rect.left - box.left, rect.top - box.top);
  const [bx = 0, by = 0] = viewport.convertToPdfPoint(rect.right - box.left, rect.bottom - box.top);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
