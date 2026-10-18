import { describe, expect, it } from 'vitest';
import { parsePageRange } from '../../src/core/print/range';

describe('parsePageRange', () => {
  it('admite rangos, páginas sueltas y espacios', () => {
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange(' 2 - 4 ,  6 ', 10)).toEqual([1, 2, 3, 5]);
  });

  it('«8-» significa de la página 8 al final', () => {
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
  });

  it('acepta el guion largo «–» y los rangos al revés', () => {
    expect(parsePageRange('3–1', 10)).toEqual([0, 1, 2]);
    expect(parsePageRange('2–2', 10)).toEqual([1]);
  });

  it('ordena y quita repetidos', () => {
    expect(parsePageRange('5, 1-3, 2, 5', 10)).toEqual([0, 1, 2, 4]);
  });

  it('devuelve null si algo no es válido o está fuera de [1, numPages]', () => {
    for (const text of ['0', '11', 'a', '', '   ', '1,,2', '1,', ',1', '-3', '1-2-3', '1 2', '0-3', '5-11', '11-', '1.5']) {
      expect(parsePageRange(text, 10), text).toBeNull();
    }
  });

  it('devuelve null sin páginas en el documento', () => {
    expect(parsePageRange('1', 0)).toBeNull();
  });

  it('rechaza números que no son enteros seguros', () => {
    expect(parsePageRange('99999999999999999999', 10)).toBeNull();
  });
});
