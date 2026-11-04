import { paragraphText, type LayoutItem } from '../../core/text/paragraphs';
import { normalizeUnicode } from '../../engine/text';

const TEXT_SPANS = 'span:not(.markedContent)';

/** Parte de `span` dentro del rango, con su posición dentro de la capa (sin rotar: `offset*` ignora las transformaciones). */
function selectedItem(span: HTMLElement, range: Range): LayoutItem | null {
  if (!range.intersectsNode(span)) return null;
  const full = span.textContent;
  const start = span.contains(range.startContainer) && range.startContainer.nodeType === Node.TEXT_NODE ? range.startOffset : 0;
  const end = span.contains(range.endContainer) && range.endContainer.nodeType === Node.TEXT_NODE ? range.endOffset : full.length;
  const text = full.slice(start, end);
  if (text === '') return null;
  const scaleX = Number.parseFloat(span.style.getPropertyValue('--scale-x')) || 1;
  const degrees = Number.parseFloat(span.style.getPropertyValue('--rotate')) || 0;
  return {
    text,
    x: span.offsetLeft,
    y: span.offsetTop + span.offsetHeight,
    width: span.offsetWidth * scaleX,
    size: span.offsetHeight,
    rotation: (degrees * Math.PI) / 180,
  };
}

/** Texto seleccionado en `layer`, por párrafos; `null` si la capa no está maquetada y no hay posiciones que usar. */
function layerText(layer: Element, range: Range): string | null {
  const items = Array.from(layer.querySelectorAll<HTMLElement>(TEXT_SPANS)).flatMap((span) => selectedItem(span, range) ?? []);
  if (items.length > 0 && items.every((item) => item.size === 0)) return null;
  return paragraphText(items);
}

/**
 * Texto de la selección para el portapapeles: por párrafos y en orden de lectura si está sobre capas de texto, con
 * la normalización Unicode de pdf.js (ligaduras) y sin caracteres nulos.
 */
export function selectionText(selection: Selection): string {
  const pages: string[] = [];
  let fallback = selection.rangeCount === 0;
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const layer of document.querySelectorAll('.textLayer')) {
      if (!range.intersectsNode(layer)) continue;
      const text = layerText(layer, range);
      if (text === null) fallback = true;
      else if (text !== '') pages.push(text);
    }
  }
  const text = fallback || pages.length === 0 ? selection.toString() : pages.join('\n\n');
  return normalizeUnicode(text).replace(/\0/g, '');
}
