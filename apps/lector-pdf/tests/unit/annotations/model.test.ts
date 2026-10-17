import { describe, expect, it } from 'vitest';
import {
  fileAnnotationId,
  isAnnotation,
  quadFromRect,
  rectFromPaths,
  rectFromQuads,
  translateAnnotation,
} from '../../../src/core/annotations';
import type { Annotation, Quad } from '../../../src/core/annotations';
import { fileAnnotation, newAnnotation } from './factories';

describe('fileAnnotationId', () => {
  it('usa solo el número si la generación es 0 y añade la generación si no', () => {
    expect(fileAnnotationId({ num: 12, gen: 0 })).toBe('ref:12R');
    expect(fileAnnotationId({ num: 12, gen: 3 })).toBe('ref:12R3');
  });
});

describe('quadFromRect', () => {
  it('convierte [x1,y1,x2,y2] al orden Z', () => {
    expect(quadFromRect([10, 20, 110, 40])).toEqual([10, 40, 110, 40, 10, 20, 110, 20]);
  });
});

describe('rectFromQuads y rectFromPaths', () => {
  it('rectFromQuads devuelve la caja que contiene todos los quads', () => {
    const quads: Quad[] = [
      [0, 10, 5, 10, 0, 0, 5, 0],
      [20, 30, 25, 30, 20, 25, 25, 25],
    ];
    expect(rectFromQuads(quads)).toEqual([0, 0, 25, 30]);
  });

  it('rectFromQuads sin quads devuelve un rectángulo vacío', () => {
    expect(rectFromQuads([])).toEqual([0, 0, 0, 0]);
  });

  it('rectFromPaths amplía la caja de los puntos en pad a cada lado', () => {
    expect(rectFromPaths([[10, 20, 30, 5]], 2)).toEqual([8, 3, 32, 22]);
  });

  it('rectFromPaths sin puntos devuelve un rectángulo vacío', () => {
    expect(rectFromPaths([], 2)).toEqual([0, 0, 0, 0]);
  });

  it('rectFromPaths no lanza con un trazo de 300 000 puntos y calcula la caja', () => {
    const n = 300_000;
    const trazo: number[] = [];
    for (let i = 0; i < n; i++) {
      trazo.push(i, -i);
    }
    let rect: readonly number[] = [];
    expect(() => {
      rect = rectFromPaths([trazo], 1);
    }).not.toThrow();
    expect(rect).toEqual([-1, -(n - 1) - 1, n - 1 + 1, 1]);
  });
});

describe('translateAnnotation', () => {
  it('mueve rect y quads de un resaltado', () => {
    const a = newAnnotation('a', 'highlight');
    const moved = translateAnnotation(a, 5, -3);
    expect(moved.rect).toEqual([15, 17, 115, 37]);
    if (moved.type !== 'highlight') throw new Error('tipo inesperado');
    expect(moved.quads[0]).toEqual([15, 37, 115, 37, 15, 17, 115, 17]);
  });

  it('mueve todos los puntos y el rect de un dibujo', () => {
    const ink = newAnnotation('i', 'ink');
    const moved = translateAnnotation(ink, 1, 2);
    if (moved.type !== 'ink') throw new Error('tipo inesperado');
    expect(moved.paths).toEqual([[11, 22, 31, 42, 51, 22]]);
    expect(moved.rect).toEqual([11, 22, 111, 42]);
  });

  it('mueve nota y texto libre solo por el rect', () => {
    const note = translateAnnotation(newAnnotation('n', 'note'), 1, 1);
    expect(note.rect).toEqual([11, 21, 111, 41]);
    const text = translateAnnotation(newAnnotation('t', 'freetext'), -1, 0);
    expect(text.rect).toEqual([9, 20, 109, 40]);
    expect(text.type).toBe('freetext');
  });
});

describe('isAnnotation', () => {
  const types = ['highlight', 'underline', 'strikeout', 'note', 'freetext', 'ink'] as const;

  it.each(types)('acepta un %s válido, nuevo o del fichero', (type) => {
    expect(isAnnotation(newAnnotation('x', type))).toBe(true);
    expect(isAnnotation(fileAnnotation(7, type))).toBe(true);
  });

  it('acepta created null y popupRef con referencia', () => {
    const a = newAnnotation('n', 'note');
    expect(isAnnotation({ ...a, created: null })).toBe(true);
    const f = { ...a, origin: { kind: 'file', ref: { num: 4, gen: 0 }, popupRef: { num: 5, gen: 0 } } };
    expect(isAnnotation(f)).toBe(true);
  });

  it('rechaza un color con 2 componentes', () => {
    expect(isAnnotation({ ...newAnnotation('x'), color: [1, 1] })).toBe(false);
  });

  it('rechaza opacidad 2', () => {
    expect(isAnnotation({ ...newAnnotation('x'), opacity: 2 })).toBe(false);
  });

  it('rechaza quads con 7 números', () => {
    expect(isAnnotation({ ...newAnnotation('x'), quads: [[1, 2, 3, 4, 5, 6, 7]] })).toBe(false);
  });

  it('rechaza un tipo desconocido', () => {
    expect(isAnnotation({ ...newAnnotation('x'), type: 'square' })).toBe(false);
  });

  it('rechaza pageIndex negativo', () => {
    expect(isAnnotation({ ...newAnnotation('x'), pageIndex: -1 })).toBe(false);
  });

  it('rechaza campos que faltan y valores que no son objetos', () => {
    const sinAutor: Record<string, unknown> = { ...newAnnotation('x') };
    delete sinAutor.author;
    expect(isAnnotation(sinAutor)).toBe(false);
    expect(isAnnotation(null)).toBe(false);
    expect(isAnnotation([])).toBe(false);
    expect(isAnnotation('x')).toBe(false);
  });

  it('rechaza rect desordenado, no finito o de longitud incorrecta', () => {
    expect(isAnnotation({ ...newAnnotation('x'), rect: [110, 20, 10, 40] })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('x'), rect: [0, 0, Number.NaN, 1] })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('x'), rect: [0, 0, 1] })).toBe(false);
  });

  it('rechaza fechas que no son ISO 8601', () => {
    expect(isAnnotation({ ...newAnnotation('x'), modified: 'ayer' })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('x'), created: '17/10/2026' })).toBe(false);
  });

  it('rechaza origen desconocido o referencia inválida', () => {
    expect(isAnnotation({ ...newAnnotation('x'), origin: { kind: 'otro' } })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('x'), origin: { kind: 'file', ref: { num: 0, gen: 0 }, popupRef: null } })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('x'), origin: { kind: 'file', ref: { num: 1, gen: 0 }, popupRef: 'x' } })).toBe(false);
  });

  it('valida los campos propios de cada tipo', () => {
    expect(isAnnotation({ ...newAnnotation('n', 'note'), icon: 'Estrella' })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('n', 'note'), open: 'si' })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('t', 'freetext'), fontSize: 0 })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('t', 'freetext'), textColor: [0, 0, 2] })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('i', 'ink'), width: -1 })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('i', 'ink'), paths: [[1, 2, 3]] })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('i', 'ink'), paths: [] })).toBe(false);
    expect(isAnnotation({ ...newAnnotation('h'), quads: [] })).toBe(false);
  });

  it('acepta fechas ISO con desfase horario', () => {
    const a: Annotation = { ...newAnnotation('x'), modified: '2026-10-17T14:00:00+02:00' };
    expect(isAnnotation(a)).toBe(true);
  });
});
