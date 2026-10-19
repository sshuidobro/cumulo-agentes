import { describe, expect, it } from 'vitest';
import { diffSequences, type DiffOp } from '../../../src/core/compare/diff';

/** Reconstruye `b` desde `a` aplicando las operaciones y comprueba que cubren ambas listas sin huecos. */
function applyOps(a: readonly string[], b: readonly string[], ops: readonly DiffOp[]): string[] {
  const out: string[] = [];
  let aPos = 0;
  let bPos = 0;
  for (const op of ops) {
    expect(op.aStart).toBe(aPos);
    expect(op.bStart).toBe(bPos);
    if (op.kind === 'equal') {
      expect(op.aEnd - op.aStart).toBe(op.bEnd - op.bStart);
      for (let i = op.aStart; i < op.aEnd; i++) {
        expect(a[i]).toBe(b[op.bStart + i - op.aStart]);
        out.push(a[i] ?? '');
      }
    } else if (op.kind === 'delete') {
      expect(op.bStart).toBe(op.bEnd);
    } else {
      expect(op.aStart).toBe(op.aEnd);
      for (let j = op.bStart; j < op.bEnd; j++) out.push(b[j] ?? '');
    }
    aPos = op.aEnd;
    bPos = op.bEnd;
  }
  expect(aPos).toBe(a.length);
  expect(bPos).toBe(b.length);
  return out;
}

/** Número mínimo de ediciones (inserciones + borrados) por programación dinámica sobre la LCS. */
function minimalEdits(a: readonly string[], b: readonly string[]): number {
  // lcs[i][j] = longitud de la LCS de a[i..] y b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  const at = (i: number, j: number): number => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i];
    if (row === undefined) continue;
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return a.length + b.length - 2 * at(0, 0);
}

function editsOf(ops: readonly DiffOp[]): number {
  return ops.reduce((sum, op) => (op.kind === 'equal' ? sum : sum + (op.aEnd - op.aStart) + (op.bEnd - op.bStart)), 0);
}

/** Generador pseudoaleatorio determinista (mulberry32), para que las pruebas sean reproducibles. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('diffSequences', () => {
  it('dos listas vacías no tienen operaciones', () => {
    expect(diffSequences([], [], 10)).toEqual([]);
  });

  it('listas iguales: una sola operación equal', () => {
    expect(diffSequences(['a', 'b'], ['a', 'b'], 0)).toEqual([{ kind: 'equal', aStart: 0, aEnd: 2, bStart: 0, bEnd: 2 }]);
  });

  it('a vacía: todo es inserción', () => {
    const ops = diffSequences([], ['x', 'y'], 10);
    expect(ops).toEqual([{ kind: 'insert', aStart: 0, aEnd: 0, bStart: 0, bEnd: 2 }]);
  });

  it('b vacía: todo es borrado', () => {
    const ops = diffSequences(['x', 'y'], [], 10);
    expect(ops).toEqual([{ kind: 'delete', aStart: 0, aEnd: 2, bStart: 0, bEnd: 0 }]);
  });

  it('todo distinto: borrado seguido de inserción', () => {
    const ops = diffSequences(['a', 'b'], ['c', 'd'], 10);
    expect(ops).not.toBeNull();
    expect(applyOps(['a', 'b'], ['c', 'd'], ops ?? [])).toEqual(['c', 'd']);
    expect(editsOf(ops ?? [])).toBe(4);
  });

  it('inserción al principio y al final', () => {
    const start = diffSequences(['b', 'c'], ['a', 'b', 'c'], 10) ?? [];
    expect(start).toEqual([
      { kind: 'insert', aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 },
      { kind: 'equal', aStart: 0, aEnd: 2, bStart: 1, bEnd: 3 },
    ]);
    const end = diffSequences(['a', 'b'], ['a', 'b', 'c'], 10) ?? [];
    expect(end).toEqual([
      { kind: 'equal', aStart: 0, aEnd: 2, bStart: 0, bEnd: 2 },
      { kind: 'insert', aStart: 2, aEnd: 2, bStart: 2, bEnd: 3 },
    ]);
  });

  it('cambio de una palabra en medio: equal, delete, insert, equal', () => {
    const a = ['Página', '2', 'de', '5'];
    const b = ['Hoja', '2', 'de', '5'];
    const ops = diffSequences(a, b, 10) ?? [];
    expect(ops.map((op) => op.kind)).toEqual(['delete', 'insert', 'equal']);
    expect(applyOps(a, b, ops)).toEqual(b);
  });

  it('devuelve null si hacen falta más de maxD ediciones', () => {
    expect(diffSequences(['a', 'b', 'c'], ['x', 'y', 'z'], 5)).toBeNull();
    expect(diffSequences(['a', 'b', 'c'], ['x', 'y', 'z'], 6)).not.toBeNull();
    expect(diffSequences(['a'], ['b'], 0)).toBeNull();
  });

  it('coincide con la distancia mínima y reconstruye b en 300 casos aleatorios deterministas', () => {
    const random = seeded(20261019);
    const alphabet = ['a', 'b', 'c', 'd'];
    const randomList = (max: number): string[] => {
      const length = Math.floor(random() * (max + 1));
      return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)] ?? 'a');
    };

    for (let i = 0; i < 300; i++) {
      const a = randomList(12);
      const b = randomList(12);
      const expected = minimalEdits(a, b);
      const ops = diffSequences(a, b, expected);
      expect(ops, `caso ${String(i)}`).not.toBeNull();
      const merged = applyOps(a, b, ops ?? []);
      expect(merged, `caso ${String(i)}`).toEqual(b);
      expect(editsOf(ops ?? []), `caso ${String(i)}`).toBe(expected);
      if (expected > 0) {
        expect(diffSequences(a, b, expected - 1), `caso ${String(i)}`).toBeNull();
      }
    }
  });

  it('fusiona operaciones contiguas del mismo tipo', () => {
    const ops = diffSequences(['a', 'x', 'y', 'b'], ['a', 'p', 'q', 'b'], 10) ?? [];
    expect(ops).toEqual([
      { kind: 'equal', aStart: 0, aEnd: 1, bStart: 0, bEnd: 1 },
      { kind: 'delete', aStart: 1, aEnd: 3, bStart: 1, bEnd: 1 },
      { kind: 'insert', aStart: 3, aEnd: 3, bStart: 1, bEnd: 3 },
      { kind: 'equal', aStart: 3, aEnd: 4, bStart: 3, bEnd: 4 },
    ]);
  });
});
