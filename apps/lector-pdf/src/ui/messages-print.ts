/** Textos de «Imprimir» (PDF-044): diálogo de opciones, progreso, avisos y el menú «Más acciones». */
export const printMsg = {
  title: 'Imprimir',
  /** Entrada del menú «Más acciones» (el atajo se añade junto al nombre). */
  menuItem: 'Imprimir…',
  /** Botón de la barra y nombre del botón de confirmar del diálogo. */
  print: 'Imprimir',
  cancel: 'Cancelar',
  pagesLegend: 'Páginas a imprimir',
  allPages: 'Todas',
  currentPage: (n: number): string => `Página actual (${String(n)})`,
  rangePages: 'Páginas',
  rangeField: 'Rango de páginas',
  rangeExample: '1-3, 5',
  withComments: 'Imprimir comentarios',
  autoRotate: 'Orientación automática',
  highQuality: 'Alta calidad (más lento)',
  willPrint: (n: number): string =>
    n === 1 ? 'Se imprimirá 1 página.' : `Se imprimirán ${n.toLocaleString('es-ES')} páginas.`,
  invalidRange: (last: number): string =>
    `Escribe páginas entre 1 y ${last.toLocaleString('es-ES')}, por ejemplo 1-3, 5`,
  manyTitle: 'Imprimir muchas páginas',
  manyPages: (n: number): string =>
    `Vas a imprimir ${n.toLocaleString('es-ES')} páginas. Prepararlas puede tardar varios minutos.`,
  preparingTitle: 'Preparando la impresión',
  progressLabel: 'Progreso de la preparación',
  preparing: (page: number, total: number): string =>
    `Preparando página ${page.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}…`,
  unsavedNotIncluded: 'Hay cambios sin guardar que no se han podido incluir en la impresión.',
  failed: 'No se ha podido preparar la impresión.',
  noDocument: 'Abre un documento para imprimirlo.',
} as const;
