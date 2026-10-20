/** Textos de «Leer en voz alta» (PDF-067 y PDF-114): menú, barra de lectura, atajos y avisos del motor. */
export const readAloudMsg = {
  noVoices: 'Tu sistema no tiene voces instaladas para leer en voz alta.',
  noText: 'Esta página no tiene texto que leer.',
  failed: 'No se ha podido leer en voz alta.',
  /** Entrada del menú «Vista» y descripción del atajo Ctrl+Mayús+V. */
  readPage: 'Leer esta página en voz alta',
  /** Entrada del menú «Vista» y descripción del atajo Ctrl+Mayús+B. */
  readToEnd: 'Leer hasta el final',
  /** Botón de la barra (nombre accesible fijo; `aria-pressed` indica la pausa) y descripción del atajo Ctrl+Mayús+C. */
  pause: 'Pausar',
  /** Texto emergente del botón de la barra cuando la lectura está pausada. */
  resume: 'Reanudar',
  /** Botón de la barra y descripción del atajo Ctrl+Mayús+E. */
  stop: 'Parar',
  /** Selector de velocidad de la barra. */
  speed: 'Velocidad de lectura',
  /** Selector de voz de la barra. */
  voice: 'Voz',
  /** Nombre accesible de la barra de lectura. */
  toolbar: 'Lectura en voz alta',
  /** Texto de la barra: página que se lee (`n` en base 1). */
  readingPage: (n: number): string => `Leyendo la página ${String(n)}`,
} as const;
