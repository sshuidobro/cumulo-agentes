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
  /** Cierra la vista (botón de la barra y de error). */
  close: 'Cerrar',
  /** Nombre de «Deshacer» sin nada que deshacer. */
  undo: 'Deshacer',
  /** Nombre de «Rehacer» sin nada que rehacer. */
  redo: 'Rehacer',
  /** Barra de herramientas de la vista. */
  toolbar: 'Herramientas de organizar',
  rotateLeft: 'Girar a la izquierda',
  rotateRight: 'Girar a la derecha',
  delete: 'Eliminar páginas',
  insertBlank: 'Insertar página en blanco',
  /** Opciones del menú de «Insertar página en blanco». */
  before: 'Antes de la selección',
  after: 'Después de la selección',
  /** Descripción de los atajos Alt+← y Alt+→ (mover la selección). */
  moveLeft: 'Mover la selección a la izquierda',
  moveRight: 'Mover la selección a la derecha',
  /** Descripción de los atajos Alt+Inicio y Alt+Fin (mover la selección al principio o al final). */
  moveFirst: 'Mover la selección al principio',
  moveLast: 'Mover la selección al final',
  /** Anuncio (región «aria-live») tras mover: posición nueva de la primera página movida. */
  moved: (n: number): string => `Páginas movidas a la posición ${String(n)}.`,
  /** Imagen que acompaña al puntero al arrastrar: número de páginas que se mueven. */
  dragGhost: (n: number): string => (n === 1 ? '1 página' : `${String(n)} páginas`),
  /** Selector de tamaño de miniatura. */
  thumbSize: 'Tamaño de miniatura',
  /** Texto de una opción del selector de tamaño (ancho en px CSS). */
  cellSize: (px: number): string => `${String(px)} px`,
  /** Resumen de la barra: total de páginas y seleccionadas. */
  count: (pages: number, selected: number): string =>
    `${String(pages)} ${pages === 1 ? 'página' : 'páginas'} · ${String(selected)} ${selected === 1 ? 'seleccionada' : 'seleccionadas'}`,
  /** Posición original de una página movida (etiqueta de la celda). */
  was: (n: number): string => `(antes ${String(n)})`,
  /** Nombre accesible de la celda: «Página n», con «, girada 90°» si tiene giro. */
  pageOption: (n: number, rotation: number): string =>
    rotation === 0 ? `Página ${String(n)}` : `Página ${String(n)}, girada ${String(rotation)}°`,
  /** Mientras se guarda y aún no se sabe cuántas páginas van. */
  savingStart: 'Guardando…',
};
