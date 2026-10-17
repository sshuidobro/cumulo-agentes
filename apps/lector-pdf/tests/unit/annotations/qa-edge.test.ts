import { describe, expect, it } from 'vitest';
import { UndoStack } from '@suite/shared';
import {
  EMPTY_EDITS,
  addAnnotationCommand,
  deleteAnnotationCommand,
  diffAnnotations,
  isAnnotation,
  isEmptyDiff,
  quadFromRect,
  translateAnnotation,
  updateAnnotationCommand,
} from '../../../src/core/annotations';
import type { AnnotationEdits } from '../../../src/core/annotations';
import { parsePdfDate, toPdfDate } from '../../../src/core/pdf-date';
import { fileAnnotation, newAnnotation } from './factories';

describe('QA: casos límite de anotaciones', () => {
  it('editar una del fichero, borrarla y deshacer ×2 vuelve a diff vacío; redo ×2 la deja borrada', () => {
    const f = fileAnnotation(7, 'note');
    const base = new Map([[f.id, f]]);
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS);
    stack.execute(updateAnnotationCommand({ ...f, contents: 'hola ñ 😀 مرحبا' }));
    stack.execute(deleteAnnotationCommand(f));
    let d = diffAnnotations(base, stack.doc);
    expect(d.removed).toHaveLength(1);
    expect(d.modified).toHaveLength(0);
    stack.undo();
    stack.undo();
    expect(isEmptyDiff(diffAnnotations(base, stack.doc))).toBe(true);
    stack.redo();
    stack.redo();
    d = diffAnnotations(base, stack.doc);
    expect(d.removed.map((a) => a.id)).toEqual(['ref:7R']);
  });

  it('los comandos no mutan el documento anterior', () => {
    const a = newAnnotation('suite-1');
    const before = EMPTY_EDITS;
    addAnnotationCommand(a).apply(before);
    expect(before.upserts.size).toBe(0);
    expect(before.removed.size).toBe(0);
  });

  it('isAnnotation rechaza basura: null, NaN, rect invertido, opacity NaN', () => {
    const a = newAnnotation('suite-1');
    expect(isAnnotation(null)).toBe(false);
    expect(isAnnotation(undefined)).toBe(false);
    expect(isAnnotation('x')).toBe(false);
    expect(isAnnotation({ ...a, opacity: Number.NaN })).toBe(false);
    expect(isAnnotation({ ...a, rect: [Number.NaN, 0, 1, 1] })).toBe(false);
    expect(isAnnotation({ ...a, color: [0, 0, 2] })).toBe(false);
    expect(isAnnotation({ ...a, id: 5 })).toBe(false);
  });

  it('translate con valores cero/negativos y sin mutar el original', () => {
    const a = newAnnotation('suite-2', 'ink');
    const t = translateAnnotation(a, -5, 0);
    expect(t.rect).toEqual([5, 20, 105, 40]);
    expect(a.rect).toEqual([10, 20, 110, 40]);
    expect(quadFromRect([0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('fechas PDF: desbordes y formatos raros', () => {
    expect(parsePdfDate('D:20260230')).toBeNull();
    expect(parsePdfDate('D:20261017250000Z')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate(null)).toBeNull();
    expect(parsePdfDate('D:20240229')).toBe('2024-02-29T00:00:00.000Z');
    expect(parsePdfDate("D:20261017120000-05'30'")).toBe('2026-10-17T17:30:00.000Z');
    expect(parsePdfDate('D:20261017120000Z\n')).toBeNull();
    expect(() => toPdfDate('nope')).toThrow(RangeError);
    expect(toPdfDate('2026-10-17T12:00:00.000Z')).toBe('D:20261017120000Z');
  });
});
