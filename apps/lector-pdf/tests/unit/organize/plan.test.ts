import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  canDelete,
  deleteCommand,
  extendTo,
  indexOfKey,
  initialPlan,
  insertBlankCommand,
  insertImportedCommand,
  isUnchanged,
  moveCommand,
  ORGANIZE_UNDO_DEPTH,
  pruneSelection,
  rotateCommand,
  selectAll,
  selectOnly,
  toggleKey,
  toSaveSlots,
  type OrganizePlan,
  type PlanSelection,
} from '../../../src/core/organize';

const keysOf = (...ks: string[]): ReadonlySet<string> => new Set(ks);
const sources = (plan: OrganizePlan): number[] =>
  plan.slots.map((s) => (s.kind === 'original' || s.kind === 'imported' ? s.source : -1));
const keys = (plan: OrganizePlan): string[] => plan.slots.map((s) => s.key);

function fivePages(): OrganizePlan {
  return initialPlan([0, 0, 0, 0, 0]);
}

describe('initialPlan e isUnchanged', () => {
  it('crea huecos original con claves o0..o2 y giros dados', () => {
    const plan = initialPlan([0, 90, 0]);
    expect(plan.slots).toEqual([
      { key: 'o0', kind: 'original', source: 0, rotate: 0 },
      { key: 'o1', kind: 'original', source: 1, rotate: 90 },
      { key: 'o2', kind: 'original', source: 2, rotate: 0 },
    ]);
    expect(plan.nextKey).toBe(0);
  });

  it('isUnchanged detecta cambios y el deshacer restaura el plan exacto', () => {
    const rotations = [0, 90, 0] as const;
    const plan = initialPlan(rotations);
    expect(isUnchanged(plan, rotations)).toBe(true);

    const cmd = rotateCommand(keysOf('o1'), -90);
    const after = cmd.apply(plan);
    expect(isUnchanged(after, rotations)).toBe(false);

    const undone = cmd.invert(plan).apply(after);
    expect(isUnchanged(undone, rotations)).toBe(true);
    expect(undone).toEqual(initialPlan(rotations));
  });

  it('isUnchanged es falso si cambian el número de páginas o el orden', () => {
    const plan = initialPlan([0, 0]);
    expect(isUnchanged(plan, [0, 0, 0])).toBe(false);
    expect(isUnchanged(moveCommand(keysOf('o1'), 0).apply(plan), [0, 0])).toBe(false);
  });

  it('toSaveSlots no incluye claves y conserva tipo, fuente, giro y dimensiones', () => {
    let plan = initialPlan([90]);
    plan = insertBlankCommand(1, 595, 842).apply(plan);
    plan = insertImportedCommand(2, 3, [270]).apply(plan);
    expect(toSaveSlots(plan)).toEqual([
      { kind: 'original', source: 0, rotate: 90 },
      { kind: 'blank', width: 595, height: 842, rotate: 0 },
      { kind: 'imported', doc: 3, source: 0, rotate: 270 },
    ]);
  });
});

describe('rotateCommand', () => {
  it('gira ±90 con módulo 360 y solo los huecos indicados', () => {
    const plan = initialPlan([0, 270]);
    const right = rotateCommand(keysOf('o0', 'o1'), 90).apply(plan);
    expect(right.slots.map((s) => s.rotate)).toEqual([90, 0]);
    const left = rotateCommand(keysOf('o0'), -90).apply(right);
    expect(left.slots.map((s) => s.rotate)).toEqual([0, 0]);
  });

  it('ignora claves que no están en el plan y no muta el original', () => {
    const plan = initialPlan([0]);
    const next = rotateCommand(keysOf('zz'), 90).apply(plan);
    expect(next).toEqual(plan);
    expect(next).not.toBe(plan);
    expect(plan.slots[0]?.rotate).toBe(0);
  });

  it('tiene la etiqueta «girar páginas» y su deshacer la conserva', () => {
    const cmd = rotateCommand(keysOf('o0'), 90);
    expect(cmd.label).toBe('girar páginas');
    expect(cmd.invert(initialPlan([0])).label).toBe('girar páginas');
  });
});

describe('moveCommand', () => {
  it('mueve {o0, o2} al final de 5 páginas', () => {
    const plan = fivePages();
    expect(sources(moveCommand(keysOf('o0', 'o2'), 5).apply(plan))).toEqual([1, 3, 4, 0, 2]);
  });

  it('mueve {o3} al principio', () => {
    expect(sources(moveCommand(keysOf('o3'), 0).apply(fivePages()))).toEqual([3, 0, 1, 2, 4]);
  });

  it('mueve delante del hueco que estaba en toIndex (índice previo al movimiento)', () => {
    // Delante de o3 (índice 3): o0 se mueve y queda antes de o3.
    expect(sources(moveCommand(keysOf('o0'), 3).apply(fivePages()))).toEqual([1, 2, 0, 3, 4]);
    // Mover o3 delante de o1 (índice 1) → 0, 3, 1, 2, 4.
    expect(sources(moveCommand(keysOf('o3'), 1).apply(fivePages()))).toEqual([0, 3, 1, 2, 4]);
  });

  it('dentro del bloque seleccionado no cambia el orden relativo', () => {
    expect(sources(moveCommand(keysOf('o1', 'o2'), 2).apply(fivePages()))).toEqual([0, 1, 2, 3, 4]);
  });

  it('toIndex fuera de [0, n] lanza RangeError', () => {
    const plan = fivePages();
    expect(() => moveCommand(keysOf('o0'), -1).apply(plan)).toThrow(RangeError);
    expect(() => moveCommand(keysOf('o0'), 6).apply(plan)).toThrow(RangeError);
    expect(() => moveCommand(keysOf('o0'), 1.5).apply(plan)).toThrow(RangeError);
  });

  it('tiene la etiqueta «mover páginas»', () => {
    expect(moveCommand(keysOf('o0'), 0).label).toBe('mover páginas');
  });
});

describe('deleteCommand y canDelete', () => {
  it('quita el hueco indicado', () => {
    const next = deleteCommand(keysOf('o1')).apply(fivePages());
    expect(next.slots).toHaveLength(4);
    expect(keys(next)).toEqual(['o0', 'o2', 'o3', 'o4']);
  });

  it('no permite quitar todas las páginas', () => {
    const plan = fivePages();
    const all = keysOf('o0', 'o1', 'o2', 'o3', 'o4');
    expect(canDelete(plan, all)).toBe(false);
    expect(canDelete(plan, keysOf('o0'))).toBe(true);
    expect(() => deleteCommand(all).apply(plan)).toThrow(RangeError);
  });

  it('tiene la etiqueta «eliminar páginas»', () => {
    expect(deleteCommand(keysOf('o0')).label).toBe('eliminar páginas');
  });
});

describe('insertBlankCommand', () => {
  it('inserta un hueco blank con clave b<n> en la posición indicada e incrementa nextKey', () => {
    const plan = fivePages();
    const next = insertBlankCommand(2, 595, 842).apply(plan);
    expect(next.slots[2]).toEqual({ key: 'b0', kind: 'blank', width: 595, height: 842, rotate: 0 });
    expect(next.slots).toHaveLength(6);
    expect(next.nextKey).toBe(plan.nextKey + 1);
  });

  it('rechaza tamaños no finitos o fuera de [1, 14400] y posiciones fuera de rango', () => {
    expect(() => insertBlankCommand(0, 0, 842)).toThrow(RangeError);
    expect(() => insertBlankCommand(0, 595, 14401)).toThrow(RangeError);
    expect(() => insertBlankCommand(0, Number.NaN, 842)).toThrow(RangeError);
    expect(() => insertBlankCommand(0, Number.POSITIVE_INFINITY, 842)).toThrow(RangeError);
    expect(() => insertBlankCommand(6, 595, 842).apply(fivePages())).toThrow(RangeError);
  });

  it('tiene la etiqueta «insertar página en blanco»', () => {
    expect(insertBlankCommand(0, 1, 1).label).toBe('insertar página en blanco');
  });
});

describe('insertImportedCommand', () => {
  it('inserta páginas importadas con fuentes 0..n-1 y giros dados', () => {
    const next = insertImportedCommand(1, 0, [0, 90]).apply(fivePages());
    const inserted = next.slots.slice(1, 3);
    expect(inserted).toEqual([
      { key: 'i0', kind: 'imported', doc: 0, source: 0, rotate: 0 },
      { key: 'i1', kind: 'imported', doc: 0, source: 1, rotate: 90 },
    ]);
    expect(next.nextKey).toBe(2);
  });

  it('las claves son únicas aunque se mezclen inserciones en blanco e importadas', () => {
    let plan = insertBlankCommand(0, 100, 100).apply(fivePages());
    plan = insertImportedCommand(0, 1, [0, 0]).apply(plan);
    plan = insertBlankCommand(0, 200, 200).apply(plan);
    const all = keys(plan);
    expect(new Set(all).size).toBe(all.length);
  });

  it('posición fuera de rango lanza RangeError', () => {
    expect(() => insertImportedCommand(-1, 0, [0]).apply(fivePages())).toThrow(RangeError);
  });

  it('tiene la etiqueta «insertar páginas»', () => {
    expect(insertImportedCommand(0, 0, [0]).label).toBe('insertar páginas');
  });
});

describe('selección', () => {
  const plan = fivePages();

  it('selectOnly fija clave, origen y foco', () => {
    const sel = selectOnly('o2');
    expect(sel.keys).toEqual(new Set(['o2']));
    expect(sel.anchor).toBe('o2');
    expect(sel.focus).toBe('o2');
  });

  it('extendTo selecciona el rango anchor..key sin mover el origen (en ambos sentidos)', () => {
    const sel = extendTo(plan, selectOnly('o2'), 'o4');
    expect(sel.keys).toEqual(new Set(['o2', 'o3', 'o4']));
    expect(sel.anchor).toBe('o2');
    expect(sel.focus).toBe('o4');

    const back = extendTo(plan, selectOnly('o3'), 'o1');
    expect(back.keys).toEqual(new Set(['o1', 'o2', 'o3']));
    expect(back.anchor).toBe('o3');
  });

  it('extendTo sin origen o con origen borrado se comporta como selectOnly', () => {
    expect(extendTo(plan, EMPTY_SELECTION, 'o1')).toEqual(selectOnly('o1'));
    const stale: PlanSelection = { keys: new Set(['zz']), anchor: 'zz', focus: 'zz' };
    expect(extendTo(plan, stale, 'o1')).toEqual(selectOnly('o1'));
  });

  it('extendTo con una clave que no está en el plan lanza RangeError', () => {
    expect(() => extendTo(plan, selectOnly('o0'), 'nope')).toThrow(RangeError);
  });

  it('toggleKey quita y pone la clave', () => {
    const on = toggleKey(selectOnly('o0'), 'o1');
    expect(on.keys).toEqual(new Set(['o0', 'o1']));
    expect(on.focus).toBe('o1');
    const off = toggleKey(on, 'o0');
    expect(off.keys).toEqual(new Set(['o1']));
  });

  it('selectAll selecciona todo con origen y foco en el primero', () => {
    const sel = selectAll(plan);
    expect(sel.keys.size).toBe(5);
    expect(sel.anchor).toBe('o0');
    expect(sel.focus).toBe('o0');
    expect(selectAll(initialPlan([])).focus).toBeNull();
  });

  it('pruneSelection quita claves borradas y deja a null el foco si ya no existe', () => {
    const sel: PlanSelection = { keys: new Set(['o0', 'o1', 'o9']), anchor: 'o9', focus: 'o9' };
    const pruned = pruneSelection(plan, sel);
    expect(pruned.keys).toEqual(new Set(['o0', 'o1']));
    expect(pruned.anchor).toBeNull();
    expect(pruned.focus).toBeNull();
    expect(pruneSelection(plan, selectOnly('o3'))).toEqual(selectOnly('o3'));
  });

  it('indexOfKey devuelve el índice o -1', () => {
    expect(indexOfKey(plan, 'o3')).toBe(3);
    expect(indexOfKey(plan, 'o77')).toBe(-1);
  });
});

describe('deshacer de todo el plan', () => {
  it('invert de cada comando restaura el plan anterior exacto', () => {
    const plan = fivePages();
    const commands = [
      rotateCommand(keysOf('o0'), 90),
      moveCommand(keysOf('o4'), 0),
      deleteCommand(keysOf('o2')),
      insertBlankCommand(1, 595, 842),
      insertImportedCommand(0, 0, [0, 180]),
    ];
    for (const cmd of commands) {
      const after = cmd.apply(plan);
      expect(cmd.invert(plan).apply(after)).toEqual(plan);
    }
  });

  it('la pila de deshacer tiene profundidad 30', () => {
    expect(ORGANIZE_UNDO_DEPTH).toBe(30);
  });
});

describe('rendimiento', () => {
  it('100 000 huecos: mover 1 000 claves y girar 50 000 terminan sin superar el timeout', () => {
    const big = initialPlan(Array.from({ length: 100_000 }, () => 0 as const));
    const moveKeys = new Set(Array.from({ length: 1000 }, (_, i) => `o${i * 50}`));
    const moved = moveCommand(moveKeys, 50_000).apply(big);
    expect(moved.slots).toHaveLength(100_000);

    const rotKeys = new Set(Array.from({ length: 50_000 }, (_, i) => `o${i}`));
    const rotated = rotateCommand(rotKeys, 90).apply(big);
    expect(rotated.slots[0]?.rotate).toBe(90);
    expect(selectAll(big).keys.size).toBe(100_000);
  });
});
