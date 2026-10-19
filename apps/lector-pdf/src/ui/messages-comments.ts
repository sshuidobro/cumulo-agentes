import { REVIEW_STATE_LABELS, type ReviewState } from '../core/annotations';

/** Textos de las respuestas y estados de revisión en la ventana de comentario (PDF-109) y en el panel (PDF-116). */
export const commentsMsg = {
  /** Nombre accesible de la lista de respuestas. */
  replies: 'Respuestas',
  /** Campo para escribir una respuesta nueva; también es su nombre accesible. */
  replyField: 'Escribe una respuesta',
  /** Botón que añade la respuesta escrita (Ctrl+Intro también). */
  replyButton: 'Responder',
  /** Botón de icono de una respuesta y su campo de edición. */
  replyEdit: 'Editar respuesta',
  /** Botón de icono para borrar una respuesta propia. */
  replyDelete: 'Borrar respuesta',
  /** Botón de menú de estados de revisión, en el pie de la ventana. */
  stateMenu: 'Estado',
  /** Estado vigente en la cabecera: «Estado: Aceptado». */
  stateLabel: (state: ReviewState): string => `Estado: ${REVIEW_STATE_LABELS[state]}`,
  /** Opción del menú para quitar el estado. */
  stateNone: 'Sin estado',
  /** Número de respuestas del hilo: «1 respuesta» / «N respuestas». */
  replyCount: (n: number): string => (n === 1 ? '1 respuesta' : `${n.toLocaleString('es-ES')} respuestas`),
  /** Nombre accesible de una respuesta en el panel de comentarios (PDF-116). */
  replyRowName: (author: string): string => `Respuesta de ${author}`,
  /** Grupo «Estado» del menú de filtro del panel de comentarios (PDF-116). */
  filterStates: 'Estado',
} as const;
