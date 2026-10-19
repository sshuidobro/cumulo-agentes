import { describe, expect, it } from 'vitest';
import { buildCommentRows, EMPTY_COMMENT_FILTER, rowLayout, visibleRowRange } from '../../src/core/annotations/comment-list';
import type { Annotation } from '../../src/core/annotations/model';
import { newReply } from '../../src/core/annotations/replies';
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

  it('con 5 000 comentarios y 5 000 respuestas, construir las filas tarda menos de 150 ms (presupuesto ×1,5)', () => {
    const half = 5_000;
    const effective = new Map<string, Annotation>();
    for (const a of synthetic().values()) {
      if (Number(a.id.slice('suite-'.length)) < half) effective.set(a.id, a);
    }
    for (const parent of [...effective.values()]) {
      const reply = newReply({ id: `reply-${parent.id}`, parent, contents: `Respuesta a ${parent.id}`, author: 'Ana', now: '2026-10-01T10:00:00.000Z' });
      effective.set(reply.id, reply);
    }
    const { value, ms } = measureBest(() => buildCommentRows(effective, new Map(), EMPTY_COMMENT_FILTER));
    expect(value.filter((r) => r.kind === 'reply')).toHaveLength(half);
    expect(ms, `buildCommentRows con respuestas: ${ms.toFixed(1)} ms`).toBeLessThan(BUDGET_MS * 1.5);
  });

  it('filtrar por texto con 10 000 anotaciones tarda menos de 100 ms', () => {
    const effective = synthetic();
    const { ms } = measureBest(() => buildCommentRows(effective, new Map(), { ...EMPTY_COMMENT_FILTER, text: 'PREVIO' }));
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
