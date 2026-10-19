import { create } from 'zustand';
import { viewMsg } from '../ui/messages-view';
import type { ViewMode } from '../core/view-mode';
import type { ZoomMode } from '../core/zoom';
import type { SidebarState } from '../core/sidebar';
import { useAnnotations, type AnnotationTool } from './annotation-store';
import { showNotice } from './notice';
import { applyViewMode, setZoomMode } from './view-actions';
import { services } from './services';
import { useViewer } from './viewer-store';

/** Pantalla completa de lectura y presentación (PDF-097). `on` es el estado de la interfaz. */
export const useFullscreen = create<{ readonly on: boolean }>()(() => ({ on: false }));

/** Estado anterior a la pantalla completa, que se restaura al salir. */
interface SavedState {
  readonly viewMode: ViewMode;
  readonly zoomMode: ZoomMode;
  readonly sidebar: SidebarState;
  readonly annotationTool: AnnotationTool;
}

let saved: SavedState | null = null;

/**
 * Entra en pantalla completa: modo por páginas con la misma distribución de páginas por fila, ajuste a página,
 * panel cerrado y sin herramienta de anotación. La preferencia guardada no cambia. Si el entorno no permite
 * la pantalla completa del sistema, la vista se oculta igualmente (pantalla completa dentro de la ventana).
 */
export function enterFullscreen(): void {
  if (useFullscreen.getState().on) return;
  const viewer = useViewer.getState();
  saved = {
    viewMode: viewer.viewMode,
    zoomMode: viewer.zoomMode,
    sidebar: viewer.sidebar,
    annotationTool: useAnnotations.getState().tool,
  };
  useFullscreen.setState({ on: true });
  applyViewMode({ scroll: 'paged', spread: viewer.viewMode.spread }, { persist: false });
  setZoomMode({ kind: 'fit-page' });
  useViewer.setState({ sidebar: 'none' });
  useAnnotations.setState({ tool: 'none' });
  showNotice(viewMsg.fullscreenHint);
  void services().platform.setFullscreen(true);
}

/** Sale de la pantalla completa, restaura la vista anterior y pide al sistema salir de la pantalla completa. */
export function exitFullscreen(): void {
  if (!useFullscreen.getState().on) return;
  restoreView();
  void services().platform.setFullscreen(false);
}

/** Alterna la pantalla completa (Ctrl+L). */
export function toggleFullscreen(): void {
  if (useFullscreen.getState().on) exitFullscreen();
  else enterFullscreen();
}

/**
 * Sigue los cambios de pantalla completa del sistema (F11 o el SO): si el sistema sale, la vista se restaura.
 * Devuelve la baja de la suscripción.
 */
export function watchSystemFullscreen(): () => void {
  return services().platform.onFullscreenChange((on) => {
    if (!on) restoreView();
  });
}

function restoreView(): void {
  const previous = saved;
  saved = null;
  useFullscreen.setState({ on: false });
  if (previous === null) return;
  applyViewMode(previous.viewMode, { persist: false });
  setZoomMode(previous.zoomMode);
  useViewer.setState({ sidebar: previous.sidebar });
  useAnnotations.setState({ tool: previous.annotationTool });
}
