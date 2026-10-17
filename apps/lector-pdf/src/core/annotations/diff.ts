import type { Annotation, AnnotationEdits } from './model';

export interface AnnotationDiff {
  readonly added: readonly Annotation[];
  readonly modified: readonly Annotation[];
  readonly removed: readonly Annotation[];
}

/** Comparación profunda de todos los campos (sin depender del orden de las claves). */
export function annotationEquals(a: Annotation, b: Annotation): boolean {
  return deepEqual(a, b);
}

/**
 * Diferencia entre la línea base del fichero y los cambios:
 * - `added`: upserts con origen `new`, en orden de inserción.
 * - `modified`: upserts de origen `file` distintos de su línea base (o sin línea base).
 * - `removed`: entradas de la línea base cuyo id está en `removed`.
 * Si un id está en `removed`, no aparece en `modified`.
 */
export function diffAnnotations(baseline: ReadonlyMap<string, Annotation>, edits: AnnotationEdits): AnnotationDiff {
  const added: Annotation[] = [];
  const modified: Annotation[] = [];
  for (const a of edits.upserts.values()) {
    if (a.origin.kind === 'new') {
      added.push(a);
      continue;
    }
    if (edits.removed.has(a.id)) continue;
    const base = baseline.get(a.id);
    if (base === undefined || !annotationEquals(base, a)) modified.push(a);
  }
  const removed: Annotation[] = [];
  for (const [id, base] of baseline) {
    if (edits.removed.has(id)) removed.push(base);
  }
  return { added, modified, removed };
}

export function isEmptyDiff(d: AnnotationDiff): boolean {
  return d.added.length === 0 && d.modified.length === 0 && d.removed.length === 0;
}

function deepEqual(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const rx = x as Record<string, unknown>;
  const ry = y as Record<string, unknown>;
  const keys = Object.keys(rx);
  if (keys.length !== Object.keys(ry).length) return false;
  return keys.every((k) => Object.hasOwn(ry, k) && deepEqual(rx[k], ry[k]));
}
