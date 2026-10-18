import { describe, expect, it } from 'vitest';
import { formatPageIndicator, parsePageInput } from '../../src/core/page-input';

/** Etiquetas de un PDF de 12 páginas: i, ii, iii, iv, 1 … 7, A-1. */
const LABELS: readonly string[] = ['i', 'ii', 'iii', 'iv', '1', '2', '3', '4', '5', '6', '7', 'A-1'];

describe('parsePageInput', () => {
  it('con etiquetas, «iv» va a la página 4 (índice 3)', () => {
    expect(parsePageInput('iv', 12, LABELS)).toBe(3);
  });

  it('con etiquetas, «1» va a la página de la etiqueta «1» (índice 4), no a la primera', () => {
    expect(parsePageInput('1', 12, LABELS)).toBe(4);
  });

  it('busca etiquetas sin distinguir mayúsculas', () => {
    expect(parsePageInput('A-1', 12, LABELS)).toBe(11);
    expect(parsePageInput('a-1', 12, LABELS)).toBe(11);
    expect(parsePageInput('IV', 12, LABELS)).toBe(3);
  });

  it('si no hay etiqueta con ese texto, usa el número de página: «12» → índice 11', () => {
    expect(parsePageInput('12', 12, LABELS)).toBe(11);
  });

  it('rechaza 0, números fuera de rango y texto que no es número ni etiqueta', () => {
    expect(parsePageInput('0', 12, LABELS)).toBeNull();
    expect(parsePageInput('13', 12, LABELS)).toBeNull();
    expect(parsePageInput('x', 12, LABELS)).toBeNull();
  });

  it('sin etiquetas, «5» va a la página 5 (índice 4)', () => {
    expect(parsePageInput('5', 12, null)).toBe(4);
  });

  it('recorta espacios y acepta cadenas vacías como inválidas', () => {
    expect(parsePageInput('  7  ', 12, null)).toBe(6);
    expect(parsePageInput('   ', 12, null)).toBeNull();
    expect(parsePageInput('', 12, LABELS)).toBeNull();
  });

  it('no acepta formatos numéricos que no sean enteros simples', () => {
    expect(parsePageInput('+3', 12, null)).toBeNull();
    expect(parsePageInput('3.5', 12, null)).toBeNull();
    expect(parsePageInput('1e1', 12, null)).toBeNull();
    expect(parsePageInput('-1', 12, null)).toBeNull();
  });

  it('acepta el último número de página y rechaza el siguiente, en documentos grandes', () => {
    expect(parsePageInput('100000', 100000, null)).toBe(99999);
    expect(parsePageInput('100001', 100000, null)).toBeNull();
  });
});

describe('formatPageIndicator', () => {
  it('con etiquetas distintas al número muestra la etiqueta y «(n de total)»', () => {
    expect(formatPageIndicator(3, 12, LABELS)).toEqual({ inputValue: 'iv', suffix: '(4 de 12)' });
  });

  it('con una etiqueta igual al número muestra el número y «de total»', () => {
    expect(formatPageIndicator(1, 3, ['1', '2', '3'])).toEqual({ inputValue: '2', suffix: 'de 3' });
  });

  it('la etiqueta «1» de la página 5 no es igual al número 5: se muestra la etiqueta', () => {
    expect(formatPageIndicator(4, 12, LABELS)).toEqual({ inputValue: '1', suffix: '(5 de 12)' });
  });

  it('sin etiquetas muestra el número y «de total»', () => {
    expect(formatPageIndicator(4, 5000, null)).toEqual({ inputValue: '5', suffix: 'de 5000' });
  });

  it('formatea miles en español (100.000) en el sufijo', () => {
    expect(formatPageIndicator(0, 100000, null)).toEqual({ inputValue: '1', suffix: 'de 100.000' });
  });

  it('usa el número de página cuando la lista de etiquetas es más corta que el documento', () => {
    expect(formatPageIndicator(9, 12, ['i'])).toEqual({ inputValue: '10', suffix: 'de 12' });
  });
});
