/**
 * Textos de «Redactar» (PDF-137, ADR-0039): marcar zonas, texto y resultados de búsqueda, y aplicar la redacción.
 */
export const redactMsg = {
  /** Herramienta de la barra «Editar» y su nombre en la barra de selección. */
  tool: 'Redactar',
  /** Marca el texto seleccionado en la página. */
  markSelection: 'Marcar texto seleccionado',
  /** Marca todas las coincidencias de la búsqueda actual. */
  markSearch: 'Marcar resultados de búsqueda',
  /** Aviso tras marcar: `n` zonas. */
  marked: (n: number): string => `${n.toLocaleString('es-ES')} ${n === 1 ? 'zona marcada' : 'zonas marcadas'}.`,
  /** Botón de aplicar con el número de marcas. */
  apply: (n: number): string => `Aplicar redacciones (${n.toLocaleString('es-ES')})`,
  /** Título de la confirmación y del trabajo en curso. */
  confirmTitle: 'Aplicar redacciones',
  /** Texto de la confirmación: la acción es irreversible. */
  confirmMessage:
    'Se eliminará de forma permanente el contenido marcado (texto, imágenes y comentarios). Los dibujos vectoriales quedarán tapados. Esta acción no se puede deshacer.',
  confirmApply: 'Aplicar',
  cancel: 'Cancelar',
  /** Segunda confirmación cuando hay páginas que se convertirán en imagen. */
  rasterTitle: 'Convertir páginas en imagen',
  rasterWarning: (n: number): string =>
    `${n.toLocaleString('es-ES')} ${n === 1 ? 'página se convertirá' : 'páginas se convertirán'} en imagen: su texto ya no se podrá seleccionar ni buscar.`,
  /** Aviso final: `n` páginas con marcas. */
  done: (n: number): string => `Redacción aplicada en ${n.toLocaleString('es-ES')} páginas.`,
  /** Progreso del trabajo; `current` empieza en 1. */
  progress: (current: number, total: number): string =>
    `Redactando ${current.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}…`,
  /** Nombre accesible de cada marca. */
  mark: (page: number): string => `Zona para redactar en la página ${page.toLocaleString('es-ES')}`,
  /** Aviso cuando la redacción no se puede completar (el fichero no cambia). */
  failed: 'No se ha podido aplicar la redacción. El documento no se ha modificado.',
  /** Aviso cuando no hay documento listo o hay otra operación en curso. */
  notReady: 'Espera a que termine la operación en curso para redactar.',
} as const;
