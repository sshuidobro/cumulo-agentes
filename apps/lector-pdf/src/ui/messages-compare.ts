/** Textos de «Comparar con otro PDF…» (PDF-112): menú, vista, progreso y avisos. */
export const compareMsg = {
  /** Entrada del menú «Más acciones». */
  menuItem: 'Comparar con otro PDF…',
  title: (a: string, b: string): string => `Comparar «${a}» con «${b}»`,
  listLabel: 'Cambios por página',
  progressLabel: 'Progreso de la comparación',
  progress: (done: number, total: number): string =>
    `Comparando página ${Math.min(done + 1, total).toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}…`,
  cancel: 'Cancelar',
  close: 'Cerrar comparación',
  noChanges: 'No hay diferencias de texto entre los dos documentos.',
  summary: (changes: number, pages: number): string =>
    `${changes.toLocaleString('es-ES')} ${changes === 1 ? 'cambio' : 'cambios'} en ${pages.toLocaleString('es-ES')} ${pages === 1 ? 'página' : 'páginas'}`,
  cancelledNote: (page: number): string =>
    `Comparación cancelada: se muestran los cambios hasta la página ${page.toLocaleString('es-ES')}.`,
  pageHeader: (n: number): string => `Página ${n.toLocaleString('es-ES')}`,
  /** Fila de la lista: «Página N · texto del cambio». */
  pageRow: (n: number, text: string): string => `${compareMsg.pageHeader(n)} · ${text}`,
  onlyInA: (n: number): string => `La página ${n.toLocaleString('es-ES')} solo está en el documento abierto.`,
  onlyInB: (n: number): string => `La página ${n.toLocaleString('es-ES')} solo está en el otro documento.`,
  tooDifferent: (n: number): string =>
    `La página ${n.toLocaleString('es-ES')} es muy distinta: compárala con la superposición.`,
  /** Panel de páginas de la comparación (PDF-117). */
  selectChange: 'Selecciona un cambio',
  previousChange: 'Cambio anterior',
  nextChange: 'Cambio siguiente',
  viewMode: 'Modo de comparación',
  sideBySide: 'Lado a lado',
  overlay: 'Superposición',
  openDocument: 'Documento abierto',
  missingPage: 'No existe en este documento',
  overlayLegend: 'Negro: igual. Color: diferente.',
} as const;
