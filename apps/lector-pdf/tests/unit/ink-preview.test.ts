// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawInkSegments, prepareInkCanvas } from '../../src/ui/viewer/ink-preview';

/** Contexto 2D simulado: registra las llamadas de dibujo (jsdom no dibuja). */
function fakeContext() {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '#000',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drawInkSegments (PDF-076)', () => {
  it('dibuja solo los segmentos nuevos en cada llamada, unidos con el último punto dibujado', () => {
    const ctx = fakeContext();
    const points: number[] = [];
    let drawn = 0;
    // 100 lotes de 40 coordenadas (20 puntos) cada uno: 2 000 puntos en total.
    for (let batch = 0; batch < 100; batch += 1) {
      for (let i = 0; i < 40; i += 1) points.push(batch * 40 + i);
      drawn = drawInkSegments(ctx, points, drawn);
    }

    expect(drawn).toBe(4000);
    // El primer lote tiene 19 segmentos; cada lote siguiente, 20 (el enlace con el último punto anterior incluido).
    expect(ctx.lineTo).toHaveBeenCalledTimes(1999);
    expect(ctx.moveTo).toHaveBeenCalledTimes(100);
    expect(ctx.stroke).toHaveBeenCalledTimes(100);
    // El moveTo del lote k (k ≥ 1) es el último punto del lote k − 1.
    for (let k = 1; k < 100; k += 1) {
      expect(ctx.moveTo.mock.calls[k]).toEqual([points[40 * k - 2], points[40 * k - 1]]);
    }
  });

  it('con un solo punto no dibuja nada y devuelve el progreso recibido', () => {
    const ctx = fakeContext();
    expect(drawInkSegments(ctx, [5, 6], 0)).toBe(0);
    expect(drawInkSegments(ctx, [5, 6], 2)).toBe(2);
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

describe('prepareInkCanvas (PDF-076)', () => {
  it('ajusta el lienzo al viewport y al devicePixelRatio, y deja el contexto en coordenadas PDF con el estilo', () => {
    const ctx = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D,
    );
    const canvas = document.createElement('canvas');

    const result = prepareInkCanvas(
      canvas,
      { width: 100, height: 50, transform: [2, 0, 0, -2, 0, 100] },
      1.5,
      { color: 'rgb(230 56 54)', widthPt: 2 },
    );

    expect(result).toBe(ctx);
    expect(canvas.width).toBe(150);
    expect(canvas.height).toBe(75);
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.height).toBe('50px');
    expect(ctx.setTransform).toHaveBeenCalledWith(3, 0, 0, -3, 0, 150);
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.strokeStyle).toBe('rgb(230 56 54)');
  });

  it('sin contexto 2D devuelve null', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const canvas = document.createElement('canvas');
    const result = prepareInkCanvas(canvas, { width: 100, height: 50, transform: [1, 0, 0, 1, 0, 0] }, 1, {
      color: '#000',
      widthPt: 1,
    });
    expect(result).toBeNull();
  });
});
