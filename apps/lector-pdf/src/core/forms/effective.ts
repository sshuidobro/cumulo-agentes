import type { AnnotationEdits } from '../annotations/model';
import type { FieldValue, FormField, FormWidget } from './model';

/** Valor que se ve: el cambiado por el usuario o, si no lo hay, el del fichero. */
export function effectiveValue(field: FormField, edits: AnnotationEdits): FieldValue {
  return edits.fields.get(field.name) ?? field.initial;
}

/**
 * Valor a guardar en `annotationStorage` de pdf.js para un widget (ADR-0019). Una casilla o una opción
 * de grupo se marca según su propio estado de exportación; el resto, con su valor completo.
 */
export function storageValue(
  field: FormField,
  widget: FormWidget,
  value: FieldValue,
): string | boolean | readonly string[] {
  switch (value.kind) {
    case 'text':
      return value.text;
    case 'checkbox':
      return value.checked;
    case 'radio':
      return widget.onState !== null && value.selected === widget.onState;
    case 'choice':
      return field.type === 'combo' ? (value.selected[0] ?? '') : value.selected;
  }
}
