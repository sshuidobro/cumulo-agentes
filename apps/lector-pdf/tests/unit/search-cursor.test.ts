import { describe, expect, it } from 'vitest';
import { matchOrdinal, stepCursor, type MatchCursor } from '../../src/core/search/cursor';

/** Páginas con coincidencias y su número de coincidencias: p2 (1), p4 (2), como en el criterio de PDF-018. */
const PAGES = [1, 3];
const COUNTS: Readonly<Record<number, number>> = { 1: 1, 3: 2 };
const countOf = (page: number): number => COUNTS[page] ?? 0;

describe('stepCursor · recorrido global de coincidencias', () => {
  it('siguiente desde p2#0 recorre p4#0, p4#1 y vuelve a p2#0', () => {
    let cursor: MatchCursor | null = { page: 1, index: 0 };
    const visited: MatchCursor[] = [];
    for (let i = 0; i < 3; i++) {
      cursor = stepCursor(PAGES, countOf, cursor, 1);
      if (cursor !== null) visited.push(cursor);
    }
    expect(visited).toEqual([
      { page: 3, index: 0 },
      { page: 3, index: 1 },
      { page: 1, index: 0 },
    ]);
  });

  it('anterior desde p2#0 va a p4#1 (vuelta al final)', () => {
    expect(stepCursor(PAGES, countOf, { page: 1, index: 0 }, -1)).toEqual({ page: 3, index: 1 });
  });

  it('sin coincidencia actual, siguiente da la primera y anterior la última', () => {
    expect(stepCursor(PAGES, countOf, null, 1)).toEqual({ page: 1, index: 0 });
    expect(stepCursor(PAGES, countOf, null, -1)).toEqual({ page: 3, index: 1 });
  });

  it('sin coincidencias no hay cursor', () => {
    expect(stepCursor([], countOf, null, 1)).toBeNull();
    expect(stepCursor([], countOf, { page: 1, index: 0 }, -1)).toBeNull();
  });

  it('una sola coincidencia se queda en sí misma', () => {
    expect(stepCursor([5], () => 1, { page: 5, index: 0 }, 1)).toEqual({ page: 5, index: 0 });
    expect(stepCursor([5], () => 1, { page: 5, index: 0 }, -1)).toEqual({ page: 5, index: 0 });
  });
});

describe('matchOrdinal · número de orden en el recorrido', () => {
  it('numera de 1 a total en orden global', () => {
    expect(matchOrdinal(PAGES, countOf, { page: 1, index: 0 })).toBe(1);
    expect(matchOrdinal(PAGES, countOf, { page: 3, index: 0 })).toBe(2);
    expect(matchOrdinal(PAGES, countOf, { page: 3, index: 1 })).toBe(3);
  });

  it('un cursor fuera de rango da 0', () => {
    expect(matchOrdinal(PAGES, countOf, { page: 2, index: 0 })).toBe(0);
    expect(matchOrdinal(PAGES, countOf, { page: 1, index: 4 })).toBe(0);
  });
});
