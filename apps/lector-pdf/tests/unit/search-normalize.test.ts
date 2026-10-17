import { describe, expect, it } from 'vitest';
import { normalizeQuery, normalizeText } from '../../src/core/search/normalize';

const SIN_TILDES = { matchCase: false, matchDiacritics: false } as const;
const CON_TILDES = { matchCase: false, matchDiacritics: true } as const;
const EXACTO = { matchCase: true, matchDiacritics: true } as const;

describe('normalizeText', () => {
  it('quita mayúsculas y tildes por defecto', () => {
    expect(normalizeText('Búsqueda', SIN_TILDES).text).toBe('busqueda');
  });

  it('conserva tildes si matchDiacritics es true', () => {
    expect(normalizeText('Búsqueda', CON_TILDES).text).toBe('búsqueda');
  });

  it('conserva mayúsculas si matchCase es true', () => {
    expect(normalizeText('Búsqueda', EXACTO).text).toBe('Búsqueda');
  });

  it('descompone la ligadura ﬁ en f e i, ambas apuntando al mismo original', () => {
    const norm = normalizeText('ﬁn', SIN_TILDES);
    expect(norm.text).toBe('fin');
    expect(Array.from(norm.map)).toEqual([0, 0, 1, 2]);
  });

  it('colapsa cualquier secuencia de espacios en uno solo', () => {
    const norm = normalizeText('a    b', SIN_TILDES);
    expect(norm.text).toBe('a b');
    expect(norm.map.length).toBe(norm.text.length + 1);
    expect(norm.map[2]).toBe(5);
  });

  it('trata el espacio duro U+00A0 como espacio normal', () => {
    expect(normalizeText('a b', SIN_TILDES).text).toBe('a b');
  });

  it('elimina el guion blando', () => {
    const norm = normalizeText('co­che', SIN_TILDES);
    expect(norm.text).toBe('coche');
    // Original: c o SHY c h e → el guion blando (índice 2) no se emite y los demás conservan su índice.
    expect(Array.from(norm.map)).toEqual([0, 1, 3, 4, 5, 6]);
  });

  it('apunta cada carácter emitido al índice de su punto de código original (con pares sustitutos)', () => {
    const norm = normalizeText('😀a', SIN_TILDES);
    expect(norm.text).toBe('😀a');
    expect(Array.from(norm.map)).toEqual([0, 0, 2, 3]);
  });

  it('devuelve map de longitud text.length + 1 con la longitud original al final', () => {
    const raw = 'Árbol del ñandú';
    const norm = normalizeText(raw, SIN_TILDES);
    expect(norm.text).toBe('arbol del nandu');
    expect(norm.map.length).toBe(norm.text.length + 1);
    expect(norm.map[norm.text.length]).toBe(raw.length);
  });

  it('un texto vacío da texto vacío y map [0]', () => {
    const norm = normalizeText('', SIN_TILDES);
    expect(norm.text).toBe('');
    expect(Array.from(norm.map)).toEqual([0]);
  });
});

describe('normalizeQuery', () => {
  it('normaliza igual que el texto y recorta los extremos', () => {
    expect(normalizeQuery('  Búsqueda  ', SIN_TILDES)).toBe('busqueda');
  });

  it('una consulta solo de espacios queda vacía', () => {
    expect(normalizeQuery('   ', SIN_TILDES)).toBe('');
  });
});
