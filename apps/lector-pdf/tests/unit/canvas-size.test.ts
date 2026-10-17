import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_DIM, MAX_CANVAS_PIXELS, planCanvas } from '../../src/core/canvas-size';

describe('planCanvas', () => {
  it('usa la densidad de pantalla cuando el lienzo cabe', () => {
    expect(planCanvas(612, 792, 2)).toEqual({
      width: 1224,
      height: 1584,
      outputScale: 2,
      capped: false,
    });
  });

  it('nunca usa menos de 1 píxel por píxel CSS', () => {
    expect(planCanvas(612, 792, 0.5)).toEqual({
      width: 612,
      height: 792,
      outputScale: 1,
      capped: false,
    });
    expect(planCanvas(612, 792, Number.NaN)).toEqual({
      width: 612,
      height: 792,
      outputScale: 1,
      capped: false,
    });
    expect(planCanvas(612, 792, Number.POSITIVE_INFINITY)).toEqual({
      width: 612,
      height: 792,
      outputScale: 1,
      capped: false,
    });
  });

  it('reduce la escala para respetar el máximo de píxeles', () => {
    const plan = planCanvas(612 * 8, 792 * 8, 2);
    expect(plan.capped).toBe(true);
    expect(plan.outputScale).toBeLessThan(2);
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(plan.width * plan.height).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
  });

  it('respeta el lado máximo aunque el área quepa', () => {
    const plan = planCanvas(40000, 10, 1);
    expect(plan.width).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(plan.width).toBe(MAX_CANVAS_DIM);
    expect(plan.height).toBeGreaterThanOrEqual(1);
    expect(plan.capped).toBe(true);
  });

  it('limita también el alto', () => {
    const plan = planCanvas(10, 40000, 1);
    expect(plan.height).toBe(MAX_CANVAS_DIM);
    expect(plan.width).toBeGreaterThanOrEqual(1);
    expect(plan.capped).toBe(true);
  });

  it('nunca devuelve un lienzo de 0 píxeles', () => {
    const plan = planCanvas(0, 0, 1);
    expect(plan.width).toBe(1);
    expect(plan.height).toBe(1);
  });

  it('cumple el límite de píxeles en tamaños muy grandes y densidades altas', () => {
    for (const [w, h, dpr] of [
      [4896, 6336, 2],
      [20000, 20000, 3],
      [1000, 30000, 4],
      [3, 2000000, 2],
    ] as const) {
      const plan = planCanvas(w, h, dpr);
      expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      expect(plan.width).toBeLessThanOrEqual(MAX_CANVAS_DIM);
      expect(plan.height).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    }
  });

  it('rechaza tamaños negativos o no finitos', () => {
    expect(() => planCanvas(-1, 10, 1)).toThrow(RangeError);
    expect(() => planCanvas(10, Number.NaN, 1)).toThrow(RangeError);
    expect(() => planCanvas(Number.POSITIVE_INFINITY, 10, 1)).toThrow(RangeError);
  });
});
