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
  /** Nombre accesible del menú «Más opciones» del panel de comentarios (PDF-111). */
  menu: 'Más opciones de comentarios',
  /** Entrada del menú: guarda los comentarios en un fichero XFDF (PDF-111). */
  exportXfdf: 'Exportar comentarios…',
  /** Entrada del menú: añade los comentarios de un fichero XFDF (PDF-111). */
  importXfdf: 'Importar comentarios…',
  /** Aviso tras guardar el XFDF. */
  exported: 'Comentarios exportados.',
  /** Aviso si el XFDF elegido supera el tamaño máximo. */
  tooLarge: 'El fichero de comentarios es demasiado grande (máximo 20 MB).',
  /** Aviso tras importar: «Se han importado 3 comentarios.» y, si procede, los omitidos y los ya existentes. */
  imported: (n: number, skipped: number, duplicates: number): string => {
    let text = n === 1 ? 'Se ha importado 1 comentario.' : `Se han importado ${String(n)} comentarios.`;
    if (skipped === 1) text += ' Se ha omitido 1 que no se puede importar.';
    else if (skipped > 1) text += ` Se han omitido ${String(skipped)} que no se pueden importar.`;
    if (duplicates === 1) text += ' 1 ya estaba en el documento.';
    else if (duplicates > 1) text += ` ${String(duplicates)} ya estaban en el documento.`;
    return text;
  },
} as const;
