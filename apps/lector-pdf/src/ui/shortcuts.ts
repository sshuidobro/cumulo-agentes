import { ShortcutRegistry } from '@suite/shared';
import { msg } from './messages';

/** Acciones de la app que tienen atajo. Cada ficha añade las suyas aquí. */
export type ShortcutId = 'open' | 'undo' | 'redo' | 'cancel-tool';

/** Registro único de atajos de la app (COM-011). */
export const shortcuts = new ShortcutRegistry<ShortcutId>([
  { id: 'open', chords: ['Mod+O'], description: msg.open },
  { id: 'undo', chords: ['Mod+Z'], description: msg.undo },
  { id: 'redo', chords: ['Mod+Y', 'Mod+Shift+Z'], description: msg.redo },
  { id: 'cancel-tool', chords: ['Escape'], description: msg.cancelTool },
]);

/** Atajo de una acción formateado para mostrar (p. ej. «Ctrl+O»); vacío si no tiene. */
export function formatShortcut(id: ShortcutId, isMac: boolean): string {
  return shortcuts.chordsFor(id, isMac)[0] ?? '';
}

/** Atajo de «Abrir» formateado para mostrar (p. ej. «Ctrl+O»). */
export function formatOpenShortcut(isMac: boolean): string {
  return formatShortcut('open', isMac);
}
