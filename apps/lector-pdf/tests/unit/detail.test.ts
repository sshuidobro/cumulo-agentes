import { describe, expect, it } from 'vitest';
import { planCanvas, MAX_CANVAS_PIXELS } from '../../src/core/canvas-size';
import {
  DETAIL_MARGIN,
  detailRect,
  needsRedraw,
  planDetail,
  visibleInFrame,
} from '../../src/core/detail';

describe('visibleInFrame', () => {
  it('devuelve la intersección relativa al marco', () => {
    expect(
      visibleInFrame({ x: 100, y: 1000, width: 800, height: 1000 }, { x: 0, y: 1500, width: 600, height: 400 }),
    ).toEqual({ x: 0, y: 500, width: 500, height: 400 });
  });

  it('devuelve null sin intersección o si solo se tocan los bordes', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100 };
    expect(visibleInFrame(frame, { x: 200, y: 0, width: 50, height: 50 })).toBeNull();
    expect(visibleInFrame(frame, { x: 100, y: 0, width: 50, height: 50 })).toBeNull();
    expect(visibleInFrame(frame, { x: 0, y: -50, width: 100, height: 50 })).toBeNull();
  });

  it('no lanza con tamaños 0 y devuelve null', () => {
    expect(visibleInFrame({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
    expect(visibleInFrame({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });

  it('una página que cubre el visor entero devuelve el visor', () => {
    expect(
      visibleInFrame({ x: -50, y: -50, width: 5000, height: 5000 }, { x: 0, y: 0, width: 1280, height: 800 }),
    ).toEqual({ x: 50, y: 50, width: 1280, height: 800 });
  });

  it('rechaza valores no finitos o tamaños negativos', () => {
    expect(() =>
      visibleInFrame({ x: Number.NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }),
    ).toThrow(RangeError);
    expect(() =>
      visibleInFrame({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }),
    ).toThrow(RangeError);
    expect(() =>
      visibleInFrame({ x: 0, y: 0, width: -1, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }),
    ).toThrow(RangeError);
  });
});

describe('detailRect', () => {
  it('amplía el margen por lado, recorta al marco y redondea hacia fuera', () => {
    expect(detailRect({ width: 800, height: 1000 }, { x: 0, y: 500, width: 500, height: 400 })).toEqual({
      x: 0,
      y: 400,
      width: 625,
      height: 600,
    });
  });

  it('el margen es DETAIL_MARGIN de la zona visible en cada lado', () => {
    expect(DETAIL_MARGIN).toBe(0.25);
    expect(detailRect({ width: 10000, height: 10000 }, { x: 1000, y: 2000, width: 400, height: 200 })).toEqual({
      x: 900,
      y: 1950,
      width: 600,
      height: 300,
    });
  });

  it('redondea hacia fuera a píxeles enteros', () => {
    const rect = detailRect({ width: 10000, height: 10000 }, { x: 10.3, y: 20.7, width: 9.1, height: 3.3 });
    expect(Number.isInteger(rect.x)).toBe(true);
    expect(Number.isInteger(rect.y)).toBe(true);
    expect(Number.isInteger(rect.width)).toBe(true);
    expect(Number.isInteger(rect.height)).toBe(true);
    expect(rect.x).toBeLessThanOrEqual(10.3 - 9.1 * DETAIL_MARGIN);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(10.3 + 9.1 + 9.1 * DETAIL_MARGIN);
    expect(rect.y).toBeLessThanOrEqual(20.7 - 3.3 * DETAIL_MARGIN);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(20.7 + 3.3 + 3.3 * DETAIL_MARGIN);
  });

  it('nunca sale del marco', () => {
    const rect = detailRect({ width: 100, height: 100 }, { x: 90, y: 90, width: 10, height: 10 });
    expect(rect).toEqual({ x: 87, y: 87, width: 13, height: 13 });
    const outside = detailRect({ width: 100, height: 100 }, { x: 500, y: 500, width: 10, height: 10 });
    expect(outside.x).toBeGreaterThanOrEqual(0);
    expect(outside.x + outside.width).toBeLessThanOrEqual(100);
    expect(outside.y + outside.height).toBeLessThanOrEqual(100);
  });

  it('no lanza con rectángulos de tamaño 0', () => {
    expect(detailRect({ width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(() => detailRect({ width: 100, height: 100 }, { x: 10, y: 10, width: 0, height: 0 })).not.toThrow();
  });

  it('rechaza valores no finitos', () => {
    expect(() => detailRect({ width: Number.NaN, height: 10 }, { x: 0, y: 0, width: 1, height: 1 })).toThrow(
      RangeError,
    );
    expect(() => detailRect({ width: 10, height: 10 }, { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 })).toThrow(
      RangeError,
    );
  });
});

describe('planDetail', () => {
  const A4_PT = { width: 595, height: 842 };
  const cssA4 = { width: (A4_PT.width * 4) / 3, height: (A4_PT.height * 4) / 3 };
  const frame = { x: 0, y: 0, width: 25400, height: 35900 };
  const viewport = { x: 0, y: 0, width: 1280, height: 800 };

  it('devuelve null si el lienzo base no está limitado', () => {
    const base = planCanvas(800, 1000, 1);
    expect(base.capped).toBe(false);
    expect(planDetail(base, { x: 0, y: 0, width: 800, height: 1000 }, viewport, 1)).toBeNull();
  });

  it('devuelve null si la página no se ve en el visor', () => {
    const base = planCanvas(25400, 35900, 1);
    expect(planDetail(base, frame, { x: 0, y: 40000, width: 1280, height: 800 }, 1)).toBeNull();
  });

  it('a 3 200 % de A4 el lienzo de detalle tiene densidad 1 y cumple el límite de píxeles', () => {
    const cssWidth = Math.round(cssA4.width * 32);
    const cssHeight = Math.round(cssA4.height * 32);
    expect(cssWidth).toBeGreaterThan(25000);
    expect(cssHeight).toBeGreaterThan(35000);
    const base = planCanvas(cssWidth, cssHeight, 1);
    expect(base.capped).toBe(true);
    const plan = planDetail(base, { x: 0, y: 0, width: cssWidth, height: cssHeight }, viewport, 1);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(plan.canvas.capped).toBe(false);
    expect(plan.canvas.outputScale).toBe(1);
    expect(plan.canvas.width).toBe(plan.rect.width);
    expect(plan.canvas.height).toBe(plan.rect.height);
    expect(plan.canvas.width * plan.canvas.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  it('usa la zona visible ampliada y el lienzo se calcula con planCanvas sobre rect', () => {
    const base = planCanvas(25400, 35900, 2);
    expect(base.capped).toBe(true);
    const plan = planDetail(base, frame, viewport, 2);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    // Visible 1280 × 800 en el origen: solo se añade margen por la derecha y por abajo.
    expect(plan.rect).toEqual({ x: 0, y: 0, width: 1600, height: 1000 });
    expect(plan.canvas).toEqual(planCanvas(plan.rect.width, plan.rect.height, 2));
    expect(plan.canvas.capped).toBe(false);
  });
});

describe('needsRedraw', () => {
  const drawn = { x: 0, y: 0, width: 100, height: 100 };

  it('no redibuja si la zona visible está contenida', () => {
    expect(needsRedraw(drawn, { x: 10, y: 10, width: 50, height: 50 })).toBe(false);
    expect(needsRedraw(drawn, drawn)).toBe(false);
  });

  it('redibuja si asoma 1 px por cualquier lado', () => {
    expect(needsRedraw(drawn, { x: -1, y: 0, width: 50, height: 50 })).toBe(true);
    expect(needsRedraw(drawn, { x: 0, y: -1, width: 50, height: 50 })).toBe(true);
    expect(needsRedraw(drawn, { x: 60, y: 0, width: 41, height: 50 })).toBe(true);
    expect(needsRedraw(drawn, { x: 0, y: 60, width: 50, height: 41 })).toBe(true);
  });

  it('rechaza valores no finitos', () => {
    expect(() => needsRedraw(drawn, { x: 0, y: 0, width: Number.NaN, height: 1 })).toThrow(RangeError);
  });
});
