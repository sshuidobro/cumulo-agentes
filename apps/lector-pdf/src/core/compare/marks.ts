import type { SearchMatch } from '../search/find';
import type { PageComparison } from './compare';

/** Tipo de resaltado: `removed` (solo en el documento abierto), `added` (solo en el otro) o `replaced` (sustituida). */
export type MarkKind = 'removed' | 'added' | 'replaced';

/** Palabra a resaltar en una de las dos páginas, con su posición en la capa de texto (PDF-117). */
export interface CompareMark {
  readonly kind: MarkKind;
  readonly match: SearchMatch;
}

/**
 * Resaltados de una página para un lado de la comparación. `a` = documento abierto (palabras eliminadas o
 * sustituidas), `b` = otro documento (palabras añadidas o sustituidas). Solo las páginas `changed` tienen resaltados.
 */
export function marksForSide(result: PageComparison, side: 'a' | 'b'): readonly CompareMark[] {
  if (result.kind !== 'changed') return [];
  const marks: CompareMark[] = [];
  for (const change of result.changes) {
    const words = side === 'a' ? change.removed : change.added;
    if (words.length === 0) continue;
    const kind: MarkKind = change.kind === 'replace' ? 'replaced' : side === 'a' ? 'removed' : 'added';
    for (const word of words) {
      marks.push({ kind, match: { pageIndex: result.page, start: word.start, end: word.end } });
    }
  }
  return marks;
}
