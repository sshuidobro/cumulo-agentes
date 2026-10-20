import { isSidebarState, sidebarOnOpen, type SidebarState, type SidebarTab } from '../core/sidebar';
import { services } from './services';
import { registerTabParticipant, type TabParticipant } from './tabs';
import { useViewer } from './viewer-store';

/** Clave de preferencia (con el prefijo de la app) que guarda el estado del panel. */
export const SIDEBAR_PREF = 'sidebar';

/** Pestaña por defecto cuando el documento no tiene una «última usada». */
const DEFAULT_TAB: SidebarTab = 'thumbnails';

/** Última pestaña mostrada: la que abre «Panel lateral» cuando está cerrado. */
let lastTab: SidebarTab = DEFAULT_TAB;

/** El estado visible del panel ya va en el visor; aquí solo la última pestaña usada del documento. */
interface SidebarSnapshot {
  readonly lastTab: SidebarTab;
}

const sidebarParticipant: TabParticipant<SidebarSnapshot> = {
  id: 'sidebar',
  order: 30,
  suspend(): SidebarSnapshot {
    const snapshot = { lastTab };
    lastTab = DEFAULT_TAB;
    return snapshot;
  },
  resume(snapshot: SidebarSnapshot): void {
    lastTab = snapshot.lastTab;
  },
  dispose(): Promise<void> {
    return Promise.resolve();
  },
};

/** Da de alta el panel lateral en el registro de pestañas. Llamar una vez al arrancar. */
export function registerSidebarParticipant(): void {
  registerTabParticipant(sidebarParticipant);
}

function setSidebar(next: SidebarState): void {
  useViewer.setState({ sidebar: next });
  if (next !== 'none') lastTab = next;
  services().platform.prefs.set(SIDEBAR_PREF, next);
}

/** Muestra la pestaña indicada (abre el panel si estaba cerrado). */
export function showSidebarTab(tab: SidebarTab): void {
  setSidebar(tab);
}

/** Abre el panel en la última pestaña usada (o miniaturas) o lo cierra si ya está abierto. */
export function toggleSidebar(): void {
  setSidebar(useViewer.getState().sidebar === 'none' ? lastTab : 'none');
}

/**
 * Estado inicial del panel al abrir un documento: lo que pide su `PageMode` (`/UseThumbs`, `/UseOutlines`);
 * si no pide nada, lo guardado en las preferencias (por defecto, cerrado).
 */
export function sidebarForOpenedDocument(pageMode: string | null): SidebarState {
  const saved = services().platform.prefs.get(SIDEBAR_PREF, isSidebarState);
  const state = sidebarOnOpen(pageMode, saved);
  if (state !== 'none') lastTab = state;
  return state;
}
