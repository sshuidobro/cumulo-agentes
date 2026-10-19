import { buildPageText, rawOffsetToPos, type PageText, type TextItemLike, type TextPos } from '../search/page-text';

/** Longitud máxima de un fragmento que se envía al motor de voz (en unidades UTF-16). */
export const MAX_CHUNK_CHARS = 200;

/** Fragmento de una página que se lee de una vez. `start` y `end` delimitan su texto en los ítems (`end` exclusivo). */
export interface SpeechChunk {
  readonly pageIndex: number;
  readonly text: string;
  readonly start: TextPos;
  readonly end: TextPos;
}

/** Texto normalizado para leer: `map[k]` es el índice en el texto crudo de la unidad `text[k]`. */
interface NormalizedText {
  readonly text: string;
  readonly map: readonly number[];
}

/**
 * Frases de la página con `Intl.Segmenter('es', { granularity: 'sentence' })` (si no existe: corte tras [.!?…] seguido de espacio).
 * Sin espacios en los extremos; vacías fuera; `-\n` entre letras se elimina y `\n` → espacio en `text`;
 * más de 200 caracteres → corte en el último espacio antes de 200 (o a 200 si no hay).
 */
export function pageChunks(pageIndex: number, items: readonly TextItemLike[]): readonly SpeechChunk[] {
  const pt = buildPageText(items);
  const norm = normalize(pt.raw);
  const chunks: SpeechChunk[] = [];

  for (const [sentenceStart, sentenceEnd] of sentenceRanges(norm.text)) {
    const [s, e] = trimRange(norm.text, sentenceStart, sentenceEnd);
    if (e <= s) continue;
    for (const [a, b] of splitLong(norm.text, s, e)) {
      const first = norm.map[a];
      const last = norm.map[b - 1];
      if (first === undefined || last === undefined) continue;
      chunks.push({
        pageIndex,
        text: norm.text.slice(a, b),
        start: rawOffsetToPos(pt, first),
        end: endPosition(pt, last + 1, items),
      });
    }
  }
  return chunks;
}

/** Quita `-\n` entre letras, convierte `\n` en espacio y recuerda de dónde viene cada unidad del texto crudo. */
function normalize(raw: string): NormalizedText {
  const parts: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (ch === '-' && raw.charAt(i + 1) === '\n' && isLetter(raw.charAt(i - 1)) && isLetter(raw.charAt(i + 2))) {
      i += 1;
      continue;
    }
    parts.push(ch === '\n' ? ' ' : ch);
    map.push(i);
  }
  return { text: parts.join(''), map };
}

/** Rangos [inicio, fin) de las frases del texto normalizado. */
function sentenceRanges(text: string): readonly (readonly [number, number])[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('es', { granularity: 'sentence' });
    return Array.from(segmenter.segment(text), (seg) => [seg.index, seg.index + seg.segment.length] as const);
  }
  const ranges: (readonly [number, number])[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?…]+(?=\s)/gu)) {
    const end = match.index + match[0].length;
    ranges.push([start, end]);
    start = end;
  }
  ranges.push([start, text.length]);
  return ranges;
}

/** Quita los espacios de los extremos de [s, e). */
function trimRange(text: string, s: number, e: number): readonly [number, number] {
  let start = s;
  let end = e;
  while (start < end && isSpace(text.charAt(start))) start += 1;
  while (end > start && isSpace(text.charAt(end - 1))) end -= 1;
  return [start, end];
}

/** Parte [s, e) en trozos de como mucho `MAX_CHUNK_CHARS`, cortando en el último espacio posible. */
function splitLong(text: string, s: number, e: number): (readonly [number, number])[] {
  const pieces: (readonly [number, number])[] = [];
  let p = s;
  while (e - p > MAX_CHUNK_CHARS) {
    while (p < e && isSpace(text.charAt(p))) p += 1;
    if (e - p <= MAX_CHUNK_CHARS) break;

    let cut = -1;
    for (let c = p + MAX_CHUNK_CHARS; c > p; c--) {
      if (text.charAt(c) === ' ') {
        cut = c;
        break;
      }
    }
    if (cut > p) {
      pieces.push(trimRange(text, p, cut));
      p = cut + 1;
    } else {
      let hard = p + MAX_CHUNK_CHARS;
      // No partir un par de sustitutos (emoji u otros caracteres fuera del BMP).
      if (isHighSurrogate(text.charCodeAt(hard - 1))) hard -= 1;
      pieces.push(trimRange(text, p, hard));
      p = hard;
    }
  }
  const rest = trimRange(text, p, e);
  if (rest[1] > rest[0]) pieces.push(rest);
  return pieces.filter(([a, b]) => b > a);
}

/** Posición final (exclusiva) de un fragmento. Un límite entre ítems se expresa como el final del ítem anterior. */
function endPosition(pt: PageText, rawEnd: number, items: readonly TextItemLike[]): TextPos {
  const pos = rawOffsetToPos(pt, rawEnd);
  if (pos.offset === 0 && pos.item > 0) {
    const previous = items[pos.item - 1];
    if (previous !== undefined) return { item: pos.item - 1, offset: previous.str.length };
  }
  return pos;
}

function isSpace(ch: string): boolean {
  return /\s/u.test(ch);
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
