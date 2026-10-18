import { isAnnotation, type Annotation, type AnnotationEdits } from './model';

/**
 * Borrador de anotaciones sin guardar (PDF-038). Es el contenido de `AnnotationEdits` en forma clonable
 * (listas en lugar de mapas y conjuntos) más la metadata para mostrar el aviso de recuperación.
 */
export interface AnnotationDraft {
  readonly version: 1;
  readonly fileName: string;
  /** ISO 8601. */
  readonly savedAt: string;
  readonly upserts: readonly Annotation[];
  readonly removed: readonly string[];
}

/** Convierte los cambios del documento en un borrador listo para guardar. */
export function toDraft(edits: AnnotationEdits, fileName: string, savedAt: string): AnnotationDraft {
  return {
    version: 1,
    fileName,
    savedAt,
    upserts: [...edits.upserts.values()],
    removed: [...edits.removed],
  };
}

/**
 * Reconstruye los cambios de un borrador leído del almacén. Cualquier cosa que no encaje (versión, forma,
 * una anotación inválida, ids repetidos) da `null`: el borrador no se usa.
 */
export function fromDraft(v: unknown): AnnotationEdits | null {
  if (!isRecord(v) || v.version !== 1 || typeof v.fileName !== 'string') return null;
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
  return { upserts, removed };
}

/** Fecha de guardado de un borrador (ISO 8601 válida), o `null` si el valor no es un borrador con fecha correcta. */
export function draftSavedAt(v: unknown): string | null {
  if (!isRecord(v) || typeof v.savedAt !== 'string') return null;
  return Number.isNaN(Date.parse(v.savedAt)) ? null : v.savedAt;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
