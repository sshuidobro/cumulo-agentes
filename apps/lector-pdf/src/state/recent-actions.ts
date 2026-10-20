import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createLogger, type Result } from '@suite/shared';
import type { OpenedFile, RecentFile } from '@suite/platform';
import { RECENT_SHOWN } from '../core/recent';
import { msg } from '../ui/messages';
import { tabsMsg } from '../ui/messages-tabs';
import { openRequested } from './document-actions';
import { showNotice } from './notice';
import { services } from './services';
import { useViewer } from './viewer-store';

const log = createLogger('recent-actions');

export interface RecentState {
  /** Los últimos recientes (hasta `RECENT_SHOWN`), más reciente primero. */
  readonly list: readonly RecentFile[];
  readonly loading: boolean;
}

export const useRecent: UseBoundStore<StoreApi<RecentState>> = create<RecentState>()(() => ({
  list: [],
  loading: false,
}));

/** Número de la última actualización: solo la más reciente escribe en el store al terminar. */
let refreshSeq = 0;

/** Vuelve a leer la lista de recientes de la plataforma. Un fallo deja la lista como estaba. */
export async function refreshRecent(): Promise<void> {
  refreshSeq += 1;
  const seq = refreshSeq;
  useRecent.setState({ loading: true });
  try {
    const list = await services().platform.recentFiles();
    if (seq !== refreshSeq) return;
    useRecent.setState({ list: list.slice(0, RECENT_SHOWN), loading: false });
  } catch (cause) {
    log.warn('recentFiles', cause);
    if (seq === refreshSeq) useRecent.setState({ loading: false });
  }
}

/**
 * Reabre un reciente (PDF-049). Si ya no existe, avisa y actualiza la lista; si el usuario negó el permiso, no hace nada.
 * Con cambios sin guardar pregunta antes, como «Abrir» (`openRequested`).
 */
export async function openRecentFile(id: string): Promise<void> {
  const name = useRecent.getState().list.find((entry) => entry.id === id)?.name ?? '';
  let result: Result<OpenedFile | null>;
  try {
    result = await services().platform.openRecent(id);
  } catch (cause) {
    log.warn('openRecent', cause);
    showNotice(msg.openFailed(name));
    return;
  }
  if (!result.ok) {
    showNotice(result.error.code === 'not-found' ? tabsMsg.recentNotFound(name) : msg.openFailed(name));
    await refreshRecent();
    return;
  }
  if (result.value === null) return;
  await openRequested(result.value);
}

/** Quita un reciente de la lista (no toca el fichero). */
export async function forgetRecent(id: string): Promise<void> {
  await services().platform.removeRecent(id);
  await refreshRecent();
}

/** Vacía la lista de recientes (no toca los ficheros). */
export async function forgetAllRecent(): Promise<void> {
  await services().platform.clearRecents();
  await refreshRecent();
}

/**
 * Mantiene la lista al día: al arrancar y cada vez que cambia el documento abierto (apertura o guardado, que
 * reabre el fichero). Devuelve la baja.
 */
export function startRecentSync(): () => void {
  void refreshRecent();
  return useViewer.subscribe((state, previous) => {
    if (state.file !== previous.file) void refreshRecent();
  });
}
