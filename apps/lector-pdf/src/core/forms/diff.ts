import type { AnnotationEdits } from '../annotations/model';
import { effectiveValue } from './effective';
import { isFillable, valueEquals, type FieldValue, type FormField } from './model';

export interface FieldChange {
  readonly field: FormField;
  readonly value: FieldValue;
}

/**
 * Campos cuyo valor efectivo difiere del fichero, en el orden de `fields`. Ignora nombres que no estén en
 * `fields` y campos no rellenables.
 */
export function diffFields(fields: ReadonlyMap<string, FormField>, edits: AnnotationEdits): readonly FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields.values()) {
    if (!isFillable(field)) continue;
    const value = effectiveValue(field, edits);
    if (valueEquals(value, field.initial)) continue;
    changes.push({ field, value });
  }
  return changes;
}
