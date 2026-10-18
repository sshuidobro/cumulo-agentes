import { describe, expect, it } from 'vitest';
import { freeTextBox, pdfPointToPx } from '../../../src/ui/viewer/freetext-box';

describe('caja del editor de texto libre', () => {
  it('sin rotación, la caja mide el rectángulo × escala y la matriz solo traslada a la esquina superior', () => {
    // Escala 2, página de 792 pt de alto: y_px = (792 - y_pt) × 2.
    const box = freeTextBox([100, 700, 300, 720], [2, 0, 0, -2, 0, 1584]);
    expect(box.width).toBeCloseTo(400, 10);
    expect(box.height).toBeCloseTo(40, 10);
    expect(box.scale).toBe(2);
    expect(box.matrix).toEqual([1, 0, 0, 1, 200, 144]);
  });

  it('con rotación de 90 grados, la caja sigue midiendo lo mismo y la matriz gira los ejes', () => {
    // Transformación de una página girada 90 grados: (x, y) → (2y, 2x).
    const box = freeTextBox([100, 700, 300, 720], [0, 2, 2, 0, 0, 0]);
    expect(box.width).toBeCloseTo(400, 10);
    expect(box.height).toBeCloseTo(40, 10);
    const [ex = NaN, ey = NaN, fx = NaN, fy = NaN] = box.matrix;
    expect(ex * ex + ey * ey).toBeCloseTo(1, 10);
    expect(fx * fx + fy * fy).toBeCloseTo(1, 10);
    expect(ex * fx + ey * fy).toBeCloseTo(0, 10);
  });

  it('un punto PDF se proyecta con la matriz de la página', () => {
    expect(pdfPointToPx([2, 0, 0, -2, 10, 1584], 100, 700)).toEqual([210, 184]);
  });
});
