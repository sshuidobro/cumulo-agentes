import type { KeyValueStore } from '@suite/platform';
import {
  emptyPositions,
  isPositionsState,
  lookupPosition,
  rememberPosition,
  type PositionsState,
  type ReadingPosition,
} from '../core/reading-positions';
import { goToPage } from './navigation';
import { services } from './services';
import { setZoomMode } from './view-actions';
import { useViewer } from './viewer-store';

/** Clave de preferencia donde se guardan las posiciones (dentro del prefijo de la app). */
export const POSITIONS_PREF_KEY = 'positions';

/** Retraso del guardado tras el último cambio de página, posición, zoom o rotación. */
const SAVE_DELAY_MS = 1000;

let pendingSave: ReturnType<typeof setTimeout> | null = null;

function prefs(): KeyValueStore {
  return services().platform.prefs;
}

/** Posiciones guardadas. Un valor corrupto en las preferencias cuenta como vacío. */
function readPositions(): PositionsState {
  return prefs().get(POSITIONS_PREF_KEY, isPositionsState) ?? emptyPositions();
}

function cancelPendingSave(): void {
  if (pendingSave === null) return;
  clearTimeout(pendingSave);
  pendingSave = null;
}

/** Posición actual del documento listo, o null si no hay documento listo. */
export function readCurrentPosition(): ReadingPosition | null {
  const { status, currentPage, currentYFraction, zoomMode, rotation } = useViewer.getState();
  if (status !== 'ready') return null;
  return { page: currentPage, yFraction: currentYFraction, zoomMode, rotation, updatedAt: Date.now() };
}

/**
 * Escribe ya la posición del documento abierto, sin esperar al retraso. Lo llaman `openDocument`, `closeDocument`
 * y `pagehide`, antes de que el documento cambie. Sin documento listo no hace nada.
 */
export function flushPosition(): void {
  cancelPendingSave();
  const { pdf } = useViewer.getState();
  const position = readCurrentPosition();
  if (position === null || pdf === null) return;
  prefs().set(POSITIONS_PREF_KEY, rememberPosition(readPositions(), pdf.fingerprint, position));
}

/**
 * Posición que se aplicará al próximo documento que pase a «listo» en lugar de la recordada (p. ej. tras guardar
 * y reabrir, PDF-037). Se consume en esa restauración; `null` = restaurar la recordada.
 */
let pendingRestore: ReadingPosition | null = null;

export function expectRestore(position: ReadingPosition | null): void {
  pendingRestore = position;
}

function scheduleSave(): void {
  cancelPendingSave();
  pendingSave = setTimeout(() => {
    pendingSave = null;
    flushPosition();
  }, SAVE_DELAY_MS);
}

/** Vuelve a la posición recordada del documento recién abierto. Si no hay, o la página ya no existe, no hace nada. */
function restorePosition(): void {
  const explicit = pendingRestore;
  pendingRestore = null;
  const { pdf, dims } = useViewer.getState();
  if (pdf === null || dims === null) return;
  const position = explicit ?? lookupPosition(readPositions(), pdf.fingerprint);
  if (position === null || position.page >= dims.count) return;
  setZoomMode(position.zoomMode);
  useViewer.setState({ rotation: position.rotation });
  goToPage(position.page, { yFraction: position.yFraction });
}

/**
 * Sincroniza la posición de lectura con las preferencias: guarda con retraso al cambiar de página, posición,
 * zoom o rotación; guarda al instante al ocultar la página; y restaura la posición al pasar a «listo».
 * Se llama una vez al arrancar. Devuelve la función que lo deshace.
 */
export function startPositionSync(): () => void {
  const unsubscribe = useViewer.subscribe((state, prev) => {
    if (state.status !== 'ready') return;
    if (prev.status !== 'ready') {
      restorePosition();
      return;
    }
    const changed =
      state.currentPage !== prev.currentPage ||
      state.currentYFraction !== prev.currentYFraction ||
      state.zoomMode !== prev.zoomMode ||
      state.rotation !== prev.rotation;
    if (changed) scheduleSave();
  });
  window.addEventListener('pagehide', flushPosition);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flushPosition);
    cancelPendingSave();
  };
}
