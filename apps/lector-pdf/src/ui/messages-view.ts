/**
 * Textos del menú «Vista» (PDF-050): desplazamiento continuo o por páginas, y páginas por fila.
 */
export const viewMsg = {
  /** Nombre del menú «Vista» (junto a la rotación de la barra principal). */
  view: 'Vista',
  /** Desplazamiento continuo: todas las páginas en columna. */
  continuous: 'Desplazamiento continuo',
  /** Desplazamiento por páginas: una fila a la vez. */
  paged: 'Una página a la vez',
  /** Una página por fila. */
  spreadNone: 'Página simple',
  /** Dos páginas por fila (1-2, 3-4…). */
  spreadPairs: 'Doble página',
  /** Dos páginas por fila, con la portada sola (1, 2-3, 4-5…). */
  spreadCover: 'Doble página con portada',
  /** Entrada del menú «Vista» que entra en la pantalla completa (Ctrl+L). */
  fullscreen: 'Pantalla completa',
  /** Aviso que aparece al entrar en la pantalla completa. */
  fullscreenHint: 'Pulsa Esc para salir de la pantalla completa.',
} as const;
