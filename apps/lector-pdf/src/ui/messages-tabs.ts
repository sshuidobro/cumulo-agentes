/**
 * Textos de los documentos recientes (PDF-049) y de las pestañas (PDF-095).
 */
export const tabsMsg = {
  /** Título de la sección de recientes en la pantalla de inicio. */
  recentTitle: 'Recientes',
  /** Recientes que ya no se pueden reabrir (el fichero se ha movido o borrado). */
  recentUnavailable: 'No disponible',
  /** Quita un reciente no disponible de la lista. */
  recentRemove: 'Quitar de la lista',
  /** Aviso al elegir un reciente que ya no existe. */
  recentNotFound: (name: string): string => `No se encuentra “${name}”. Puede que se haya movido o borrado.`,
  /** Explicación cuando el navegador no puede guardar recientes (sin File System Access). */
  recentUnsupported: 'Este navegador no permite reabrir ficheros recientes.',
  /** Menú «Abrir recientes» junto a «Abrir». */
  recentMenu: 'Abrir recientes',
  /** Última entrada del menú: vacía la lista de recientes. */
  recentClear: 'Borrar la lista de recientes',
  /** Aviso al abrir un documento con ya el máximo de pestañas abiertas. */
  tooMany: 'Puedes tener hasta 10 documentos abiertos. Cierra alguno para abrir otro.',
  /** Aviso al abrir un documento que ya está abierto en una pestaña. */
  alreadyOpen: (name: string): string => `“${name}” ya está abierto.`,
  /** Nombre accesible de la barra de pestañas. */
  tabListLabel: 'Documentos abiertos',
  /** Botón × de una pestaña: nombra el documento que cierra. */
  closeNamed: (name: string): string => `Cerrar “${name}”`,
  /** Marca de cambios sin guardar (también leída por los lectores de pantalla). */
  unsavedChanges: 'Cambios sin guardar',
  /** Indicador de una pestaña que se está abriendo. */
  loading: 'Cargando',
  /** Indicador de una pestaña cuyo documento no se ha podido abrir. */
  loadFailed: 'No se ha podido abrir',
  /** Atajo: pasa al documento siguiente. */
  nextTab: 'Documento siguiente',
  /** Atajo: pasa al documento anterior. */
  prevTab: 'Documento anterior',
  /** Atajo: cierra el documento activo. */
  closeTab: 'Cerrar documento',
} as const;
