import { describe, expect, it } from 'vitest';
import { rectsToLineQuads } from '../../../src/core/annotations/line-quads';
import { quadFromRect, type RectPt } from '../../../src/core/annotations/model';

/** Palabra de 30 pt de ancho y 12 de alto sobre la línea con base `y1`, empezando en `x1`. */
function word(x1: number, y1: number): RectPt {
  return [x1, y1, x1 + 30, y1 + 12];
}

describe('rectsToLineQuads', () => {
  it('une en un único quad tres palabras de una línea separadas 3 pt (alto 12)', () => {
    const quads = rectsToLineQuads([word(100, 100), word(133, 100), word(166, 100)]);
    expect(quads).toEqual([quadFromRect([100, 100, 196, 112])]);
  });

  it('dos líneas dan dos quads, ordenados de arriba abajo', () => {
    const lower: RectPt = [100, 80, 160, 92];
    const upper: RectPt = [100, 100, 160, 112];
    const quads = rectsToLineQuads([lower, upper]);
    expect(quads).toEqual([quadFromRect(upper), quadFromRect(lower)]);
    expect(quads[0]?.[1]).toBe(112);
    expect(quads[1]?.[1]).toBe(92);
  });

  it('en la misma línea, fragmentos separados 20 pt dan dos quads de izquierda a derecha', () => {
    const left: RectPt = [100, 100, 130, 112];
    const right: RectPt = [150, 100, 180, 112];
    const quads = rectsToLineQuads([right, left]);
    expect(quads).toEqual([quadFromRect(left), quadFromRect(right)]);
  });

  it('descarta un rectángulo de 0,2 pt de ancho', () => {
    const sliver: RectPt = [100, 100, 100.2, 112];
    expect(rectsToLineQuads([sliver])).toEqual([]);
    expect(rectsToLineQuads([sliver, word(200, 100)])).toEqual([quadFromRect(word(200, 100))]);
  });

  it('descarta también un rectángulo de menos de 0,5 pt de alto', () => {
    expect(rectsToLineQuads([[100, 100, 130, 100.3]])).toEqual([]);
  });

  it('sin rectángulos devuelve una lista vacía', () => {
    expect(rectsToLineQuads([])).toEqual([]);
  });

  it('dos fragmentos que se solapan verticalmente menos de la mitad no son de la misma línea', () => {
    // Solapan 4 pt de un alto de 12: menos del 50 %, aunque estén a la misma altura horizontal.
    const low: RectPt = [100, 96, 130, 108];
    const high: RectPt = [100, 104, 130, 116];
    expect(rectsToLineQuads([low, high])).toHaveLength(2);
  });
});
