/**
 * Guardado de anotaciones para las pruebas de interoperabilidad (PDF-029) y para generar muestras
 * manuales: pasa por el escritor real (`buildIncrementalUpdate`) y devuelve el fichero completo.
 */
import { memorySource } from '@suite/platform';
import { diffAnnotations, type Annotation, type AnnotationDiff } from '../../src/core/annotations';
import { buildIncrementalUpdate, openForSave, type IncrementalOutput } from '../../src/core/pdf/incremental';

/** Fecha de guardado fija: el resultado es determinista. */
export const SAVE_NOW = '2026-10-18T09:30:00.000Z';

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Diferencia que añade `additions` (origen nuevo) a un fichero sin línea base. */
export function additionsDiff(additions: readonly Annotation[]): AnnotationDiff {
  return diffAnnotations(new Map(), { upserts: new Map(additions.map((a) => [a.id, a] as const)), removed: new Set(), fields: new Map() });
}

/** Guarda `diff` sobre `data`; devuelve el fichero completo (original + incremento) y el resultado. */
export async function saveAnnotations(
  data: Uint8Array,
  diff: AnnotationDiff,
): Promise<{ readonly data: Uint8Array; readonly out: IncrementalOutput }> {
  const source = memorySource(data);
  const opened = await openForSave(source);
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: SAVE_NOW });
  if (!result.ok) throw new Error(`save: ${result.error.code}`);
  return { data: concat(data, result.value.delta), out: result.value };
}
