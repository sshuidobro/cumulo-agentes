import { useEffect } from 'react';
import type { Theme } from '../core/appearance';
import { useAppearance } from '../state/appearance-store';

/**
 * Aplica el tema al `<html>`: `data-theme` claro u oscuro, o ninguno con «Sistema» (entonces manda
 * `prefers-color-scheme` en `theme.css`). `color-scheme` va con él para los controles nativos.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') {
    delete root.dataset.theme;
    root.style.colorScheme = 'light dark';
  } else {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }
}

/** Sincroniza el tema del store con el documento. Se usa una vez, en `App`. */
export function useTheme(): void {
  const theme = useAppearance((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
}
