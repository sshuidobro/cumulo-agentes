import { isTheme, DEFAULT_NIGHT_MODE, DEFAULT_THEME, type Theme } from '../core/appearance';
import { services } from './services';
import { useAppearance } from './appearance-store';

/** Claves de preferencia (con el prefijo de la app) del tema y del modo noche. */
export const THEME_PREF = 'theme';
export const NIGHT_MODE_PREF = 'nightMode';

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** Carga el tema y el modo noche guardados. Un valor no válido cuenta como ausente. Se llama al arrancar. */
export function loadAppearance(): void {
  const prefs = services().platform.prefs;
  useAppearance.setState({
    theme: prefs.get(THEME_PREF, isTheme) ?? DEFAULT_THEME,
    nightMode: prefs.get(NIGHT_MODE_PREF, isBoolean) ?? DEFAULT_NIGHT_MODE,
  });
}

export function setTheme(theme: Theme): void {
  useAppearance.setState({ theme });
  services().platform.prefs.set(THEME_PREF, theme);
}

export function toggleNightMode(): void {
  const next = !useAppearance.getState().nightMode;
  useAppearance.setState({ nightMode: next });
  services().platform.prefs.set(NIGHT_MODE_PREF, next);
}
