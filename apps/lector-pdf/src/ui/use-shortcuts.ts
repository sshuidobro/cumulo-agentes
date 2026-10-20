import { useEffect, useRef } from 'react';
import { isEditableTarget } from '@suite/shared';
import { services } from '../state/services';
import { shortcuts, type ShortcutId } from './shortcuts';

/** Atajos que también funcionan dentro de campos de texto (el resto se deja al propio campo). */
export const ALLOW_IN_EDITABLE: ReadonlySet<ShortcutId> = new Set<ShortcutId>(['open', 'save', 'save-as', 'go-to-page', 'find']);

/**
 * Manejador de un atajo. Si devuelve `false`, el atajo no se ha consumido: el evento sigue su curso
 * (p. ej. las flechas hacen scroll horizontal cuando el contenido es más ancho que el visor).
 */
export type ShortcutHandler = (event: KeyboardEvent) => unknown;

/** Las flechas sobre un botón de opción recorren su grupo (lo hace el navegador): no son atajos de página. */
function isArrowInRadio(event: KeyboardEvent): boolean {
  return event.key.startsWith('Arrow') && event.target instanceof HTMLInputElement && event.target.type === 'radio';
}

/**
 * Escucha el teclado de la ventana y llama al manejador del atajo pulsado.
 * Dentro de un campo editable solo actúan los atajos de `ALLOW_IN_EDITABLE`.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutId, ShortcutHandler>>): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const isMac = services().platform.isMac;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isArrowInRadio(event)) return;
      const id = shortcuts.match(event, isMac);
      if (id === null) return;
      if (isEditableTarget(event.target) && !ALLOW_IN_EDITABLE.has(id)) return;
      const handler = latest.current[id];
      if (handler === undefined) return;
      if (handler(event) === false) return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
