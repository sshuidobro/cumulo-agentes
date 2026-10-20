import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOX_PT,
  DEFAULT_LINE_PT,
  MIN_SHAPE_PT,
  dragBox,
  dragLine,
  resizeBoxRect,
} from '../../../src/core/annotations/shape-drag';
import type { RectPt } from '../../../src/core/annotations/model';

const PAGE: RectPt = [0, 0, 612, 792];

describe('dragBox (PDF-108)', () => {
  it('arrastre normal: caja entre los dos puntos, en cualquier dirección', () => {
    expect(dragBox(100, 100, 40, 160, false, PAGE)).toEqual([40, 100, 100, 160]);
    expect(dragBox(40, 160, 100, 100, false, PAGE)).toEqual([40, 100, 100, 160]);
  });

  it('Mayús (keepRatio): cuadrado del lado menor anclado en el punto inicial', () => {
    // Arrastre de 60 × 90: el lado menor es 60, y la caja sale hacia la izquierda y arriba del inicio.
    expect(dragBox(100, 100, 40, 190, true, PAGE)).toEqual([40, 100, 100, 160]);
    const [x1, y1, x2, y2] = dragBox(100, 100, 40, 190, true, PAGE);
    expect(x2 - x1).toBe(y2 - y1);
  });

  it('arrastre de 2 pt se convierte en la caja por defecto centrada en el punto', () => {
    const [x1, y1, x2, y2] = dragBox(300, 400, 302, 402, false, PAGE);
    expect(x2 - x1).toBe(DEFAULT_BOX_PT.width);
    expect(y2 - y1).toBe(DEFAULT_BOX_PT.height);
    expect((x1 + x2) / 2).toBe(300);
    expect((y1 + y2) / 2).toBe(400);
  });

  it('nunca sale de la página: el arrastre se recorta a sus bordes', () => {
    const [x1, y1, x2, y2] = dragBox(-50, 700, 900, 1000, false, PAGE);
    expect(x1).toBe(0);
    expect(y1).toBe(700);
    expect(x2).toBe(612);
    expect(y2).toBe(792);
  });

  it('la caja por defecto junto al borde también se recorta a la página', () => {
    const [x1, , x2] = dragBox(5, 400, 5, 400, false, PAGE);
    expect(x1).toBe(0);
    expect(x2).toBe(5 + DEFAULT_BOX_PT.width / 2);
  });

  it('Mayús con un lado menor que el mínimo usa la caja por defecto', () => {
    const [x1, y1, x2, y2] = dragBox(200, 200, 201, 300, true, PAGE);
    expect(x2 - x1).toBe(DEFAULT_BOX_PT.width);
    expect(y2 - y1).toBe(DEFAULT_BOX_PT.height);
  });

  it('un arrastre de exactamente MIN_SHAPE_PT en un eje ya no es clic', () => {
    const [x1, , x2] = dragBox(100, 100, 100 + MIN_SHAPE_PT, 100, false, PAGE);
    expect(x2 - x1).toBe(MIN_SHAPE_PT);
  });
});

describe('dragLine (PDF-108)', () => {
  it('Mayús ajusta el ángulo a múltiplos de 45° sin cambiar la longitud (0,0)→(100,90)', () => {
    const [x1, y1, x2, y2] = dragLine(0, 0, 100, 90, true, PAGE);
    expect(x1).toBe(0);
    expect(y1).toBe(0);
    expect(Math.abs(x2 - y2)).toBeLessThan(1e-9);
    expect(Math.hypot(x2, y2)).toBeCloseTo(Math.hypot(100, 90), 9);
  });

  it('sin Mayús conserva los puntos del arrastre', () => {
    expect(dragLine(10, 20, 110, 90, false, PAGE)).toEqual([10, 20, 110, 90]);
  });

  it('arrastre menor que el mínimo: línea horizontal de DEFAULT_LINE_PT desde el punto', () => {
    expect(dragLine(100, 100, 101, 101, false, PAGE)).toEqual([100, 100, 100 + DEFAULT_LINE_PT, 100]);
  });

  it('los extremos se recortan a la página', () => {
    const [x1, y1, x2, y2] = dragLine(-20, 50, 900, 900, false, PAGE);
    expect(x1).toBe(0);
    expect(y1).toBe(50);
    expect(x2).toBe(612);
    expect(y2).toBe(792);
  });
});

describe('resizeBoxRect (PDF-108)', () => {
  it('la esquina superior izquierda queda fija al crecer', () => {
    // Caja [10, 20, 110, 80]: su esquina superior izquierda es (10, 80). Ancho 100 + 30, alto 60 + 20.
    expect(resizeBoxRect([10, 20, 110, 80], 30, 20)).toEqual([10, 0, 140, 80]);
  });

  it('dh negativo la hace más baja, sin bajar del mínimo', () => {
    const [x1, y1, x2, y2] = resizeBoxRect([10, 20, 110, 80], -1000, -1000);
    expect(x2 - x1).toBe(MIN_SHAPE_PT);
    expect(y2 - y1).toBe(MIN_SHAPE_PT);
    expect(x1).toBe(10);
    expect(y2).toBe(80);
  });
});
