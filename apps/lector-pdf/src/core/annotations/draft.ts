import { isFieldValue, type FieldValue } from '../forms/model';
import { isAnnotation, type Annotation, type AnnotationEdits } from './model';

/**
 * Borrador de anotaciones sin guardar (PDF-038, versión 2 desde PDF-080). Es el contenido de `AnnotationEdits`
 * en forma clonable (listas en lugar de mapas y conjuntos) más la metadata para mostrar el aviso de recuperación.
 */
export interface AnnotationDraft {
  readonly version: 2;
  readonly fileName: string;
  /** ISO 8601. */
  readonly savedAt: string;
  readonly upserts: readonly Annotation[];
  readonly removed: readonly string[];
  readonly fields: readonly (readonly [string, FieldValue])[];
}

/** Convierte los cambios del documento en un borrador listo para guardar. */
export function toDraft(edits: AnnotationEdits, fileName: string, savedAt: string): AnnotationDraft {
  return {
    version: 2,
    fileName,
    savedAt,
    upserts: [...edits.upserts.values()],
    removed: [...edits.removed],
    fields: [...edits.fields],
  };
}

/**
 * Reconstruye los cambios de un borrador leído del almacén. Acepta la versión 1 (sin valores de formulario) y la 2.
 * Cualquier cosa que no encaje (versión, forma, una anotación o un valor inválido, ids o nombres repetidos) da
 * `null`: el borrador no se usa.
 */
export function fromDraft(v: unknown): AnnotationEdits | null {
  if (!isRecord(v) || (v.version !== 1 && v.version !== 2) || typeof v.fileName !== 'string') return null;
  if (draftSavedAt(v) === null || !Array.isArray(v.upserts) || !Array.isArray(v.removed)) return null;

  const upserts = new Map<string, Annotation>();
  const list: readonly unknown[] = v.upserts;
  for (const item of list) {
    if (!isAnnotation(item) || upserts.has(item.id)) return null;
    upserts.set(item.id, item);
  }

  const removed = new Set<string>();
  const ids: readonly unknown[] = v.removed;
  for (const id of ids) {
    if (typeof id !== 'string' || removed.has(id)) return null;
    removed.add(id);
  }

  const fields = v.version === 2 ? fieldsOf(v.fields) : new Map<string, FieldValue>();
  if (fields === null) return null;
  return { upserts, removed, fields };
}

/** Fecha de guardado de un borrador (ISO 8601 válida), o `null` si el valor no es un borrador con fecha correcta. */
export function draftSavedAt(v: unknown): string | null {
  if (!isRecord(v) || typeof v.savedAt !== 'string') return null;
  return Number.isNaN(Date.parse(v.savedAt)) ? null : v.savedAt;
}

/** Pares `[nombre, valor]` de un borrador v2; `null` si alguno no encaja o un nombre se repite. */
function fieldsOf(v: unknown): Map<string, FieldValue> | null {
  if (!Array.isArray(v)) return null;
  const entries: readonly unknown[] = v;
  const fields = new Map<string, FieldValue>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const pair: readonly unknown[] = entry;
    const [name, value] = pair;
    if (typeof name !== 'string' || !isFieldValue(value) || fields.has(name)) return null;
    fields.set(name, value);
  }
  return fields;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
