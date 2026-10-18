import { rectsToLineQuads } from '../core/annotations/line-quads';
import { rectFromQuads, type TextMarkupAnnotation } from '../core/annotations/model';
import { selectionPageRects } from '../ui/viewer/selection-to-pages';
import { addAnnotations, newAnnotationId, nowIso } from './annotation-actions';
import { useAnnotations } from './annotation-store';

/** Tipos de marcado de texto (PDF-032). */
export type MarkupType = 'highlight' | 'underline' | 'strikeout';

/** Nombre de la entrada de deshacer de cada marcado. */
const LABEL: Readonly<Record<MarkupType, string>> = {
  highlight: 'resaltar',
  underline: 'subrayar',
  strikeout: 'tachar',
};

/**
 * Marca la selección del navegador con un anotación por página (una sola entrada de deshacer) y vacía la
 * selección. Devuelve cuántas anotaciones ha creado: 0 si la selección no tenía texto de ninguna capa.
 */
export function markupSelection(type: MarkupType, sel: Selection): number {
  const pages = selectionPageRects(sel);
  sel.removeAllRanges();

  const { colors, author } = useAnnotations.getState();
  const now = nowIso();
  const list: TextMarkupAnnotation[] = [];
  for (const pageIndex of [...pages.keys()].sort((a, b) => a - b)) {
    const quads = rectsToLineQuads(pages.get(pageIndex) ?? []);
    if (quads.length === 0) continue;
    list.push({
      id: newAnnotationId(),
      type,
      pageIndex,
      quads,
      rect: rectFromQuads(quads),
      color: colors[type],
      opacity: 1,
      contents: '',
      author,
      modified: now,
      created: now,
      origin: { kind: 'new' },
    });
  }
  addAnnotations(LABEL[type], list);
  return list.length;
}

/** `true` si la herramienta activa es un marcado de texto. */
export function isMarkupTool(tool: string): tool is MarkupType {
  return tool === 'highlight' || tool === 'underline' || tool === 'strikeout';
}
