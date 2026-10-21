import { describe, expect, it } from 'vitest';
import type { PageComparison } from '../../../src/core/compare/compare';
import { nextChangeIndex } from '../../../src/core/compare/change-index';
import { marksForSide } from '../../../src/core/compare/marks';
import type { Word } from '../../../src/core/compare/words';

function word(text: string, item: number): Word {
  return { text, start: { item, offset: 0 }, end: { item, offset: text.length } };
}

describe('marksForSide (PDF-117)', () => {
  const replace: PageComparison = {
    kind: 'changed',
    page: 1,
    changes: [{ kind: 'replace', removed: [word('página', 2)], added: [word('hoja', 2)] }],
  };

  it('en A la palabra sustituida es «replaced» con la página y la posición de A', () => {
    expect(marksForSide(replace, 'a')).toEqual([
      { kind: 'replaced', match: { pageIndex: 1, start: { item: 2, offset: 0 }, end: { item: 2, offset: 6 } } },
    ]);
  });

  it('en B la misma sustitución es «replaced» con la palabra nueva', () => {
    const marks = marksForSide(replace, 'b');
    expect(marks.map((m) => m.kind)).toEqual(['replaced']);
    expect(marks[0]?.match.end).toEqual({ item: 2, offset: 4 });
  });

  it('un borrado marca «removed» solo en A y un añadido «added» solo en B', () => {
    const page: PageComparison = {
      kind: 'changed',
      page: 0,
      changes: [
        { kind: 'delete', removed: [word('uno', 0), word('dos', 0)], added: [] },
        { kind: 'insert', removed: [], added: [word('tres', 1)] },
      ],
    };
    expect(marksForSide(page, 'a').map((m) => m.kind)).toEqual(['removed', 'removed']);
    expect(marksForSide(page, 'b').map((m) => m.kind)).toEqual(['added']);
  });

  it('las páginas que no son «changed» no tienen resaltados', () => {
    expect(marksForSide({ kind: 'only-in-a', page: 3 }, 'a')).toEqual([]);
    expect(marksForSide({ kind: 'too-different', page: 3 }, 'b')).toEqual([]);
    expect(marksForSide({ kind: 'same', page: 3 }, 'a')).toEqual([]);
  });
});

describe('nextChangeIndex (PDF-117)', () => {
  it('avanza y retrocede dentro de la lista', () => {
    expect(nextChangeIndex(1, 5, 1)).toBe(2);
    expect(nextChangeIndex(2, 5, -1)).toBe(1);
  });

  it('no sale de los límites', () => {
    expect(nextChangeIndex(0, 5, -1)).toBe(0);
    expect(nextChangeIndex(4, 5, 1)).toBe(4);
  });

  it('sin selección, el primer paso va al primero hacia delante y al último hacia atrás', () => {
    expect(nextChangeIndex(null, 5, 1)).toBe(0);
    expect(nextChangeIndex(null, 5, -1)).toBe(4);
  });

  it('con la lista vacía no hay cambio', () => {
    expect(nextChangeIndex(null, 0, 1)).toBeNull();
    expect(nextChangeIndex(0, 0, -1)).toBeNull();
  });
});
