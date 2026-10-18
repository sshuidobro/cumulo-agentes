import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';

export interface DialogAction {
  readonly label: string;
  readonly onClick: () => void;
  /** Deshabilitado: no se puede pulsar ni recibe el foco de Tab. */
  readonly disabled?: boolean;
}

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children?: ReactNode;
  /** Botones del pie, en orden. El primero recibe el foco al abrir el diálogo. */
  readonly actions: readonly DialogAction[];
  /** Llamado con Esc. Quien lo abre decide si se cierra (la app lo cierra siempre). */
  readonly onClose: () => void;
}

/** Diálogo modal (`role="dialog"`). Sin `open` no pinta nada. */
export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return createPortal(<DialogPanel {...props} />, document.body);
}

/** Elementos a los que se puede llegar con Tab dentro de `root`, en orden de documento. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function DialogPanel({ title, children, actions, onClose }: Omit<DialogProps, 'open'>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // El foco vuelve al elemento que tenía el foco al abrir (p. ej. el enlace que se pulsó).
  const returnFocusTo = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const panel = panelRef.current;
    const returnTo = returnFocusTo.current;
    panel?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      if (returnTo !== null && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Esc no debe llegar a los atajos de la ventana ni al visor.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || panelRef.current === null) return;
    // Tab no sale del diálogo: se da la vuelta de un extremo al otro.
    const items = focusableIn(panelRef.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && panelRef.current.contains(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.overlay}
      onKeyDown={onKeyDown}
      // El diálogo está en un portal, pero los eventos de React siguen su árbol: no deben llegar al visor.
      onPointerDown={(event) => { event.stopPropagation(); }}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.panel}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={styles.button}
              disabled={action.disabled ?? false}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
