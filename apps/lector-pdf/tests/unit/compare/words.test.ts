import { describe, expect, it } from 'vitest';
import { pageWords } from '../../../src/core/compare/words';

describe('pageWords', () => {
  it('devuelve [] para una página sin texto', () => {
    expect(pageWords([])).toEqual([]);
    expect(pageWords([{ str: '', hasEOL: false }])).toEqual([]);
  });

  it('trocea por espacios (también repetidos) con posiciones de ítem exclusivas al final', () => {
    const words = pageWords([{ str: 'Hola   mundo', hasEOL: false }]);
    expect(words.map((w) => w.text)).toEqual(['Hola', 'mundo']);
    expect(words[0]?.start).toEqual({ item: 0, offset: 0 });
    expect(words[0]?.end).toEqual({ item: 0, offset: 4 });
    expect(words[1]?.start).toEqual({ item: 0, offset: 7 });
    expect(words[1]?.end).toEqual({ item: 0, offset: 12 });
  });

  it('une «docu-» + «mento» en «documento» (start de la primera, end de la segunda)', () => {
    const items = [
      { str: 'Este docu-', hasEOL: true },
      { str: 'mento es largo.', hasEOL: false },
    ];
    const words = pageWords(items);
    expect(words.map((w) => w.text)).toEqual(['Este', 'documento', 'es', 'largo.']);
    const joined = words[1];
    expect(joined?.start).toEqual({ item: 0, offset: 5 });
    expect(joined?.end).toEqual({ item: 1, offset: 5 });
  });

  it('no une un guion que no va justo antes de un fin de línea', () => {
    const words = pageWords([{ str: 'docu-mento', hasEOL: false }]);
    expect(words.map((w) => w.text)).toEqual(['docu-mento']);
  });

  it('no une un guion aislado ni una palabra de fin de página con guion', () => {
    expect(pageWords([{ str: '- x', hasEOL: true }]).map((w) => w.text)).toEqual(['-', 'x']);
    expect(pageWords([{ str: 'fin-', hasEOL: true }]).map((w) => w.text)).toEqual(['fin-']);
  });

  it('normaliza a NFC y las posiciones siguen apuntando al texto original', () => {
    const items = [{ str: 'café ok', hasEOL: false }];
    const words = pageWords(items);
    expect(words[0]?.text).toBe('café');
    expect(words[0]?.end).toEqual({ item: 0, offset: 5 });
    expect(words[1]?.text).toBe('ok');
  });
});
