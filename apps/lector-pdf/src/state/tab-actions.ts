import { isSaving } from './save-actions';
import { useChoice } from './choice';
import { usePasswordPrompt } from './password-prompt';
import { usePrintDialog } from './print-actions';
import { useSignatureCreation } from './signature-actions';
import { activateTab, closeTab, cycleTab, useTabs } from './tabs';

/**
 * Cambiar o cerrar pestaña no hace nada mientras se guarda, hay un diálogo modal abierto (elección, contraseña,
 * impresión) o se dibuja una firma (PDF-095).
 */
export function tabsLocked(): boolean {
  return (
    isSaving() ||
    useChoice.getState().active !== null ||
    usePasswordPrompt.getState().request !== null ||
    usePrintDialog.getState().open ||
    useSignatureCreation.getState().open
  );
}

/** Pasa a la pestaña `id` si no hay bloqueo. */
export function switchTab(id: string): void {
  if (tabsLocked()) return;
  activateTab(id);
}

/** Pasa a la pestaña siguiente (`1`) o anterior (`-1`), con vuelta, si no hay bloqueo. */
export function stepTab(direction: 1 | -1): void {
  if (tabsLocked()) return;
  cycleTab(direction);
}

/** Cierra la pestaña `id` (preguntando si tiene cambios) si no hay bloqueo. Devuelve false si no ha podido. */
export async function closeTabById(id: string): Promise<boolean> {
  if (tabsLocked()) return false;
  return (await closeTab(id)) === 'closed';
}

/** Cierra la pestaña activa (Ctrl+W). Sin pestañas no hace nada y devuelve false. */
export async function closeActiveTab(): Promise<boolean> {
  const { activeId } = useTabs.getState();
  if (activeId === null) return false;
  return closeTabById(activeId);
}
