import { ShortcutRegistry } from '@suite/shared';
import { msg } from './messages';

/** Acciones de la app que tienen atajo. Cada ficha añade las suyas aquí. */
export type ShortcutId =
  | 'open'
  | 'undo'
  | 'redo'
  | 'cancel-tool'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-page'
  | 'actual-size'
  | 'fit-width'
  | 'rotate-right'
  | 'rotate-left';

/** Registro único de atajos de la app (COM-011). */
export const shortcuts = new ShortcutRegistry<ShortcutId>([
  { id: 'open', chords: ['Mod+O'], description: msg.open },
  { id: 'undo', chords: ['Mod+Z'], description: msg.undo },
  { id: 'redo', chords: ['Mod+Y', 'Mod+Shift+Z'], description: msg.redo },
  { id: 'cancel-tool', chords: ['Escape'], description: msg.cancelTool },
  { id: 'zoom-in', chords: ['Mod+Plus', 'Mod+=', 'Mod+code:NumpadAdd'], description: msg.zoomIn },
  { id: 'zoom-out', chords: ['Mod+Minus', 'Mod+code:NumpadSubtract'], description: msg.zoomOut },
  { id: 'fit-page', chords: ['Mod+0'], description: msg.fitPage },
  { id: 'actual-size', chords: ['Mod+1'], description: msg.actualSize },
  { id: 'fit-width', chords: ['Mod+2'], description: msg.fitWidth },
  { id: 'rotate-right', chords: ['Mod+Shift+ArrowRight'], description: msg.rotateRight },
  { id: 'rotate-left', chords: ['Mod+Shift+ArrowLeft'], description: msg.rotateLeft },
]);

/** Atajo de una acción formateado para mostrar (p. ej. «Ctrl+O»); vacío si no tiene. */
export function formatShortcut(id: ShortcutId, isMac: boolean): string {
  return shortcuts.chordsFor(id, isMac)[0] ?? '';
}

/** Atajo de «Abrir» formateado para mostrar (p. ej. «Ctrl+O»). */
export function formatOpenShortcut(isMac: boolean): string {
  return formatShortcut('open', isMac);
}
