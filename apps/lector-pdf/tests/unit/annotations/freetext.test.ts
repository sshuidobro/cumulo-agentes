import { describe, expect, it } from 'vitest';
import {
  FREETEXT_MIN_WIDTH_PT,
  fitFreeTextRect,
  freeTextClickRect,
  freeTextDragRect,
  freeTextMinHeight,
  freeTextOneLineHeight,
  freeTextRequiredHeight,
  isBlankText,
  newFreeTextAnnotation,
  resizeFreeTextRect,
} from '../../../src/core/annotations/freetext';
import type { RectPt } from '../../../src/core/annotations/model';

const PAGE: RectPt = [0, 0, 612, 792];

describe('texto libre · tamaños de referencia', () => {
  it('una línea mide fontSize × 1,15 + 4 y el mínimo fontSize + 4', () => {
    expect(freeTextOneLineHeight(12)).toBeCloseTo(17.8, 10);
    expect(freeTextMinHeight(12)).toBe(16);
  });

  it('el alto necesario crece con cada línea que produce wrapText', () => {
    const one = freeTextRequiredHeight('Hola', 100, 12);
    const many = freeTextRequiredHeight('palabra '.repeat(30), 100, 12);
    expect(one).toBeCloseTo(17.8, 10);
    expect(many).toBeGreaterThan(one * 3);
  });
});

describe('texto libre · creación con clic y arrastre', () => {
  it('un clic crea 200 pt de ancho con la esquina superior izquierda en el punto', () => {
    expect(freeTextClickRect(100, 700, 12, PAGE)).toEqual([100, 700 - 17.8, 300, 700]);
  });

  it('un clic cerca del borde se desplaza hacia dentro de la página', () => {
    const [x1, y1, x2, y2] = freeTextClickRect(600, 5, 12, PAGE);
    expect(x2).toBe(612);
    expect(x1).toBe(412);
    expect(y1).toBeCloseTo(0, 10);
    expect(y2).toBeCloseTo(17.8, 10);
  });

  it('arrastrar crea el rectángulo entre las dos esquinas, en cualquier orden', () => {
    expect(freeTextDragRect(10, 100, 50, 10, 12)).toEqual([10, 10, 50, 100]);
    expect(freeTextDragRect(50, 10, 10, 100, 12)).toEqual([10, 10, 50, 100]);
  });

  it('un arrastrado nunca es más pequeño que el mínimo (20 pt de ancho, fontSize + 4 de alto)', () => {
    const [x1, y1, x2, y2] = freeTextDragRect(10, 10, 12, 11, 12);
    expect(x2 - x1).toBe(FREETEXT_MIN_WIDTH_PT);
    expect(y2 - y1).toBe(16);
  });
});

describe('texto libre · redimensionar', () => {
  it('cambia el ancho hacia la derecha y el alto hacia abajo, con la esquina superior izquierda fija', () => {
    expect(resizeFreeTextRect([10, 20, 110, 40], 3, 0, 12)).toEqual([10, 20, 113, 40]);
    expect(resizeFreeTextRect([10, 20, 110, 40], 0, 5, 12)).toEqual([10, 15, 110, 40]);
  });

  it('no baja de 20 pt de ancho ni de fontSize + 4 de alto', () => {
    expect(resizeFreeTextRect([10, 20, 110, 40], -500, 0, 12)).toEqual([10, 20, 30, 40]);
    expect(resizeFreeTextRect([10, 20, 110, 40], 0, -500, 12)).toEqual([10, 24, 110, 40]);
  });
});

describe('texto libre · el cuadro crece con el texto sin pasar de la página', () => {
  it('si el texto cabe, el cuadro no cambia', () => {
    const rect: RectPt = [10, 700, 110, 730];
    expect(fitFreeTextRect(rect, 'Hola', 12, 0)).toBe(rect);
  });

  it('si no cabe, crece hacia abajo y conserva la esquina superior', () => {
    const grown = fitFreeTextRect([10, 700, 110, 718], 'palabra '.repeat(40), 12, 0);
    expect(grown[3]).toBe(718);
    expect(grown[1]).toBeLessThan(700);
    expect(grown[0]).toBe(10);
    expect(grown[2]).toBe(110);
  });

  it('nunca pasa del borde inferior de la página (floor)', () => {
    const grown = fitFreeTextRect([10, 40, 110, 58], 'palabra '.repeat(200), 12, 30);
    expect(grown[1]).toBe(30);
  });

  it('nunca encoge un cuadro que ya es más alto que el texto', () => {
    const rect: RectPt = [10, 100, 110, 300];
    expect(fitFreeTextRect(rect, 'x', 12, 0)).toEqual(rect);
  });
});

describe('texto libre · texto vacío y creación del modelo', () => {
  it('son vacíos los textos sin caracteres visibles (espacios, saltos de línea)', () => {
    expect(isBlankText('')).toBe(true);
    expect(isBlankText(' \n\t ')).toBe(true);
    expect(isBlankText(' a ')).toBe(false);
  });

  it('un texto libre nuevo es de origen «new», sin texto por defecto y con opacidad plena', () => {
    const a = newFreeTextAnnotation({
      id: 'suite-x',
      pageIndex: 2,
      rect: [1, 2, 3, 4],
      fontSize: 14,
      color: [1, 0, 0],
      textColor: [0, 0, 1],
      author: 'Ana',
      now: '2026-10-18T10:00:00.000Z',
    });
    expect(a).toMatchObject({
      type: 'freetext',
      pageIndex: 2,
      contents: '',
      fontSize: 14,
      textColor: [0, 0, 1],
      color: [1, 0, 0],
      opacity: 1,
      origin: { kind: 'new' },
      created: '2026-10-18T10:00:00.000Z',
    });
    expect('borderless' in a).toBe(false);
  });

  it('con borderless: true, la copia lo conserva', () => {
    const a = newFreeTextAnnotation({
      id: 'suite-y',
      pageIndex: 0,
      rect: [1, 2, 3, 4],
      fontSize: 12,
      color: [0, 0, 0],
      textColor: [0, 0, 0],
      author: 'Ana',
      now: '2026-10-18T10:00:00.000Z',
      borderless: true,
    });
    expect(a.borderless).toBe(true);
  });
});
