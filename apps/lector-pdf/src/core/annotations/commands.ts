import type { Command } from '@suite/shared';
import type { Annotation, AnnotationEdits, AnnotationType } from './model';

const ADD_LABEL: Readonly<Record<AnnotationType, string>> = {
  highlight: 'añadir resaltado',
  underline: 'añadir subrayado',
  strikeout: 'añadir tachado',
  note: 'añadir nota',
  freetext: 'añadir texto',
  ink: 'añadir dibujo',
  signature: 'añadir firma',
  square: 'añadir rectángulo',
  circle: 'añadir elipse',
  line: 'añadir línea',
  polygon: 'añadir polígono',
  stamp: 'añadir sello',
  reply: 'responder',
  review: 'cambiar estado',
};

const NOUN: Readonly<Record<AnnotationType, string>> = {
  highlight: 'resaltado',
  underline: 'subrayado',
  strikeout: 'tachado',
  note: 'nota',
  freetext: 'texto',
  ink: 'dibujo',
  signature: 'firma',
  square: 'rectángulo',
  circle: 'elipse',
  line: 'línea',
  polygon: 'polígono',
  stamp: 'sello',
  reply: 'respuesta',
  review: 'estado',
};

/**
 * Comando primitivo: fija el estado de `id` en `edits` (`upsert` o ninguno, y `removed`).
 * Es el único que modifica `AnnotationEdits`; los demás comandos se construyen sobre él.
 */
export function setEntryCommand(
  label: string,
  id: string,
  upsert: Annotation | undefined,
  removed: boolean,
  mergeKey?: string,
): Command<AnnotationEdits> {
  return {
    label,
    ...(mergeKey === undefined ? {} : { mergeKey }),
    apply(doc) {
      const upserts = new Map(doc.upserts);
      if (upsert === undefined) upserts.delete(id);
      else upserts.set(id, upsert);
      const removedIds = new Set(doc.removed);
      if (removed) removedIds.add(id);
      else removedIds.delete(id);
      return { upserts, removed: removedIds, fields: doc.fields };
    },
    invert(before) {
      return setEntryCommand(label, id, before.upserts.get(id), before.removed.has(id));
    },
  };
}

export function addAnnotationCommand(a: Annotation): Command<AnnotationEdits> {
  return setEntryCommand(ADD_LABEL[a.type], a.id, a, false);
}

export function updateAnnotationCommand(
  next: Annotation,
  label = 'editar comentario',
  mergeKey?: string,
): Command<AnnotationEdits> {
  return setEntryCommand(label, next.id, next, false, mergeKey);
}

/** Una anotación nueva desaparece por completo; una del fichero se marca como borrada. */
export function deleteAnnotationCommand(current: Annotation): Command<AnnotationEdits> {
  const label = `borrar ${NOUN[current.type]}`;
  const removed = current.origin.kind === 'file';
  return setEntryCommand(label, current.id, undefined, removed);
}
