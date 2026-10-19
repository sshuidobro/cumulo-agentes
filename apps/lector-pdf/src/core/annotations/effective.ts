import type { Annotation, AnnotationEdits } from './model';
import { isDrawable } from './replies';

/**
 * Lo que se ve: `línea base ⊕ cambios`. Orden: las de la línea base en su orden (sustituidas si
 * hay un upsert, omitidas si están en `removed`), después las que no están en la línea base, en
 * orden de inserción (omitidas si están en `removed`).
 */
export function effectiveAnnotations(
  baseline: ReadonlyMap<string, Annotation>,
  edits: AnnotationEdits,
): ReadonlyMap<string, Annotation> {
  const result = new Map<string, Annotation>();
  for (const [id, base] of baseline) {
    if (edits.removed.has(id)) continue;
    result.set(id, edits.upserts.get(id) ?? base);
  }
  for (const [id, a] of edits.upserts) {
    if (baseline.has(id) || edits.removed.has(id)) continue;
    result.set(id, a);
  }
  return result;
}

/** Anotaciones dibujables de una página, en el orden de `all` (sin respuestas ni estados, PDF-058). */
export function annotationsOfPage(all: ReadonlyMap<string, Annotation>, pageIndex: number): readonly Annotation[] {
  const out: Annotation[] = [];
  for (const a of all.values()) {
    if (a.pageIndex === pageIndex && isDrawable(a)) out.push(a);
  }
  return out;
}
