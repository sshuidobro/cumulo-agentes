import { describe, expect, it } from 'vitest';
import { textWidth } from '../../../src/core/annotations/helvetica-widths';
import { wrapText } from '../../../src/core/annotations/wrap';

describe('wrapText', () => {
  it('parte por espacios cuando la línea no cabe', () => {
    expect(wrapText('uno dos tres', textWidth('uno dos', 10), 10)).toEqual(['uno dos', 'tres']);
  });

  it('respeta los saltos de línea', () => {
    expect(wrapText('a\nb', 1000, 10)).toEqual(['a', 'b']);
  });

  it('conserva las líneas vacías entre saltos', () => {
    expect(wrapText('a\n\nb', 1000, 10)).toEqual(['a', '', 'b']);
    expect(wrapText('', 1000, 10)).toEqual(['']);
    expect(wrapText('   ', 1000, 10)).toEqual(['']);
  });

  it('parte una palabra más larga que la línea por caracteres, sin superar el ancho', () => {
    const maxWidth = 50;
    const lines = wrapText('m'.repeat(100), maxWidth, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(textWidth(line, 10)).toBeLessThanOrEqual(maxWidth);
    }
    expect(lines.join('')).toBe('m'.repeat(100));
  });

  it('una palabra que cabe sola no se parte aunque la línea anterior sea otra', () => {
    expect(wrapText('hola mundo', 1000, 10)).toEqual(['hola mundo']);
    expect(wrapText('aaa bbbbbbbbbbbb', textWidth('bbbbbbbbbbbb', 10), 10)).toEqual(['aaa', 'bbbbbbbbbbbb']);
  });

  it('deja un carácter por línea si ni él cabe en el ancho', () => {
    expect(wrapText('mm', 1, 10)).toEqual(['m', 'm']);
  });

  it('ignora espacios repetidos al cortar', () => {
    expect(wrapText('a   b', 1000, 10)).toEqual(['a b']);
  });

  it('no produce líneas más anchas que el máximo si el texto cabe en varias', () => {
    const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';
    for (const line of wrapText(text, 60, 9)) {
      expect(textWidth(line, 9)).toBeLessThanOrEqual(60);
    }
  });
});
