import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from '../../../src/engine/pdfjs';
import { annotationStorageKey, setFileAnnotationHidden } from '../../../src/engine/annotation-visibility';
import {
  annotationOutline,
  cssColor,
  svgPathForQuads,
  svgPointsForPath,
} from '../../../src/ui/viewer/annotation-geometry';
import { newAnnotation } from './factories';

describe('annotationOutline', () => {
  it('devuelve el rect tal cual si ya mide al menos 8×8 pt', () => {
    const a = { ...newAnnotation('a', 'note'), rect: [100, 700, 120, 720] as const };
    expect(annotationOutline(a)).toEqual([100, 700, 120, 720]);
  });

  it('amplía por igual en cada eje hasta 8 pt', () => {
    const a = { ...newAnnotation('a', 'note'), rect: [100, 700, 102, 701] as const };
    expect(annotationOutline(a)).toEqual([97, 696.5, 105, 704.5]);
  });
});

describe('svgPathForQuads', () => {
  it('recorre cada quad como polígono cerrado: sup-izq, sup-der, inf-der, inf-izq', () => {
    // Quad [x1,y2, x2,y2, x1,y1, x2,y1] = [10,40, 110,40, 10,20, 110,20].
    expect(svgPathForQuads([[10, 40, 110, 40, 10, 20, 110, 20]])).toBe('M 10 40 L 110 40 L 110 20 L 10 20 Z');
  });

  it('une varios quads y no devuelve nada sin quads', () => {
    const q = [0, 2, 2, 2, 0, 0, 2, 0] as const;
    expect(svgPathForQuads([q, q])).toBe('M 0 2 L 2 2 L 2 0 L 0 0 Z M 0 2 L 2 2 L 2 0 L 0 0 Z');
    expect(svgPathForQuads([])).toBe('');
  });
});

describe('svgPointsForPath y cssColor', () => {
  it('convierte [x0,y0,x1,y1] en pares x,y', () => {
    expect(svgPointsForPath([1, 2, 3, 4])).toBe('1,2 3,4');
  });

  it('pasa un color RGB en [0,1] a rgb() de 0 a 255', () => {
    expect(cssColor([1, 0.92, 0])).toBe('rgb(255 235 0)');
  });
});

describe('visibilidad de anotaciones del fichero', () => {
  it('la clave de annotationStorage es <num>R, o <num>R<gen> con generación > 0', () => {
    expect(annotationStorageKey({ num: 12, gen: 0 })).toBe('12R');
    expect(annotationStorageKey({ num: 12, gen: 3 })).toBe('12R3');
  });

  it('oculta con noView y vuelve a mostrar quitando la entrada', () => {
    const setValue = vi.fn();
    const remove = vi.fn();
    const doc = { annotationStorage: { setValue, remove } } as unknown as PDFDocumentProxy;

    setFileAnnotationHidden(doc, { num: 4, gen: 0 }, true);
    expect(setValue).toHaveBeenCalledWith('4R', { noView: true });

    setFileAnnotationHidden(doc, { num: 4, gen: 1 }, false);
    expect(remove).toHaveBeenCalledWith('4R1');
  });
});
