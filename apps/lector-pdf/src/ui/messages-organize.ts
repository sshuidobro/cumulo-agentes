/**
 * Textos de la vista «Organizar páginas» (PDF-124, PDF-125).
 */
export const organizeMsg = {
  /** Elemento del menú que abre la vista. */
  menuItem: 'Organizar páginas…',
  /** Título de la vista. */
  title: 'Organizar páginas',
  /** Mientras se leen las páginas del documento. */
  loading: 'Leyendo las páginas…',
  /** Progreso al guardar. */
  saving: (done: number, total: number): string => `Guardando páginas: ${done} de ${total}…`,
  /** Aviso al intentar borrar todas las páginas. */
  cannotDeleteAll: 'No se pueden eliminar todas las páginas.',
  /** Aviso al abrir un PDF sin permiso de organizar (una vez por documento). */
  assembleAnyway: 'Este PDF no permite organizar sus páginas; tus cambios se guardarán igualmente en tu copia.',
  /** Pregunta al cerrar la vista con cambios. */
  saveQuestion: (name: string): string => `¿Guardar los cambios en las páginas de “${name}”?`,
  save: 'Guardar',
  discard: 'No guardar',
  cancel: 'Cancelar',
  /** Nombre de «Deshacer» con la última acción. */
  undoLabel: (label: string): string => `Deshacer ${label}`,
  /** Nombre de «Rehacer» con la última acción deshecha. */
  redoLabel: (label: string): string => `Rehacer ${label}`,
};
