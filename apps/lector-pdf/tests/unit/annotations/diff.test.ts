import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDITS,
  annotationEquals,
  annotationsOfPage,
  diffAnnotations,
  effectiveAnnotations,
  isEmptyDiff,
} from '../../../src/core/annotations';
import type { Annotation, AnnotationEdits } from '../../../src/core/annotations';
import { fileAnnotation, newAnnotation } from './factories';

function edits(upserts: Annotation[] = [], removed: string[] = []): AnnotationEdits {
  return { upserts: new Map(upserts.map((a) => [a.id, a])), removed: new Set(removed), fields: new Map() };
}

function mapOf(...list: Annotation[]): ReadonlyMap<string, Annotation> {
  return new Map(list.map((a) => [a.id, a]));
}

describe('annotationEquals', () => {
  it('compara todos los campos en profundidad', () => {
    const a = newAnnotation('x', 'ink');
    if (a.type !== 'ink') throw new Error('tipo inesperado');
    expect(annotationEquals(a, { ...a, paths: [[10, 20, 30, 40, 50, 20]] })).toBe(true);
    expect(annotationEquals(a, { ...a, paths: [[10, 20, 30, 40, 50, 21]] })).toBe(false);
    expect(annotationEquals(a, { ...a, width: 3 })).toBe(false);
    expect(annotationEquals(a, { ...a, created: null })).toBe(false);
  });

  it('no depende del orden de las claves', () => {
    const a = newAnnotation('x', 'note');
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as Annotation;
    expect(annotationEquals(a, reordered)).toBe(true);
  });
});

describe('diffAnnotations', () => {
  it('una modificada que vuelve a ser igual que la línea base no aparece', () => {
    const f = fileAnnotation(3);
    const d = diffAnnotations(mapOf(f), edits([f]));
    expect(d.modified).toHaveLength(0);
  });

  it('una del fichero distinta de su línea base aparece en modified', () => {
    const f = fileAnnotation(3);
    const d = diffAnnotations(mapOf(f), edits([{ ...f, contents: 'nuevo' }]));
    expect(d.modified.map((a) => a.contents)).toEqual(['nuevo']);
  });

  it('una del fichero sin línea base (aún no importada) se trata como modificada', () => {
    const f = fileAnnotation(3);
    const d = diffAnnotations(new Map(), edits([f]));
    expect(d.modified).toEqual([f]);
  });

  it('las marcadas como borradas salen en removed (con su línea base) y no en modified', () => {
    const f = fileAnnotation(3);
    const d = diffAnnotations(mapOf(f), edits([{ ...f, contents: 'x' }], [f.id]));
    expect(d.removed).toEqual([f]);
    expect(d.modified).toHaveLength(0);
  });

  it('ignora los ids borrados que no están en la línea base', () => {
    const d = diffAnnotations(new Map(), edits([], ['ref:99R']));
    expect(d.removed).toHaveLength(0);
  });

  it('las nuevas van en added y en orden de inserción', () => {
    const a = newAnnotation('suite-2');
    const b = newAnnotation('suite-1');
    const d = diffAnnotations(new Map(), edits([a, b]));
    expect(d.added.map((x) => x.id)).toEqual(['suite-2', 'suite-1']);
    expect(isEmptyDiff(d)).toBe(false);
  });

  it('sin cambios el diff está vacío', () => {
    expect(isEmptyDiff(diffAnnotations(mapOf(fileAnnotation(1)), EMPTY_EDITS))).toBe(true);
  });
});

describe('effectiveAnnotations', () => {
  const f1 = fileAnnotation(1);
  const f2 = fileAnnotation(2);
  const f3 = fileAnnotation(3);
  const baseline = mapOf(f1, f2, f3);

  it('sin cambios devuelve la línea base', () => {
    expect([...effectiveAnnotations(baseline, EMPTY_EDITS).keys()]).toEqual(['ref:1R', 'ref:2R', 'ref:3R']);
  });

  it('sustituye las editadas, omite las borradas y añade las nuevas al final en orden de inserción', () => {
    const n1 = newAnnotation('suite-b');
    const n2 = newAnnotation('suite-a');
    const e = edits([{ ...f2, contents: 'x' }, n2, n1], ['ref:1R']);
    const eff = effectiveAnnotations(baseline, e);
    expect([...eff.keys()]).toEqual(['ref:2R', 'ref:3R', 'suite-a', 'suite-b']);
    expect(eff.get('ref:2R')?.contents).toBe('x');
  });

  it('una edición de una anotación aún no importada aparece al final', () => {
    const eff = effectiveAnnotations(new Map(), edits([fileAnnotation(9)]));
    expect([...eff.keys()]).toEqual(['ref:9R']);
  });

  it('annotationsOfPage filtra por página y conserva el orden', () => {
    const p0 = newAnnotation('suite-1', 'note', 0);
    const p1 = newAnnotation('suite-2', 'note', 1);
    const all = effectiveAnnotations(mapOf(f1, f2), edits([p1, p0]));
    expect(annotationsOfPage(all, 0).map((a) => a.id)).toEqual(['ref:1R', 'ref:2R', 'suite-1']);
    expect(annotationsOfPage(all, 1).map((a) => a.id)).toEqual(['suite-2']);
    expect(annotationsOfPage(all, 5)).toEqual([]);
  });
});
