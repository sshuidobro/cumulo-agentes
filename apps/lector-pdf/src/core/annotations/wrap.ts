import { textWidth } from './helvetica-widths';

/**
 * Parte `text` en líneas que no superan `maxWidth` puntos (Helvetica a `fontSize`).
 * Respeta los saltos `\n`; dentro de cada párrafo corta por espacios. Una palabra más ancha que
 * la línea se parte por caracteres. Un párrafo vacío produce una línea vacía.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapParagraph(paragraph, maxWidth, fontSize));
  }
  return lines;
}

function wrapParagraph(paragraph: string, maxWidth: number, fontSize: number): string[] {
  const words = paragraph.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  const fits = (s: string): boolean => textWidth(s, fontSize) <= maxWidth;

  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = '';

    if (fits(word)) {
      line = word;
      continue;
    }
    // Palabra demasiado larga: se parte por caracteres.
    for (const ch of word) {
      if (line !== '' && !fits(line + ch)) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
