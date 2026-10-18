import { describe, expect, it } from 'vitest';
import { allIds, flattenVisible, toOutlineNodes, type RawOutlineItem } from '../../src/core/outline';
import { measureBest } from './measure';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.

describe('rendimiento del índice (PDF-016)', () => {
  it('un árbol de 10 000 marcadores, todos desplegados, se aplana en menos de 50 ms', () => {
    // 100 capítulos con 99 secciones cada uno: 10 000 nodos en total.
    const raw: RawOutlineItem[] = Array.from({ length: 100 }, (_, c) => ({
      title: `Capítulo ${String(c + 1)}`,
      count: 99,
      items: Array.from({ length: 99 }, (_, s) => ({ title: `Sección ${String(c + 1)}.${String(s + 1)}`, dest: 'x' })),
    }));
    const nodes = toOutlineNodes(raw);
    const expanded = allIds(nodes);

    const { value, ms } = measureBest(() => flattenVisible(nodes, expanded));
    expect(value).toHaveLength(10_000);
    expect(ms).toBeLessThan(50);
  });
});
