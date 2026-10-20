import { printMsg } from './messages-print';

/** Textos de «Exportar» (PDF-113): diálogo, progreso, avisos y la entrada «Más acciones». */
export const exportMsg = {
  title: 'Exportar',
  /** Entrada del menú «Más acciones». */
  menuItem: 'Exportar…',
  formatLegend: 'Formato',
  png: 'Imagen PNG',
  jpeg: 'Imagen JPEG',
  txt: 'Texto (.txt)',
  /** Nombre del filtro del diálogo de guardar para el ZIP de varias imágenes. */
  zipFilter: 'Archivo ZIP',
  resolution: 'Resolución',
  dpiOption: (n: number): string => `${String(n)} ppp`,
  withComments: 'Incluir comentarios',
  pagesLegend: printMsg.pagesLegend,
  allPages: printMsg.allPages,
  currentPage: printMsg.currentPage,
  rangePages: printMsg.rangePages,
  rangeField: printMsg.rangeField,
  rangeExample: printMsg.rangeExample,
  invalidRange: printMsg.invalidRange,
  export: 'Exportar',
  cancel: 'Cancelar',
  progressTitle: 'Exportando',
  progressLabel: 'Progreso de la exportación',
  progress: (done: number, total: number): string =>
    `Exportando página ${done.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}…`,
  done: 'Exportación terminada.',
  failed: 'No se ha podido exportar.',
  unsavedNotIncluded: 'Hay cambios sin guardar que no se han podido incluir en la exportación.',
  tooBig: 'Demasiado grande: reduce el rango o la resolución.',
  reduced: (dpi: number): string => `Algunas páginas se han exportado a ${String(dpi)} ppp porque eran demasiado grandes.`,
  /** Copiar no permitido: aviso al intentar exportar y explicación de la entrada deshabilitada. */
  blocked: 'El autor de este PDF no permite copiar su contenido.',
  manyTitle: 'Exportar muchas páginas',
  many: (n: number): string =>
    `Vas a exportar ${n.toLocaleString('es-ES')} páginas como imágenes. Puede tardar varios minutos.`,
} as const;
