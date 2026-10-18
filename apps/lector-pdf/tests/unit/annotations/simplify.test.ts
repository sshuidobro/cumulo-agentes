import { describe, expect, it } from 'vitest';
import { newInkAnnotation } from '../../../src/core/annotations/ink';
import { rectFromPaths } from '../../../src/core/annotations/model';
import { simplifyPath } from '../../../src/core/annotations/simplify';

/** Puntos planos `[x0, y0, ...]` a partir de pares. */
function flat(pairs: readonly (readonly [number, number])[]): number[] {
  return pairs.flatMap(([x, y]) => [x, y]);
}

/** Pares `[x, y]` de un trazo plano. */
function pairsOf(path: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < path.length; i += 2) out.push([path[i] ?? NaN, path[i + 1] ?? NaN]);
  return out;
}

/** Ruido determinista en [-amplitude, amplitude] (generador lineal congruencial; sin Math.random). */
function noise(seed: number, amplitude: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state / 2_147_483_648 * 2 - 1) * amplitude;
  };
}

describe('simplifyPath', () => {
  it('una recta muestreada con ruido de 0,05 pt se reduce a sus dos extremos', () => {
    const rnd = noise(7, 0.05);
    const pts: [number, number][] = [];
    for (let i = 0; i < 1000; i++) pts.push([i, 2 * i + rnd()]);
    const out = simplifyPath(flat(pts), 0.5);
    expect(pairsOf(out)).toHaveLength(2);
    expect(pairsOf(out)[0]?.[0]).toBe(0);
    expect(pairsOf(out)[1]?.[0]).toBe(999);
  });

  it('un cuadrado muestreado conserva sus cuatro esquinas (±0,5 pt)', () => {
    const corners: [number, number][] = [
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0],
    ];
    const samples: [number, number][] = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i] ?? [0, 0];
      const b = corners[(i + 1) % corners.length] ?? [0, 0];
      for (let k = 0; k < 50; k++) samples.push([a[0] + ((b[0] - a[0]) * k) / 50, a[1] + ((b[1] - a[1]) * k) / 50]);
    }
    samples.push(corners[0] ?? [0, 0]);
    const out = pairsOf(simplifyPath(flat(samples), 0.5));
    for (const [cx, cy] of corners) {
      const found = out.some(([x, y]) => Math.abs(x - cx) <= 0.5 && Math.abs(y - cy) <= 0.5);
      expect(found, `esquina (${cx}, ${cy})`).toBe(true);
    }
  });

  it('100 000 puntos se simplifican sin desbordar la pila', () => {
    const pts: number[] = [];
    for (let i = 0; i < 100_000; i++) pts.push(i % 1000, Math.sin(i / 50) * 300);
    expect(() => simplifyPath(pts, 0.5)).not.toThrow();
    const out = simplifyPath(pts, 0.5);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThan(pts.length);
    expect(out.slice(0, 2)).toEqual(pts.slice(0, 2));
    expect(out.slice(-2)).toEqual(pts.slice(-2));
  });

  it('con 0 o 1 punto devuelve la entrada tal cual', () => {
    expect(simplifyPath([], 0.5)).toEqual([]);
    expect(simplifyPath([3, 4], 0.5)).toEqual([3, 4]);
  });

  it('con 2 puntos devuelve los 2 puntos', () => {
    expect(simplifyPath([0, 0, 10, 10], 0.5)).toEqual([0, 0, 10, 10]);
  });

  it('una tolerancia de 0 conserva todos los puntos que se desvían', () => {
    const zigzag = flat([
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 1],
    ]);
    expect(simplifyPath(zigzag, 0)).toEqual(zigzag);
  });

  it('no modifica la entrada', () => {
    const input = flat([
      [0, 0],
      [5, 1],
      [10, 0],
    ]);
    const copy = [...input];
    simplifyPath(input, 0.5);
    expect(input).toEqual(copy);
  });
});

describe('newInkAnnotation', () => {
  it('la caja contiene todos los puntos y se amplía la mitad del grosor más 1 pt', () => {
    const paths = [[10, 20, 30, 5, 50, 40]];
    const a = newInkAnnotation({
      id: 'suite-ink-1',
      pageIndex: 0,
      paths,
      width: 4,
      color: [1, 0, 0],
      author: 'Usuario',
      now: '2026-10-18T10:00:00.000Z',
    });
    expect(a.type).toBe('ink');
    expect(a.rect).toEqual(rectFromPaths(paths, 3));
    expect(a.rect).toEqual([7, 2, 53, 43]);
    expect(a.opacity).toBe(1);
    expect(a.origin).toEqual({ kind: 'new' });
  });
});
