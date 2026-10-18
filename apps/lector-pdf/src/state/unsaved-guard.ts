import { msg } from '../ui/messages';
import { useAnnotations } from './annotation-store';
import { askChoice } from './choice';
import { save } from './save-actions';
import { services } from './services';
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
  if (choice === 'discard') return 'proceed';
  if (choice === 'save') {
    const result = await save();
    return result === 'saved' || result === 'downloaded' || result === 'nothing' ? 'proceed' : 'cancel';
  }
  return 'cancel';
}

/**
 * Registra el aviso de cierre de ventana. Sin cambios permite cerrar; con cambios cancela el cierre, pregunta
 * con `confirmDiscardOrSave` y, si se puede seguir, cierra la ventana. Devuelve la función que lo deshace.
 */
export function installCloseGuard(): () => void {
  const { platform } = services();
  return platform.onCloseRequested(() => {
    if (!hasUnsavedChanges()) return true;
    void confirmDiscardOrSave().then(async (decision) => {
      if (decision === 'proceed') await platform.closeWindow();
    });
    return false;
  });
}

/** Hay anotaciones cambiadas desde la última vez que se guardaron (o se abrió el fichero). */
export function hasUnsavedChanges(): boolean {
  return useAnnotations.getState().undo.isDirty;
}
