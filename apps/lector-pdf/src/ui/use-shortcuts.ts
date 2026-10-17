import { useEffect, useRef } from 'react';
import { isEditableTarget } from '@suite/shared';
import { services } from '../state/services';
import { shortcuts, type ShortcutId } from './shortcuts';

/** Atajos que también funcionan dentro de campos de texto (el resto se deja al propio campo). */
export const ALLOW_IN_EDITABLE: ReadonlySet<ShortcutId> = new Set<ShortcutId>(['open']);

/**
 * Escucha el teclado de la ventana y llama al manejador del atajo pulsado.
 * Dentro de un campo editable solo actúan los atajos de `ALLOW_IN_EDITABLE`.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const isMac = services().platform.isMac;
    const onKeyDown = (event: KeyboardEvent): void => {
      const id = shortcuts.match(event, isMac);
      if (id === null) return;
      if (isEditableTarget(event.target) && !ALLOW_IN_EDITABLE.has(id)) return;
      const handler = latest.current[id];
      if (handler === undefined) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
