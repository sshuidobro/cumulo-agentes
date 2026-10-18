import { describe, expect, it } from 'vitest';
import { buildCommentRows, EMPTY_COMMENT_FILTER, rowLayout, visibleRowRange } from '../../src/core/annotations/comment-list';
import type { Annotation } from '../../src/core/annotations/model';
import { newAnnotation } from '../unit/annotations/factories';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo con `pnpm perf`. Sin JSX a propósito.

const COMMENTS = 10_000;
const PAGES = 500;
const BUDGET_MS = 100;

function synthetic(): ReadonlyMap<string, Annotation> {
  const list = Array.from({ length: COMMENTS }, (_, i) => {
    const a = newAnnotation(`suite-${String(i)}`, i % 3 === 0 ? 'highlight' : 'note', i % PAGES);
    const y = 700 - (i % 40) * 15;
    const x = (i % 7) * 60;
    return { ...a, rect: [x, y - 12, x + 50, y] as const, contents: i % 2 === 0 ? `Comentario previo ${String(i)}` : '' };
  });
  return new Map(list.map((a) => [a.id, a]));
}

describe('rendimiento de la lista de comentarios', () => {
  it('construir las filas de 10 000 anotaciones tarda menos de 100 ms', () => {
    const effective = synthetic();
    const { value, ms } = measureBest(() => buildCommentRows(effective, new Map(), EMPTY_COMMENT_FILTER));
    expect(value.length).toBeGreaterThan(COMMENTS);
    expect(ms, `buildCommentRows: ${ms.toFixed(1)} ms`).toBeLessThan(BUDGET_MS);
  });

  it('filtrar por texto con 10 000 anotaciones tarda menos de 100 ms', () => {
    const effective = synthetic();
    const { ms } = measureBest(() => buildCommentRows(effective, new Map(), { types: new Set(), author: null, text: 'PREVIO' }));
    expect(ms, `filtro de texto: ${ms.toFixed(1)} ms`).toBeLessThan(BUDGET_MS);
  });

  it('calcular la posición de las filas y el rango visible tarda menos de 100 ms', () => {
    const rows = buildCommentRows(synthetic(), new Map(), EMPTY_COMMENT_FILTER);
    const { ms } = measureBest(() => {
      const layout = rowLayout(rows);
      visibleRowRange(layout, layout.total / 2, 600, 4);
    });
    expect(ms, `layout y rango: ${ms.toFixed(1)} ms`).toBeLessThan(BUDGET_MS);
  });
});
