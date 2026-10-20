/**
 * Respuestas y estados de revisión de un comentario desde su ventana (PDF-109, ADR-0030). Cada acción es una entrada
 * de deshacer; el borrado de un comentario con respuestas está en `deleteAnnotation` (annotation-actions).
 */

import { newReply, newReviewState, reviewStateOf, type ReviewState } from '../core/annotations';
import { addAnnotation, getEffective, newAnnotationId, nowIso, updateAnnotation } from './annotation-actions';
import { useAnnotations } from './annotation-store';

/** Añade una respuesta del autor actual a `parentId`. El texto se recorta; vacío → no hace nada y devuelve `null`. */
export function addReply(parentId: string, text: string): string | null {
  const contents = text.trim();
  if (contents === '') return null;
  const parent = getEffective().get(parentId);
  if (parent === undefined) return null;
  const reply = newReply({
    id: newAnnotationId(),
    parent,
    contents,
    author: useAnnotations.getState().author,
    now: nowIso(),
  });
  addAnnotation(reply);
  return reply.id;
}

/**
 * Cambia el texto de una respuesta. El texto se recorta; vacío o igual al vigente → no hace nada. Una ráfaga de teclas
 * es una sola entrada de deshacer («editar respuesta»).
 */
export function editReply(id: string, text: string): void {
  const current = getEffective().get(id);
  if (current?.type !== 'reply') return;
  const contents = text.trim();
  if (contents === '' || contents === current.contents) return;
  updateAnnotation({ ...current, contents, modified: nowIso() }, 'editar respuesta', `reply-text:${id}`);
}

/**
 * Fija el estado de revisión de `parentId` con un `review` del autor actual. Si el vigente ya es `state` (o no hay
 * estado y `state` es 'None'), no hace nada.
 */
export function setReviewState(parentId: string, state: ReviewState): void {
  const all = getEffective();
  const parent = all.get(parentId);
  if (parent === undefined) return;
  const current = reviewStateOf(all, parentId)?.state ?? 'None';
  if (current === state) return;
  addAnnotation(
    newReviewState({
      id: newAnnotationId(),
      parent,
      state,
      author: useAnnotations.getState().author,
      now: nowIso(),
    }),
  );
}
