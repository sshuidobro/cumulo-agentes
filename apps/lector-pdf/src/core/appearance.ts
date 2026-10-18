/** Tema de la interfaz: el del sistema, o forzado a claro u oscuro (PDF-020). */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'system';
export const DEFAULT_NIGHT_MODE = false;

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}
