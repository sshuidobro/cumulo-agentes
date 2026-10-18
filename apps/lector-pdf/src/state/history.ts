import type { NamedAction, PdfDest } from '../core/links';
import { resolveDest } from '../engine/dest';
import { msg } from '../ui/messages';
import { firstPage, goToPage, lastPage, nextPage, prevPage } from './navigation';
import { showNotice } from './notice';
import { setZoomMode } from './view-actions';
import { useViewer, type HistoryFlags } from './viewer-store';

/** Posición del visor: página (0-based) y fracción vertical dentro de ella. */
export interface ViewPosition {
  readonly page: number;
  readonly yFraction: number;
}

/** Tamaño máximo de cada pila del historial. */
export const MAX_HISTORY = 50;

let backStack: readonly ViewPosition[] = [];
let forwardStack: readonly ViewPosition[] = [];

// Al abrir otro documento, las posiciones del anterior no tienen sentido.
useViewer.subscribe((state, previous) => {
  if (state.pdf !== previous.pdf) clearHistory();
});

/**
 * Sigue un enlace interno: guarda la posición actual en «atrás», vacía «adelante», aplica el zoom del
 * destino si lo pide y lleva el visor a la posición. Si el destino no existe, muestra un aviso y no cambia nada.
 */
export async function navigateToDest(dest: PdfDest): Promise<void> {
  const loaded = useViewer.getState().pdf;
  if (loaded === null) return;
  const resolved = await resolveDest(loaded.doc, dest);
  // Si entretanto se ha abierto otro documento, el destino ya no vale.
  if (useViewer.getState().pdf !== loaded) return;
  if (resolved === null) {
    showNotice(msg.linkBroken);
    return;
  }

  backStack = pushCapped(backStack, currentPosition());
  forwardStack = [];
  if (resolved.zoom !== null) setZoomMode(resolved.zoom);
  const { xFraction, yFraction } = resolved;
  goToPage(resolved.pageIndex, {
    yFraction: yFraction ?? 0,
    ...(xFraction === null ? {} : { xFraction }),
  });
  syncFlags();
}

/** Vuelve a la vista anterior del historial. Sin vistas anteriores no hace nada. */
export function goBack(): void {
  const target = backStack[backStack.length - 1];
  if (target === undefined) return;
  backStack = backStack.slice(0, -1);
  forwardStack = pushCapped(forwardStack, currentPosition());
  restore(target);
}

/** Vuelve a la vista siguiente del historial. Sin vistas siguientes no hace nada. */
export function goForward(): void {
  const target = forwardStack[forwardStack.length - 1];
  if (target === undefined) return;
  forwardStack = forwardStack.slice(0, -1);
  backStack = pushCapped(backStack, currentPosition());
  restore(target);
}

export function canGoBack(): boolean {
  return backStack.length > 0;
}

export function canGoForward(): boolean {
  return forwardStack.length > 0;
}

/** Vacía el historial de ambos sentidos. */
export function clearHistory(): void {
  backStack = [];
  forwardStack = [];
  syncFlags();
}

/** Aplica una acción con nombre del PDF (PDF-014): páginas o historial. */
export function runNamedAction(action: NamedAction): void {
  switch (action) {
    case 'next-page':
      nextPage();
      break;
    case 'prev-page':
      prevPage();
      break;
    case 'first-page':
      firstPage();
      break;
    case 'last-page':
      lastPage();
      break;
    case 'back':
      goBack();
      break;
    case 'forward':
      goForward();
      break;
  }
}

function currentPosition(): ViewPosition {
  const { currentPage, currentYFraction } = useViewer.getState();
  return { page: currentPage, yFraction: currentYFraction };
}

function restore(target: ViewPosition): void {
  goToPage(target.page, { yFraction: target.yFraction });
  syncFlags();
}

/** Añade al final y descarta el más antiguo si la pila pasa de `MAX_HISTORY`. */
function pushCapped(stack: readonly ViewPosition[], item: ViewPosition): readonly ViewPosition[] {
  const next = [...stack, item];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

function syncFlags(): void {
  const flags: HistoryFlags = { canBack: canGoBack(), canForward: canGoForward() };
  const current = useViewer.getState().historyState;
  if (current.canBack !== flags.canBack || current.canForward !== flags.canForward) {
    useViewer.setState({ historyState: flags });
  }
}
