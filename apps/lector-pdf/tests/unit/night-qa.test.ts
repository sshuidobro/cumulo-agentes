import { describe, expect, it } from 'vitest';
import { applyNightMode, imageRects, IDENTITY } from '../../src/core/night';

describe('QA modo noche: casos límite', () => {
  it('lienzo vacío 0x0 no lanza', () => {
    expect(() => applyNightMode(new Uint8ClampedArray(0), 0, 0, [])).not.toThrow();
  });
  it('keep con rectángulos solapados deja intactos sus píxeles', () => {
    const d = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    applyNightMode(d, 4, 4, [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 1, y: 1, width: 2, height: 2 },
    ]);
    expect(Array.from(d.slice(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(d.slice((2 * 4 + 2) * 4, (2 * 4 + 2) * 4 + 3))).toEqual([255, 255, 255]);
    expect(Array.from(d.slice((3 * 4 + 3) * 4, (3 * 4 + 3) * 4 + 3))).toEqual([31, 31, 35]);
  });
  it('imagen fuera del lienzo no produce rectángulo', () => {
    expect(imageRects([{ kind: 'image', m: [10, 0, 0, 10, 500, 500] }], IDENTITY, 100, 100)).toEqual([]);
    expect(imageRects([{ kind: 'image', m: [10, 0, 0, 10, -50, -50] }], IDENTITY, 100, 100)).toEqual([]);
  });
});
