import { describe, expect, it } from 'vitest';
import {
  arrowHeadSize,
  arrowWings,
  isShapeValid,
  lineRect,
  newBoxShape,
  newLineShape,
  newPolygonShape,
  newStamp,
  resizeBox,
  STAMP_HEIGHT_PT,
  STAMP_LABELS,
  STAMP_NAMES,
  stampColor,
  stampRectAt,
  stampTextBox,
  verticesRect,
  type NewShapeBase,
} from '../../../src/core/annotations/shapes';
import { textWidth } from '../../../src/core/annotations/helvetica-widths';
import { isAnnotation } from '../../../src/core/annotations/model';

const base: NewShapeBase = {
  id: 'suite-s1',
  pageIndex: 2,
  color: [0.2, 0.4, 0.6],
  author: 'Ana',
  now: '2026-10-18T09:30:00.000Z',
};

describe('sellos', () => {
  it('cada nombre estándar tiene su texto en mayúsculas en español', () => {
    expect(STAMP_NAMES).toHaveLength(14);
    expect(STAMP_LABELS.Approved).toBe('APROBADO');
    expect(STAMP_LABELS.NotApproved).toBe('NO APROBADO');
    expect(STAMP_LABELS.Draft).toBe('BORRADOR');
    expect(STAMP_LABELS.ForPublicRelease).toBe('PARA PUBLICAR');
    expect(STAMP_LABELS.Sold).toBe('VENDIDO');
    for (const n of STAMP_NAMES) expect(STAMP_LABELS[n]).toBe(STAMP_LABELS[n].toUpperCase());
  });

  it('el color sigue la regla de ADR-0029: verde, rojo o azul', () => {
    expect(stampColor('Approved')).toEqual([0.13, 0.55, 0.13]);
    expect(stampColor('Final')).toEqual([0.13, 0.55, 0.13]);
    expect(stampColor('ForPublicRelease')).toEqual([0.13, 0.55, 0.13]);
    expect(stampColor('NotApproved')).toEqual([0.8, 0.1, 0.1]);
    expect(stampColor('Confidential')).toEqual([0.8, 0.1, 0.1]);
    expect(stampColor('TopSecret')).toEqual([0.8, 0.1, 0.1]);
    expect(stampColor('Expired')).toEqual([0.8, 0.1, 0.1]);
    expect(stampColor('NotForPublicRelease')).toEqual([0.8, 0.1, 0.1]);
    expect(stampColor('Draft')).toEqual([0.1, 0.3, 0.7]);
    expect(stampColor('Sold')).toEqual([0.1, 0.3, 0.7]);
  });

  it('la caja del sello tiene alto 36 y ancho del texto a 18 pt más 24, centrada en el punto', () => {
    const [x1, y1, x2, y2] = stampRectAt('Draft', 300, 400);
    expect(y2 - y1).toBe(STAMP_HEIGHT_PT);
    expect(x2 - x1).toBeCloseTo(textWidth('BORRADOR', 18) + 24, 9);
    expect((x1 + x2) / 2).toBeCloseTo(300, 9);
    expect((y1 + y2) / 2).toBeCloseTo(400, 9);
  });

  it('el texto va a 18 pt, centrado y sin salirse de la caja', () => {
    const rect = stampRectAt('Approved', 100, 100);
    const t = stampTextBox('Approved', rect);
    expect(t.fontSize).toBe(18);
    const textW = textWidth('APROBADO', 18);
    expect(t.x).toBeCloseTo(rect[0] + (rect[2] - rect[0] - textW) / 2, 9);
    expect(t.y).toBeCloseTo(rect[1] + (rect[3] - rect[1] - 0.7 * 18) / 2, 9);
  });

  it('el texto se reduce si la caja es más baja o más estrecha que el texto', () => {
    expect(stampTextBox('Draft', [0, 0, 300, 20]).fontSize).toBe(8);
    const narrow = stampTextBox('NotApproved', [0, 0, 60, 36]);
    expect(narrow.fontSize).toBeCloseTo((60 - 16) / textWidth('NO APROBADO', 1), 9);
  });
});

describe('cajas de líneas, polígonos y flechas', () => {
  it('arrowHeadSize es max(6, 3 × width)', () => {
    expect(arrowHeadSize(1)).toBe(6);
    expect(arrowHeadSize(2)).toBe(6);
    expect(arrowHeadSize(4)).toBe(12);
  });

  it('una línea sin puntas se amplía width/2', () => {
    expect(lineRect([0, 0, 10, 0], 2, ['None', 'None'])).toEqual([-1, -1, 11, 1]);
  });

  it('con una punta se amplía además arrowHeadSize', () => {
    expect(lineRect([0, 0, 10, 0], 2, ['None', 'OpenArrow'])).toEqual([-7, -7, 17, 7]);
    expect(lineRect([0, 0, 10, 0], 2, ['ClosedArrow', 'None'])).toEqual([-7, -7, 17, 7]);
  });

  it('la caja de los vértices se amplía width/2', () => {
    expect(verticesRect([0, 0, 10, 4, 5, 9], 4)).toEqual([-2, -2, 12, 11]);
  });

  it('arrowWings: alas simétricas a ±30° hacia atrás, de longitud arrowHeadSize', () => {
    const wings = arrowWings([110, 20], [10, 20], 2);
    expect(wings).not.toBeNull();
    if (wings === null) return;
    const [w1, w2] = wings;
    // Hacia atrás (x decrece) y a la misma distancia del punta.
    for (const w of [w1, w2]) {
      expect(w[0]).toBeLessThan(110);
      expect(Math.hypot(w[0] - 110, w[1] - 20)).toBeCloseTo(6, 9);
    }
    // Con la línea horizontal hacia la izquierda, las alas quedan a 3 pt por encima y por debajo de la punta.
    expect(w1[1]).toBeCloseTo(17, 9);
    expect(w2[1]).toBeCloseTo(23, 9);
  });

  it('arrowWings sin dirección (extremos coincidentes) es null', () => {
    expect(arrowWings([5, 5], [5, 5], 2)).toBeNull();
  });
});

describe('fábricas de formas nuevas', () => {
  it('rectángulo: sin relleno, opacidad 1, sin contenido y origen nuevo', () => {
    const a = newBoxShape({ ...base, kind: 'square', rect: [10, 20, 110, 70], width: 3 });
    expect(a).toEqual({
      id: 'suite-s1',
      type: 'square',
      pageIndex: 2,
      rect: [10, 20, 110, 70],
      color: [0.2, 0.4, 0.6],
      opacity: 1,
      contents: '',
      author: 'Ana',
      modified: base.now,
      created: base.now,
      origin: { kind: 'new' },
      width: 3,
      interior: null,
    });
  });

  it('elipse: mismo tipo de fábrica con kind circle', () => {
    expect(newBoxShape({ ...base, kind: 'circle', rect: [0, 0, 10, 10], width: 1 }).type).toBe('circle');
  });

  it('flecha: extremos [None, OpenArrow] y caja con la punta; sin flecha, [None, None]', () => {
    const arrow = newLineShape({ ...base, points: [10, 20, 110, 20], arrow: true, width: 2 });
    expect(arrow.endings).toEqual(['None', 'OpenArrow']);
    expect(arrow.rect).toEqual(lineRect([10, 20, 110, 20], 2, ['None', 'OpenArrow']));
    const plain = newLineShape({ ...base, points: [10, 20, 110, 20], arrow: false, width: 2 });
    expect(plain.endings).toEqual(['None', 'None']);
    expect(plain.rect).toEqual([9, 19, 111, 21]);
  });

  it('polígono: caja de los vértices y sin relleno', () => {
    const p = newPolygonShape({ ...base, vertices: [0, 0, 10, 0, 5, 8], width: 2 });
    expect(p).toMatchObject({ type: 'polygon', vertices: [0, 0, 10, 0, 5, 8], width: 2, interior: null });
    expect(p.rect).toEqual([-1, -1, 11, 9]);
  });

  it('sello: color y caja del nombre, centrado en el punto', () => {
    const s = newStamp({ id: 's', pageIndex: 0, author: '', now: base.now, name: 'Confidential', center: [50, 60] });
    expect(s).toMatchObject({ type: 'stamp', name: 'Confidential', color: [0.8, 0.1, 0.1], opacity: 1, origin: { kind: 'new' } });
    expect(s.rect).toEqual(stampRectAt('Confidential', 50, 60));
  });

  it('resizeBox cambia solo la caja y conserva el tipo', () => {
    const box = newBoxShape({ ...base, kind: 'circle', rect: [0, 0, 10, 10], width: 1 });
    const r = resizeBox(box, [0, 0, 20, 30]);
    expect(r).toEqual({ ...box, rect: [0, 0, 20, 30] });
    const s = newStamp({ ...base, name: 'Draft', center: [0, 0] });
    expect(resizeBox(s, [1, 2, 3, 4]).type).toBe('stamp');
  });

  it('las formas nuevas pasan la validación completa de anotaciones', () => {
    expect(isAnnotation(newBoxShape({ ...base, kind: 'square', rect: [0, 0, 5, 5], width: 1 }))).toBe(true);
    expect(isAnnotation(newLineShape({ ...base, points: [0, 0, 5, 5], arrow: true, width: 1 }))).toBe(true);
    expect(isAnnotation(newPolygonShape({ ...base, vertices: [0, 0, 5, 0, 0, 5], width: 1 }))).toBe(true);
    expect(isAnnotation(newStamp({ ...base, name: 'Final', center: [0, 0] }))).toBe(true);
  });
});

describe('isShapeValid', () => {
  const square = { type: 'square', width: 1, interior: null };
  const line = { type: 'line', points: [0, 0, 1, 1], width: 1, endings: ['None', 'ClosedArrow'], interior: [1, 1, 0] };
  const polygon = { type: 'polygon', vertices: [0, 0, 1, 0, 0, 1], width: 1, interior: null };
  const stamp = { type: 'stamp', name: 'Sold' };

  it('acepta campos válidos de cada tipo', () => {
    expect(isShapeValid(square)).toBe(true);
    expect(isShapeValid({ ...square, interior: [0, 0.5, 1] })).toBe(true);
    expect(isShapeValid(line)).toBe(true);
    expect(isShapeValid(polygon)).toBe(true);
    expect(isShapeValid(stamp)).toBe(true);
  });

  it('rechaza polígonos con 2 vértices, longitud impar o coordenadas no finitas', () => {
    expect(isShapeValid({ ...polygon, vertices: [0, 0, 1, 1] })).toBe(false);
    expect(isShapeValid({ ...polygon, vertices: [0, 0, 1, 0, 0, 1, 5] })).toBe(false);
    expect(isShapeValid({ ...polygon, vertices: [0, 0, 1, 0, 0, Number.NaN] })).toBe(false);
  });

  it('rechaza extremos desconocidos y líneas sin 4 coordenadas', () => {
    expect(isShapeValid({ ...line, endings: ['None', 'Circle'] })).toBe(false);
    expect(isShapeValid({ ...line, endings: ['None'] })).toBe(false);
    expect(isShapeValid({ ...line, points: [0, 0, 1] })).toBe(false);
  });

  it('rechaza sellos desconocidos y grosores no positivos', () => {
    expect(isShapeValid({ ...stamp, name: 'Foo' })).toBe(false);
    expect(isShapeValid({ ...stamp, name: 3 })).toBe(false);
    expect(isShapeValid({ ...square, width: 0 })).toBe(false);
    expect(isShapeValid({ ...polygon, width: -1 })).toBe(false);
  });

  it('rechaza un relleno que no es null ni RGB en [0, 1]', () => {
    expect(isShapeValid({ ...square, interior: [2, 0, 0] })).toBe(false);
    expect(isShapeValid({ ...square, interior: [0, 0] })).toBe(false);
    expect(isShapeValid({ ...square, interior: 'rojo' })).toBe(false);
  });

  it('rechaza un tipo que no es forma ni sello', () => {
    expect(isShapeValid({ type: 'highlight' })).toBe(false);
  });
});
