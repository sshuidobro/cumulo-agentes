import { buildPageText, rawOffsetToPos, type TextItemLike, type TextPos } from '../search/page-text';

/** Palabra de una página con su posición en los ítems de pdf.js (`end` exclusivo, como `SearchMatch`). */
export interface Word {
  readonly text: string;
  readonly start: TextPos;
  readonly end: TextPos;
}

interface Token {
  readonly start: number;
  readonly end: number;
}

const NON_SPACE_RUN = /\S+/gu;

/**
 * Palabras = tramos de no-espacios del texto NFC de la página. Una palabra que termina en '-' justo antes de un '\n'
 * se une con la siguiente (texto sin el guion; start de la primera, end de la segunda). El guion solo se une si
 * queda algo delante de él.
 */
export function pageWords(items: readonly TextItemLike[]): readonly Word[] {
  const pt = buildPageText(items);
  const raw = pt.raw;

  const tokens: Token[] = [];
  for (const match of raw.matchAll(NON_SPACE_RUN)) {
    const start = match.index ?? 0;
    tokens.push({ start, end: start + match[0].length });
  }

  const words: Word[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) break;
    const next = tokens[i + 1];
    const joins =
      next !== undefined &&
      token.end - token.start > 1 &&
      raw.charAt(token.end - 1) === '-' &&
      raw.charAt(token.end) === '\n';

    if (joins) {
      const stem = raw.slice(token.start, token.end - 1);
      const tail = raw.slice(next.start, next.end);
      words.push({
        text: (stem + tail).normalize('NFC'),
        start: rawOffsetToPos(pt, token.start),
        end: rawOffsetToPos(pt, next.end),
      });
      i += 2;
    } else {
      words.push({
        text: raw.slice(token.start, token.end).normalize('NFC'),
        start: rawOffsetToPos(pt, token.start),
        end: rawOffsetToPos(pt, token.end),
      });
      i += 1;
    }
  }
  return words;
}
