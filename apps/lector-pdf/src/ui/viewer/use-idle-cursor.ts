import { useEffect, type RefObject } from 'react';

/** Tiempo sin mover el ratón tras el que se oculta el cursor en pantalla completa, en ms (PDF-097). */
export const IDLE_CURSOR_MS = 2000;

/**
 * Mientras `active`, marca el elemento con `data-idle="true"` tras `IDLE_CURSOR_MS` sin movimiento del ratón.
 * El CSS oculta el cursor con ese atributo; al volver a mover el ratón, se quita.
 */
export function useIdleCursor(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!active || el === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      delete el.dataset.idle;
    };
    const hideLater = (): void => {
      clear();
      timer = setTimeout(() => {
        timer = null;
        el.dataset.idle = 'true';
      }, IDLE_CURSOR_MS);
    };

    hideLater();
    window.addEventListener('pointermove', hideLater);
    return () => {
      window.removeEventListener('pointermove', hideLater);
      clear();
    };
  }, [active, ref]);
}
