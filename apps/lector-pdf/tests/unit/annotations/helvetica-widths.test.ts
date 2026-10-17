import { describe, expect, it } from 'vitest';
import { HELVETICA_WIDTHS, textWidth } from '../../../src/core/annotations/helvetica-widths';

describe('textWidth', () => {
  it('suma los anchos AFM en milésimas de em', () => {
    expect(textWidth('Hola', 10)).toBe(20.56);
    expect(textWidth('Hola', 10)).toBe((722 + 556 + 222 + 556) / 100);
  });

  it('mide la ñ como 556 milésimas', () => {
    expect(textWidth('ñ', 10)).toBe(5.56);
    expect(textWidth('Ñ', 10)).toBe(7.22);
  });

  it('mide las vocales acentuadas y la ç igual que su base', () => {
    expect(textWidth('á', 1000)).toBe(textWidth('a', 1000));
    expect(textWidth('Ó', 1000)).toBe(textWidth('O', 1000));
    expect(textWidth('í', 1000)).toBe(textWidth('i', 1000));
    expect(textWidth('ì', 1000)).toBe(textWidth('i', 1000));
    expect(textWidth('ç', 1000)).toBe(textWidth('c', 1000));
    expect(textWidth('Ç', 1000)).toBe(textWidth('C', 1000));
  });

  it('usa 556 para caracteres desconocidos (un punto de código cuenta una vez)', () => {
    expect(textWidth('€x', 1000)).toBe(556 + 500);
    expect(textWidth('😀', 1000)).toBe(556);
    expect(textWidth('Ж', 1000)).toBe(556);
  });

  it('devuelve 0 para la cadena vacía', () => {
    expect(textWidth('', 12)).toBe(0);
  });

  it('escala linealmente con el tamaño de fuente', () => {
    expect(textWidth('abc', 24)).toBeCloseTo(2 * textWidth('abc', 12), 10);
  });

  it('contiene la tabla completa de ASCII imprimible', () => {
    for (let c = 0x20; c <= 0x7e; c++) {
      expect(HELVETICA_WIDTHS[String.fromCharCode(c)]).toBeTypeOf('number');
    }
    expect(HELVETICA_WIDTHS['@']).toBe(1015);
    expect(HELVETICA_WIDTHS['m']).toBe(833);
    expect(HELVETICA_WIDTHS['\\']).toBe(278);
  });
});
