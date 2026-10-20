import { describe, expect, it } from 'vitest';
import { addPolygonVertex, defaultPolygon, POLYGON_CLOSE_PX } from '../../../src/core/annotations/shape-drag';
import { stampCenterInside, stampRectAt, STAMP_NAMES } from '../../../src/core/annotations/shapes';
import type { RectPt } from '../../../src/core/annotations/model';

const PAGE: RectPt = [0, 0, 612, 792];

describe('addPolygonVertex (PDF-115)', () => {
  it('con tres vértices, un clic a 3 pt del primero (cierre a 4 pt) cierra con los mismos tres vértices', () => {
    const three = [100, 100, 200, 100, 200, 200];
    const r = addPolygonVertex(three, 103, 100, 4, PAGE);
    expect(r.closed).toBe(true);
    expect(r.vertices).toEqual(three);
  });

  it('un clic a 10 pt del primero añade el cuarto vértice', () => {
    const three = [100, 100, 200, 100, 200, 200];
    const r = addPolygonVertex(three, 110, 100, 4, PAGE);
    expect(r.closed).toBe(false);
    expect(r.vertices).toEqual([100, 100, 200, 100, 200, 200, 110, 100]);
  });

  it('con menos de tres vértices, un clic cerca del primero no cierra: añade', () => {
    const r = addPolygonVertex([100, 100, 200, 100], 103, 100, 4, PAGE);
    expect(r.closed).toBe(false);
    expect(r.vertices).toEqual([100, 100, 200, 100, 103, 100]);
  });

  it('un clic a menos de closePt del último vértice no añade un duplicado', () => {
    const r = addPolygonVertex([100, 100, 200, 100], 201, 100, 4, PAGE);
    expect(r.closed).toBe(false);
    expect(r.vertices).toEqual([100, 100, 200, 100]);
  });

  it('recorta el punto a la página: ningún vértice sale de ella', () => {
    const r = addPolygonVertex([10, 10, 300, 10], -50, 900, 4, PAGE);
    expect(r.vertices.slice(-2)).toEqual([0, 792]);
    for (let i = 0; i < r.vertices.length; i += 2) {
      expect(r.vertices[i]).toBeGreaterThanOrEqual(0);
      expect(r.vertices[i]).toBeLessThanOrEqual(612);
      expect(r.vertices[i + 1]).toBeGreaterThanOrEqual(0);
      expect(r.vertices[i + 1]).toBeLessThanOrEqual(792);
    }
  });

  it('el radio de cierre por defecto es de 8 px', () => {
    expect(POLYGON_CLOSE_PX).toBe(8);
  });
});

describe('defaultPolygon (PDF-115)', () => {
  it('pentágono regular de 48 pt de radio centrado en el punto', () => {
    const v = defaultPolygon(300, 400, PAGE);
    expect(v).toHaveLength(10);
    for (let i = 0; i < v.length; i += 2) {
      const d = Math.hypot((v[i] ?? 0) - 300, (v[i + 1] ?? 0) - 400);
      expect(d).toBeCloseTo(48, 6);
    }
  });

  it('el primer vértice queda arriba (mayor y en PDF) y la figura recortada a la página', () => {
    const v = defaultPolygon(300, 400, PAGE);
    expect(v[0]).toBeCloseTo(300, 6);
    expect(v[1]).toBeCloseTo(448, 6);
    const edge = defaultPolygon(5, 5, PAGE);
    for (let i = 0; i < edge.length; i += 2) {
      expect(edge[i]).toBeGreaterThanOrEqual(0);
      expect(edge[i + 1]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('stampCenterInside (PDF-115)', () => {
  it('un centro dentro de la página no se mueve', () => {
    expect(stampCenterInside('Approved', [300, 400], PAGE)).toEqual([300, 400]);
  });

  it('un centro junto al borde desplaza el sello para que quede dentro, sin cambiar su tamaño', () => {
    const [x1, y1, x2, y2] = stampRectAt('Approved', 0, 0);
    const [cx, cy] = stampCenterInside('Approved', [0, 0], PAGE);
    const r = stampRectAt('Approved', cx, cy);
    expect(r[0]).toBeCloseTo(0, 6);
    expect(r[1]).toBeCloseTo(0, 6);
    expect(r[2] - r[0]).toBeCloseTo(x2 - x1, 6);
    expect(r[3] - r[1]).toBeCloseTo(y2 - y1, 6);
  });

  it('cualquier sello cabe en la página tras desplazarlo', () => {
    for (const name of STAMP_NAMES) {
      const [cx, cy] = stampCenterInside(name, [611, 791], PAGE);
      const [x1, y1, x2, y2] = stampRectAt(name, cx, cy);
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(612);
      expect(y2).toBeLessThanOrEqual(792);
    }
  });

  it('si el sello no cabe en la página, queda centrado en ese eje', () => {
    const narrow: RectPt = [0, 0, 10, 792];
    const [cx] = stampCenterInside('Approved', [900, 400], narrow);
    expect(cx).toBe(5);
  });
});
