import { describe, expect, it } from 'vitest';
import { findInPage } from '../../src/core/search/find';
import { normalizeQuery, normalizeText, type NormalizeOptions } from '../../src/core/search/normalize';
import { buildPageText, rawOffsetToPos, type TextItemLike } from '../../src/core/search/page-text';

const SIN_TILDES: NormalizeOptions = { matchCase: false, matchDiacritics: false };

/** Busca en una página construida con ítems simulados, como haría la sesión. */
function search(items: readonly TextItemLike[], query: string, wholeWord = false, opts: NormalizeOptions = SIN_TILDES) {
  const pt = buildPageText(items);
  const norm = normalizeText(pt.raw, opts);
  return findInPage(0, pt, norm, normalizeQuery(query, opts), wholeWord);
}

const item = (str: string, hasEOL = false): TextItemLike => ({ str, hasEOL });

describe('buildPageText', () => {
  it('concatena los ítems y registra dónde empieza cada uno', () => {
    const pt = buildPageText([item('ab'), item('cde')]);
    expect(pt.raw).toBe('abcde');
    expect(Array.from(pt.itemStarts)).toEqual([0, 2, 5]);
  });

  it('añade un salto de línea tras un ítem con hasEOL', () => {
    const pt = buildPageText([item('ab', true), item('cd')]);
    expect(pt.raw).toBe('ab\ncd');
    expect(Array.from(pt.itemStarts)).toEqual([0, 3, 5]);
  });

  it('no añade salto de línea si el ítem ya termina en espacio', () => {
    expect(buildPageText([item('ab ', true)]).raw).toBe('ab ');
  });

  it('una página sin ítems tiene texto vacío', () => {
    const pt = buildPageText([]);
    expect(pt.raw).toBe('');
    expect(Array.from(pt.itemStarts)).toEqual([0]);
  });
});

describe('rawOffsetToPos', () => {
  it('ubica cada índice en su ítem y su offset', () => {
    const pt = buildPageText([item('ab', true), item('cd')]);
    expect(rawOffsetToPos(pt, 0)).toEqual({ item: 0, offset: 0 });
    expect(rawOffsetToPos(pt, 1)).toEqual({ item: 0, offset: 1 });
    expect(rawOffsetToPos(pt, 3)).toEqual({ item: 1, offset: 0 });
    expect(rawOffsetToPos(pt, 4)).toEqual({ item: 1, offset: 1 });
  });

  it('el salto de línea añadido cae al final del ítem anterior', () => {
    const pt = buildPageText([item('ab', true), item('cd')]);
    expect(rawOffsetToPos(pt, 2)).toEqual({ item: 0, offset: 2 });
  });

  it('con ítems vacíos elige el último ítem que empieza en ese índice', () => {
    const pt = buildPageText([item('ab'), item(''), item('cd')]);
    expect(rawOffsetToPos(pt, 2)).toEqual({ item: 2, offset: 0 });
  });

  it('una página vacía devuelve la posición 0', () => {
    expect(rawOffsetToPos(buildPageText([]), 0)).toEqual({ item: 0, offset: 0 });
  });
});

describe('findInPage', () => {
  it('encuentra las coincidencias sin solaparse', () => {
    const matches = search([item('aaaa')], 'aa');
    expect(matches.map((m) => [m.start.offset, m.end.offset])).toEqual([[0, 2], [2, 4]]);
  });

  it('devuelve posiciones exclusivas dentro de un solo ítem', () => {
    const items = [item('El veloz murciélago hindú.')];
    const [match] = search(items, 'murciélago', false, { matchCase: false, matchDiacritics: true });
    expect(match).toBeDefined();
    if (match === undefined) return;
    expect(match.pageIndex).toBe(0);
    expect(match.start).toEqual({ item: 0, offset: 9 });
    expect(match.end.item).toBe(0);
    expect(items[match.start.item]?.str.slice(match.start.offset, match.end.offset)).toBe('murciélago');
  });

  it('una coincidencia que cruza dos ítems tiene inicio y fin en ítems distintos', () => {
    const [match] = search([item('...kiwi.'), item(' marcador-1')], 'kiwi. marcador');
    expect(match).toBeDefined();
    if (match === undefined) return;
    expect(match.start).toEqual({ item: 0, offset: 3 });
    expect(match.end).toEqual({ item: 1, offset: 9 });
    expect(match.start.item).not.toBe(match.end.item);
  });

  it('una coincidencia que termina al final de un ítem queda en ese ítem', () => {
    const [match] = search([item('uno dos'), item(' tres')], 'dos');
    expect(match?.end).toEqual({ item: 0, offset: 7 });
  });

  it('con palabra completa descarta coincidencias pegadas a letras, cifras o guion bajo', () => {
    expect(search([item('cama camaleón recama')], 'cama', true)).toHaveLength(1);
    expect(search([item('a_b ab')], 'ab', true)).toHaveLength(1);
    expect(search([item('x12 12x 12')], '12', true)).toHaveLength(1);
  });

  it('con palabra completa reconoce letras fuera del plano básico', () => {
    // U+10400 (alfabeto deseret) es una letra: «bc» pegada a ella no es palabra completa.
    expect(search([item('\u{10400}bc bc')], 'bc', true)).toHaveLength(1);
  });

  it('sin palabra completa encuentra también coincidencias dentro de palabras', () => {
    expect(search([item('rebusquedas busquedas')], 'busquedas')).toHaveLength(2);
  });

  it('una consulta vacía no encuentra nada', () => {
    expect(search([item('texto')], '')).toEqual([]);
  });

  it('respeta el máximo de coincidencias', () => {
    const pt = buildPageText([item('x x x x')]);
    const norm = normalizeText(pt.raw, SIN_TILDES);
    expect(findInPage(3, pt, norm, 'x', false, 2)).toHaveLength(2);
    expect(findInPage(3, pt, norm, 'x', false, 2).every((m) => m.pageIndex === 3)).toBe(true);
  });

  it('las coincidencias de texto sin tildes apuntan a las letras originales con tilde', () => {
    const items = [item('Año nuevo')];
    const [match] = search(items, 'ano');
    expect(match?.start.offset).toBe(0);
    expect(match?.end.offset).toBe(3);
  });
});
