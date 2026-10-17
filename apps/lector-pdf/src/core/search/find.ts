import { rawOffsetToPos, type PageText, type TextPos } from './page-text';
import type { NormalizedText } from './normalize';

export interface SearchMatch {
  readonly pageIndex: number;
  readonly start: TextPos;
  /** Posición exclusiva: justo después del último carácter coincidente. */
  readonly end: TextPos;
}

/** Máximo de coincidencias por página por defecto. */
export const DEFAULT_MAX_MATCHES_PER_PAGE = 10_000;

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Busca `query` (ya normalizada con `normalizeQuery`, con las mismas opciones que `norm`) en el texto normalizado
 * de una página y devuelve las coincidencias como posiciones en los ítems de pdf.js.
 * Las coincidencias no se solapan. Con `wholeWord`, un candidato junto a otra letra, cifra o `_` se descarta.
 */
export function findInPage(
  pageIndex: number,
  pt: PageText,
  norm: NormalizedText,
  query: string,
  wholeWord: boolean,
  max: number = DEFAULT_MAX_MATCHES_PER_PAGE,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (query.length === 0) return matches;

  const text = norm.text;
  let from = 0;
  while (matches.length < max) {
    const found = text.indexOf(query, from);
    if (found < 0) break;
    const end = found + query.length;

    if (wholeWord && (isWordChar(charBefore(text, found)) || isWordChar(charAt(text, end)))) {
      from = found + 1;
      continue;
    }

    matches.push({
      pageIndex,
      start: rawOffsetToPos(pt, norm.map[found] ?? 0),
      end: exclusiveEndPos(pt, norm.map[end] ?? pt.raw.length),
    });
    from = end;
  }
  return matches;
}

/**
 * Posición exclusiva en los ítems para un índice `endRaw` de `raw`. Si `endRaw` abre un ítem, el final
 * se expresa como el final del ítem anterior (así una coincidencia que acaba al final de un ítem queda en ese ítem).
 */
function exclusiveEndPos(pt: PageText, endRaw: number): TextPos {
  const pos = rawOffsetToPos(pt, endRaw);
  if (pos.offset === 0 && pos.item > 0 && endRaw > 0 && pt.itemStarts[pos.item] === endRaw) {
    const before = rawOffsetToPos(pt, endRaw - 1);
    return { item: before.item, offset: before.offset + 1 };
  }
  return pos;
}

/** Último punto de código antes de `index` (cadena vacía al principio). */
function charBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

/** Punto de código que empieza en `index` (cadena vacía al final). */
function charAt(text: string, index: number): string {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}

function isWordChar(char: string): boolean {
  return char !== '' && WORD_CHAR.test(char);
}
