import { ShortcutRegistry } from '@suite/shared';
import { msg } from './messages';
import { propertiesMsg } from './messages-properties';
import { printMsg } from './messages-print';
import { viewMsg } from './messages-view';
import { tabsMsg } from './messages-tabs';

/** Acciones de la app que tienen atajo. Cada ficha añade las suyas aquí. */
export type ShortcutId =
  | 'open'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'cancel-tool'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-page'
  | 'actual-size'
  | 'fit-width'
  | 'rotate-right'
  | 'rotate-left'
  | 'next-page'
  | 'prev-page'
  | 'first-page'
  | 'last-page'
  | 'go-to-page'
  | 'tool-select'
  | 'tool-hand'
  | 'select-all'
  | 'toggle-sidebar'
  | 'back'
  | 'forward'
  | 'find'
  | 'find-next'
  | 'find-prev'
  | 'properties'
  | 'print'
  | 'fullscreen'
  | 'fullscreen-next'
  | 'fullscreen-prev'
  | 'next-tab'
  | 'prev-tab'
  | 'close-tab';

/** Registro único de atajos de la app (COM-011). */
export const shortcuts = new ShortcutRegistry<ShortcutId>([
  { id: 'open', chords: ['Mod+O'], description: msg.open },
  { id: 'save', chords: ['Mod+S'], description: msg.save },
  { id: 'save-as', chords: ['Mod+Shift+S'], description: msg.saveAs },
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
  { id: 'next-page', chords: ['ArrowRight', 'Mod+PageDown'], description: msg.nextPage },
  { id: 'prev-page', chords: ['ArrowLeft', 'Mod+PageUp'], description: msg.prevPage },
  { id: 'first-page', chords: ['Home', 'Mod+Shift+PageUp'], description: msg.firstPage },
  { id: 'last-page', chords: ['End', 'Mod+Shift+PageDown'], description: msg.lastPage },
  { id: 'go-to-page', chords: ['Mod+Shift+N'], description: msg.goToPage },
  { id: 'tool-select', chords: ['V'], description: msg.toolSelect },
  { id: 'tool-hand', chords: ['H'], description: msg.toolHand },
  { id: 'select-all', chords: ['Mod+A'], description: msg.selectAll },
  { id: 'back', chords: ['Alt+ArrowLeft'], description: msg.back },
  { id: 'forward', chords: ['Alt+ArrowRight'], description: msg.forward },
  { id: 'toggle-sidebar', chords: ['F4'], description: msg.toggleSidebar },
  { id: 'find', chords: ['Mod+F'], description: msg.search },
  { id: 'find-next', chords: ['F3'], description: msg.nextMatch },
  { id: 'find-prev', chords: ['Shift+F3'], description: msg.prevMatch },
  { id: 'properties', chords: ['Mod+D'], description: propertiesMsg.title },
  { id: 'print', chords: ['Mod+P'], description: printMsg.title },
  // En pantalla completa (PDF-097): Espacio, Intro y Re Pág/Av Pág, además de las flechas de página.
  { id: 'fullscreen', chords: ['Mod+L'], description: viewMsg.fullscreen },
  { id: 'fullscreen-next', chords: ['Space', 'Enter', 'PageDown'], description: msg.nextPage },
  { id: 'fullscreen-prev', chords: ['Backspace', 'PageUp'], description: msg.prevPage },
  // Pestañas (PDF-095). Chrome no deja a una página capturar Ctrl+Tab ni Ctrl+W: en el navegador usa la barra.
  { id: 'next-tab', chords: ['Mod+Tab'], description: tabsMsg.nextTab },
  { id: 'prev-tab', chords: ['Mod+Shift+Tab'], description: tabsMsg.prevTab },
  { id: 'close-tab', chords: ['Mod+W', 'Mod+F4'], description: tabsMsg.closeTab },
]);

/** Atajo de una acción formateado para mostrar (p. ej. «Ctrl+O»); vacío si no tiene. */
export function formatShortcut(id: ShortcutId, isMac: boolean): string {
  return shortcuts.chordsFor(id, isMac)[0] ?? '';
}

/** Atajo de «Abrir» formateado para mostrar (p. ej. «Ctrl+O»). */
export function formatOpenShortcut(isMac: boolean): string {
  return formatShortcut('open', isMac);
}
