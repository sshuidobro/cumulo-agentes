/**
 * Valores de formulario de `form-full.pdf` para las pruebas de escritura (PDF-042) y la muestra manual de
 * Adobe. Pasa por el lector real (pdf.js) para importar los campos y por el escritor real para guardarlos.
 */
import { memorySource } from '@suite/platform';
import { diffAnnotations, type AnnotationDiff } from '../../src/core/annotations/diff';
import { EMPTY_EDITS } from '../../src/core/annotations/model';
import { mergeFields, type FieldChange, type FieldValue, type FormField } from '../../src/core/forms';
import { buildIncrementalUpdate, openForSave } from '../../src/core/pdf/incremental';
import { loadPdf } from '../../src/engine';
import { readPageAnnotations } from '../../src/engine/annotations-import';
import { nodeAssetBase } from '../helpers/pdfjs-node';
import { concat, SAVE_NOW } from './save-annotations';

/** Fecha de importación de los widgets (solo se usa si una anotación no trae fecha). */
const FALLBACK_DATE = '2026-10-17T12:00:00.000Z';

/** Valores del criterio 1 de PDF-042 sobre `form-full.pdf`. */
export const FORM_FULL_VALUES: Readonly<Record<string, FieldValue>> = {
  nombre: { kind: 'text', text: 'María José' },
  acepto: { kind: 'checkbox', checked: true },
  color: { kind: 'radio', selected: 'Azul' },
  pais: { kind: 'choice', selected: ['pt'] },
  idiomas: { kind: 'choice', selected: ['Francés', 'Alemán'] },
  'persona.apellido': { kind: 'text', text: 'Núñez' },
  rotado: { kind: 'text', text: 'Hola' },
};

/** Campos del fichero, fusionados por nombre como hace la app al importar. */
export async function readFormFields(bytes: Uint8Array, password?: string): Promise<ReadonlyMap<string, FormField>> {
  const loaded = await loadPdf(memorySource(bytes), {
    assetBaseUrl: nodeAssetBase(),
    ...(password === undefined ? {} : { password }),
  });
  if (!loaded.ok) throw new Error(`No se pudo abrir el PDF: ${loaded.error.code}`);
  try {
    let fields: ReadonlyMap<string, FormField> = new Map();
    for (let n = 1; n <= loaded.value.doc.numPages; n++) {
      const page = await readPageAnnotations(await loaded.value.doc.getPage(n), FALLBACK_DATE);
      fields = mergeFields(fields, page.widgets);
    }
    return fields;
  } finally {
    await loaded.value.destroy();
  }
}

/** Cambios de `values` sobre los campos de `fields`; un nombre que no existe lanza error. */
export function changesFor(fields: ReadonlyMap<string, FormField>, values: Readonly<Record<string, FieldValue>>): FieldChange[] {
  return Object.entries(values).map(([name, value]) => {
    const field = fields.get(name);
    if (field === undefined) throw new Error(`falta el campo ${name}`);
    return { field, value };
  });
}

/** Sin anotaciones: diferencia vacía. */
export const NO_ANNOTATION_CHANGES: AnnotationDiff = diffAnnotations(new Map(), EMPTY_EDITS);

/** Guarda `fields` (y `diff`) sobre `base` con el escritor real. Devuelve el fichero completo y el incremento. */
export async function saveFormChanges(
  base: Uint8Array,
  fields: readonly FieldChange[],
  diff: AnnotationDiff = NO_ANNOTATION_CHANGES,
): Promise<{ readonly data: Uint8Array; readonly delta: Uint8Array }> {
  const source = memorySource(base);
  const opened = await openForSave(source);
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, fields, now: SAVE_NOW });
  if (!result.ok) throw new Error(`save: ${result.error.code}`);
  return { data: concat(base, result.value.delta), delta: result.value.delta };
}
