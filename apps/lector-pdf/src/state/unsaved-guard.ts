import { msg } from '../ui/messages';
import { useAnnotations } from './annotation-store';
import { askChoice } from './choice';
import { discardCurrentDraft } from './draft-sync';
import { pendingChanges, save } from './save-actions';
import { services } from './services';
import { activateTab, hasAnyUnsavedChanges, useTabs } from './tabs';
import { useViewer } from './viewer-store';

/**
 * Antes de cerrar o reemplazar el documento: sin cambios → 'proceed'. Con cambios, pregunta:
 * «Guardar» guarda y sigue si se ha guardado (o descargado); «No guardar» sigue; «Cancelar» (o un fallo) se queda.
 * Si al guardar no queda nada que escribir ('nothing'), no hay nada que perder y también sigue.
 */
export async function confirmDiscardOrSave(): Promise<'proceed' | 'cancel'> {
  if (!hasUnsavedChanges()) return 'proceed';
  const name = useViewer.getState().file?.name ?? '';
  const choice = await askChoice({
    title: msg.unsavedQuestion(name),
    options: [
      { label: msg.save, value: 'save' },
      { label: msg.discard, value: 'discard' },
      { label: msg.cancel, value: 'cancel' },
    ],
    cancel: 'cancel',
  });
  if (choice === 'discard') {
    await discardCurrentDraft();
    pendingChanges()?.discard();
    return 'proceed';
  }
  if (choice === 'save') {
    const result = await save();
    return result === 'saved' || result === 'downloaded' || result === 'nothing' ? 'proceed' : 'cancel';
  }
  return 'cancel';
}

/**
 * Confirma los cambios de todas las pestañas con cambios, de izquierda a derecha: cada una se activa y se pregunta.
 * Un «Cancelar» detiene el proceso y deja la app en esa pestaña. Devuelve true si todas pueden cerrarse.
 */
export async function confirmAllTabs(): Promise<boolean> {
  // Sin pestañas registradas, la pregunta es una sola para el documento abierto.
  if (useTabs.getState().tabs.length === 0) return (await confirmDiscardOrSave()) === 'proceed';
  const order = useTabs.getState().tabs.map((t) => t.id);
  for (const id of order) {
    // El estado se lee en cada vuelta: al activar otra pestaña cambia qué es «la activa» y sus cambios.
    const { tabs, activeId } = useTabs.getState();
    const tab = tabs.find((t) => t.id === id);
    if (tab === undefined) continue;
    const dirty = id === activeId ? hasUnsavedChanges() : tab.dirty;
    if (!dirty) continue;
    activateTab(id);
    if ((await confirmDiscardOrSave()) === 'cancel') return false;
  }
  return true;
}

/**
 * Registra el aviso de cierre de ventana. Sin cambios en ninguna pestaña permite cerrar; si las hay, cancela el cierre,
 * confirma pestaña a pestaña (`confirmAllTabs`) y, si se puede seguir, cierra la ventana.
 * Devuelve la función que lo deshace.
 */
export function installCloseGuard(): () => void {
  const { platform } = services();
  return platform.onCloseRequested(() => {
    if (!hasAnyUnsavedChanges()) return true;
    void confirmAllTabs().then(async (proceed) => {
      if (proceed) await platform.closeWindow();
    });
    return false;
  });
}

/** Hay anotaciones cambiadas desde la última vez que se guardaron (o se abrió el fichero), o cambios pendientes sucios. */
export function hasUnsavedChanges(): boolean {
  return useAnnotations.getState().undo.isDirty || (pendingChanges()?.isDirty() ?? false);
}
