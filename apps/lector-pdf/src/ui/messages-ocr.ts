/** Textos de «Reconocer texto (OCR)» (PDF-134): diálogo, progreso y avisos. */
export const ocrMsg = {
  /** Entrada del menú «Más acciones». */
  menuItem: 'Reconocer texto (OCR)…',
  /** Título del diálogo y del progreso. */
  title: 'Reconocer texto',
  language: 'Idioma del documento',
  spa: 'Español',
  eng: 'Inglés',
  both: 'Español e inglés',
  skipText: 'Omitir páginas que ya tienen texto',
  privacy: 'El reconocimiento se hace en este equipo; el documento no se envía a ningún sitio.',
  run: 'Reconocer',
  cancel: 'Cancelar',
  progressLabel: 'Progreso del reconocimiento',
  /** `current` empieza en 1. */
  progress: (current: number, total: number): string =>
    `Reconociendo página ${current.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}…`,
  done: (n: number): string => `Texto reconocido en ${n.toLocaleString('es-ES')} ${n === 1 ? 'página' : 'páginas'}.`,
  nothing: 'No se ha reconocido texto.',
  allHaveText: 'Todas las páginas elegidas ya tienen texto.',
  failed: 'No se ha podido reconocer el texto.',
  manyTitle: 'Reconocer muchas páginas',
  many: (n: number): string =>
    `Reconocer ${n.toLocaleString('es-ES')} páginas puede tardar varios minutos.`,
} as const;
