import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createLogger } from '@suite/shared';
import { tabsMsg } from '../ui/messages-tabs';
import { closeDocument } from './document-actions';
import { useAnnotations } from './annotation-store';
import { showNotice } from './notice';
import { confirmDiscardOrSave, hasUnsavedChanges } from './unsaved-guard';
import { useViewer, type DocStatus } from './viewer-store';

const log = createLogger('tabs');

/** Número máximo de documentos abiertos a la vez (pestañas). */
export const MAX_TABS = 10;

/**
 * Módulo con estado de documento que guarda y restaura su estado al cambiar de pestaña.
 * `resume` se llama en orden ascendente de `order`; `suspend` en orden descendente.
 */
export interface TabParticipant<S> {
  /** Único: 'document', 'annotations', 'forms', 'history', 'search', 'position', 'sidebar', 'drafts'… */
  readonly id: string;
  /** Resume en orden ascendente, suspend en descendente. document = 0. */
  readonly order: number;
  /** Saca el estado de documento del módulo y lo deja como sin documento; cancela sus tareas en segundo plano. No libera recursos. */
  suspend(): S;
  /** Restaura exactamente y relanza las tareas en segundo plano pendientes. */
  resume(snapshot: S): void;
  /** Libera los recursos de una pestaña suspendida que se cierra. */
  dispose(snapshot: S): Promise<void>;
}

/** Datos de una pestaña que se muestran en la barra. */
export interface TabInfo {
  readonly id: string;
  /** Nombre del fichero (o el que se está abriendo). */
  readonly title: string;
  readonly status: DocStatus;
  readonly dirty: boolean;
  /** `pdf.fingerprint` cuando el documento está listo. */
  readonly fingerprint: string | null;
  /** `file.path` (Tauri) o null. */
  readonly path: string | null;
}

interface TabsState {
  readonly tabs: readonly TabInfo[];
  readonly activeId: string | null;
}

export const useTabs: UseBoundStore<StoreApi<TabsState>> = create<TabsState>()(() => ({ tabs: [], activeId: null }));

/** Instantáneas de las pestañas suspendidas: pestaña → (participante → estado). No están en zustand. */
const snapshots = new Map<string, Map<string, unknown>>();
const participants = new Map<string, TabParticipant<unknown>>();
let switching = false;

/** Da de alta un participante. Idempotente por `id`: un segundo registro con el mismo id lo reemplaza. */
export function registerTabParticipant<S>(participant: TabParticipant<S>): void {
  participants.set(participant.id, participant);
}

/** Quita un participante del registro (p. ej. al detener la sincronización que lo daba de alta). */
export function unregisterTabParticipant(id: string): void {
  participants.delete(id);
}

/** Participantes por orden ascendente (para `resume`) o descendente (para `suspend`). */
function ordered(ascending: boolean): TabParticipant<unknown>[] {
  const list = [...participants.values()].sort((a, b) => a.order - b.order);
  return ascending ? list : list.reverse();
}

/** `true` mientras se cambia de pestaña: los cambios del visor en ese momento no actualizan la barra. */
export function isSwitchingTab(): boolean {
  return switching;
}

function tabsNow(): readonly TabInfo[] {
  return useTabs.getState().tabs;
}

/** Una pestaña cuya apertura está en curso no se puede volver a mostrar: al salir de ella se elimina. */
function isLoadingTab(info: TabInfo): boolean {
  return info.status === 'loading';
}

/** Información de la pestaña activa leída de los stores. El título y la ruta anteriores se conservan si faltan. */
function liveInfo(id: string, prev: TabInfo): TabInfo {
  const { status, file, pdf, loadingName } = useViewer.getState();
  return {
    id,
    title: file?.name ?? loadingName ?? prev.title,
    status,
    dirty: hasUnsavedChanges(),
    fingerprint: pdf?.fingerprint ?? null,
    path: file?.path ?? prev.path,
  };
}

function sameInfo(a: TabInfo, b: TabInfo): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.status === b.status &&
    a.dirty === b.dirty &&
    a.fingerprint === b.fingerprint &&
    a.path === b.path
  );
}

function replaceTab(info: TabInfo): void {
  const list = tabsNow();
  const index = list.findIndex((t) => t.id === info.id);
  if (index < 0) return;
  const current = list[index];
  if (current === undefined || sameInfo(current, info)) return;
  const next = [...list];
  next[index] = info;
  useTabs.setState({ tabs: next });
}

/** Mantiene al día la información de la pestaña activa mientras se usa. */
function syncActive(): void {
  if (switching) return;
  const id = useTabs.getState().activeId;
  if (id === null) return;
  const prev = tabsNow().find((t) => t.id === id);
  if (prev !== undefined) replaceTab(liveInfo(id, prev));
}

useViewer.subscribe(syncActive);
useAnnotations.subscribe(syncActive);

/** Pone al día la barra con los cambios de la pestaña activa (p. ej. cambios pendientes de organizar). */
export function refreshActiveTab(): void {
  syncActive();
}

/**
 * Suspende la pestaña activa: guarda su información y la instantánea de cada participante (orden descendente).
 * Llamar solo con `switching` activo.
 */
function suspendTab(id: string): TabInfo {
  const prev = tabsNow().find((t) => t.id === id);
  const info = liveInfo(id, prev ?? { id, title: '', status: 'empty', dirty: false, fingerprint: null, path: null });
  replaceTab(info);
  const saved = new Map<string, unknown>();
  for (const participant of ordered(false)) saved.set(participant.id, participant.suspend());
  snapshots.set(id, saved);
  return info;
}

/** Restaura la instantánea de una pestaña (orden ascendente). Solo llama a los participantes que la tienen. */
function resumeTab(id: string): void {
  const saved = snapshots.get(id);
  snapshots.delete(id);
  if (saved === undefined) return;
  for (const participant of ordered(true)) {
    if (saved.has(participant.id)) participant.resume(saved.get(participant.id));
  }
}

async function disposeSnapshot(saved: Map<string, unknown>): Promise<void> {
  for (const participant of ordered(true)) {
    if (!saved.has(participant.id)) continue;
    try {
      await participant.dispose(saved.get(participant.id));
    } catch (cause) {
      log.warn('dispose', cause);
    }
  }
}

/** Quita una pestaña inactiva de la lista y libera su instantánea. No cambia la activa. */
async function removeTab(id: string): Promise<void> {
  const saved = snapshots.get(id);
  snapshots.delete(id);
  useTabs.setState({ tabs: tabsNow().filter((t) => t.id !== id) });
  if (saved !== undefined) await disposeSnapshot(saved);
}

/** Pasa a la pestaña `id`. Suspende la activa y elimina la que estaba cargando. */
export function activateTab(id: string): void {
  const { activeId } = useTabs.getState();
  if (id === activeId || !tabsNow().some((t) => t.id === id)) return;
  let discarded: TabInfo | null = null;
  switching = true;
  try {
    if (activeId !== null) {
      const info = suspendTab(activeId);
      if (isLoadingTab(info)) discarded = info;
    }
    useTabs.setState({ activeId: id });
    resumeTab(id);
  } finally {
    switching = false;
  }
  if (discarded !== null) void removeTab(discarded.id);
  syncActive();
}

/**
 * Abre una pestaña nueva a la derecha de la activa y la activa. Devuelve false (con aviso) si ya hay `MAX_TABS`.
 * Si la activa estaba cargando, se elimina al suspenderla.
 */
export function beginNewTab(title: string, path: string | null): boolean {
  if (tabsNow().length >= MAX_TABS) {
    showNotice(tabsMsg.tooMany);
    return false;
  }
  const previous = useTabs.getState().activeId;
  const list = [...tabsNow()];
  let at = list.length;
  let discarded: TabInfo | null = null;
  switching = true;
  try {
    if (previous !== null) {
      const index = list.findIndex((t) => t.id === previous);
      const info = suspendTab(previous);
      if (isLoadingTab(info)) {
        discarded = info;
        list.splice(index, 1);
        at = index;
      } else {
        list[index] = info;
        at = index + 1;
      }
    }
    const id = crypto.randomUUID();
    list.splice(at, 0, { id, title, status: 'empty', dirty: false, fingerprint: null, path });
    useTabs.setState({ tabs: list, activeId: id });
  } finally {
    switching = false;
  }
  if (discarded !== null) void removeTab(discarded.id);
  syncActive();
  return true;
}

/** Cierra la pestaña activa (ya confirmada) y activa la vecina de la derecha, o la de la izquierda. */
async function closeActive(id: string): Promise<'closed'> {
  await closeDocument();
  const list = tabsNow();
  const index = list.findIndex((t) => t.id === id);
  if (index < 0) return 'closed';
  const neighbor = list[index + 1] ?? list[index - 1] ?? null;
  useTabs.setState({ tabs: list.filter((t) => t.id !== id), activeId: null });
  if (neighbor !== null) activateTab(neighbor.id);
  return 'closed';
}

/**
 * Cierra una pestaña. Inactiva sin cambios: se libera sin tocar la activa. Inactiva con cambios: se activa y se
 * sigue como activa. Activa: pregunta por los cambios; «Cancelar» devuelve 'cancelled'.
 */
export async function closeTab(id: string): Promise<'closed' | 'cancelled'> {
  const info = tabsNow().find((t) => t.id === id);
  if (info === undefined) return 'closed';
  if (id !== useTabs.getState().activeId) {
    if (!info.dirty) {
      await removeTab(id);
      return 'closed';
    }
    activateTab(id);
  }
  if ((await confirmDiscardOrSave()) === 'cancel') return 'cancelled';
  return closeActive(id);
}

/** Pasa a la pestaña siguiente (`1`) o anterior (`-1`), con vuelta. */
export function cycleTab(direction: 1 | -1): void {
  const list = tabsNow();
  const { activeId } = useTabs.getState();
  const index = list.findIndex((t) => t.id === activeId);
  if (index < 0) return;
  const next = list[(index + direction + list.length) % list.length];
  if (next !== undefined) activateTab(next.id);
}

/** Primera pestaña que cumple todos los criterios dados, o null. Sin criterios no encuentra nada. */
export function findTab(match: { readonly path?: string; readonly fingerprint?: string }): TabInfo | null {
  if (match.path === undefined && match.fingerprint === undefined) return null;
  return (
    tabsNow().find(
      (t) =>
        (match.path === undefined || t.path === match.path) &&
        (match.fingerprint === undefined || t.fingerprint === match.fingerprint),
    ) ?? null
  );
}

/** Hay cambios sin guardar en la pestaña activa o en alguna suspendida. */
export function hasAnyUnsavedChanges(): boolean {
  const { activeId } = useTabs.getState();
  return hasUnsavedChanges() || tabsNow().some((t) => t.id !== activeId && t.dirty);
}

/** Vacía el registro, las instantáneas y los participantes. Solo para las pruebas. */
export function resetTabsForTests(): void {
  snapshots.clear();
  participants.clear();
  switching = false;
  useTabs.setState({ tabs: [], activeId: null });
}
