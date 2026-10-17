import { ShortcutRegistry } from '@suite/shared';
import { msg } from './messages';

/** Acciones de la app que tienen atajo. Cada ficha añade las suyas aquí. */
export type ShortcutId = 'open';

/** Registro único de atajos de la app (COM-011). */
export const shortcuts = new ShortcutRegistry<ShortcutId>([
  { id: 'open', chords: ['Mod+O'], description: msg.open },
]);

/** Atajo de «Abrir» formateado para mostrar (p. ej. «Ctrl+O»). */
export function formatOpenShortcut(isMac: boolean): string {
  return shortcuts.chordsFor('open', isMac)[0] ?? '';
}
