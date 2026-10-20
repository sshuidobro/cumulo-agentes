import { describe, expect, it } from 'vitest';
import { initialPlan, moveCommand, rotateCommand, deleteCommand, insertBlankCommand, selectAll, toggleKey, selectOnly, extendTo } from '../../../src/core/organize';

describe('plan QA', () => {
  const p = initialPlan([0, 0, 0, 0, 0]);
  it('mover/girar/borrar son puros e invertibles', () => {
    const snap = structuredClone(p);
    for (const c of [moveCommand(new Set(['o1', 'o2']), 2), rotateCommand(new Set(['o0']), -90), deleteCommand(new Set(['o4']))]) {
      const after = c.apply(p);
      expect(p).toEqual(snap);
      expect(c.invert(p).apply(after)).toEqual(p);
    }
    expect(rotateCommand(new Set(['o0']), -90).apply(p).slots[0]).toMatchObject({ rotate: 270 });
  });
  it('insertBlank tamaños inválidos', () => {
    for (const [w, h] of [[0, 10], [10, 14401], [NaN, 5], [Infinity, 5]] as [number, number][]) expect(() => insertBlankCommand(0, w, h).apply(p)).toThrow(RangeError);
  });
  it('claves desconocidas y extendTo hacia atrás', () => {
    expect(() => moveCommand(new Set(['zz']), 0).apply(p)).not.toThrow();
    const s = extendTo(p, selectOnly('o3'), 'o1');
    expect([...s.keys].sort()).toEqual(['o1', 'o2', 'o3']);
    expect(toggleKey(selectAll(p), 'o0').keys.size).toBe(4);
  });
});
