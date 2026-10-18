import type { Command } from '@suite/shared';
import type { AnnotationEdits } from '../annotations/model';
import type { FieldValue } from './model';

/** Fija el valor de un campo; `undefined` = vuelve al valor del fichero. Etiqueta: `rellenar «${label}»`. */
export function setFieldCommand(name: string, value: FieldValue | undefined, label: string): Command<AnnotationEdits> {
  return {
    label: `rellenar «${label}»`,
    apply(doc) {
      const fields = new Map(doc.fields);
      if (value === undefined) fields.delete(name);
      else fields.set(name, value);
      return { upserts: doc.upserts, removed: doc.removed, fields };
    },
    invert(before) {
      return setFieldCommand(name, before.fields.get(name), label);
    },
  };
}
