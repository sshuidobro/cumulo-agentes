import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import buttonStyles from './IconButton.module.css';
import styles from './MenuButton.module.css';

/** Elemento del menú: un grupo de radio (una opción marcada) o una casilla (sí o no). */
export interface MenuItemSpec {
  readonly kind: 'radio' | 'checkbox';
  readonly label: string;
  readonly checked: boolean;
  /** Color CSS de una muestra junto al nombre (decorativa). */
  readonly swatch?: string;
  readonly onSelect: () => void;
}

/** Acción del menú (un `menuitem` normal, sin marca). `shortcut` es el atajo de teclado que se muestra junto al nombre. */
export interface MenuActionSpec {
  readonly kind: 'action';
  readonly label: string;
  readonly shortcut?: string;
  /** Miniatura (URL de imagen) que sustituye al texto: el nombre accesible sigue siendo `label`. */
  readonly thumbnail?: string;
  /** Entrada deshabilitada: se ve, pero no se puede elegir (PDF-048). */
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/** Rótulo de grupo (no se puede elegir): encabeza las opciones que siguen (PDF-116). */
export interface MenuHeadingSpec {
  readonly kind: 'heading';
  readonly label: string;
}

export type MenuEntry = MenuItemSpec | MenuActionSpec | MenuHeadingSpec | 'separator';

export interface MenuButtonProps {
  /** Nombre accesible del botón (es solo icono). */
  readonly label: string;
  readonly entries: readonly MenuEntry[];
  readonly children: ReactNode;
  /** Botón deshabilitado: no se abre el menú. */
  readonly disabled?: boolean;
  /** Orden de tabulación del botón (barras con foco itinerante). */
  readonly tabIndex?: number;
  /** Referencia al botón (React 19: `ref` es una prop normal). */
  readonly ref?: Ref<HTMLButtonElement>;
}

/** Entrega el nodo a una referencia de cualquier tipo (función u objeto). */
function assignRef(ref: Ref<HTMLButtonElement> | undefined, node: HTMLButtonElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref !== undefined && ref !== null) ref.current = node;
}

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** Elementos del menú en orden de documento. */
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
}

/**
 * Botón que despliega un menú (patrón ARIA *menu button*). Intro, Espacio, clic o ↓ lo abren con el foco en el
 * primer elemento; ↑/↓ (con Inicio y Fin) mueven el foco; Intro o Espacio activan; Esc y Tab cierran y devuelven
 * el foco al botón; un clic fuera cierra sin robar el foco.
 */
export function MenuButton({ label, entries, children, disabled, tabIndex, ref }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // El botón propio (para devolverle el foco) y la referencia recibida apuntan al mismo nodo.
  const setButton = (node: HTMLButtonElement | null): void => {
    buttonRef.current = node;
    assignRef(ref, node);
  };

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  // Al abrir, el foco va al primer elemento del menú.
  useEffect(() => {
    if (open) itemsOf(menuRef.current)[0]?.focus();
  }, [open]);

  // Un clic fuera del botón y del menú lo cierra.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const moveFocus = (target: 'next' | 'prev' | 'first' | 'last'): void => {
    const list = itemsOf(menuRef.current);
    if (list.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLElement ? list.indexOf(active) : -1;
    let index: number;
    if (target === 'first') index = 0;
    else if (target === 'last') index = list.length - 1;
    else if (current === -1) index = target === 'next' ? 0 : list.length - 1;
    else index = (current + (target === 'next' ? 1 : -1) + list.length) % list.length;
    list[index]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        moveFocus('next');
        break;
      case 'ArrowUp':
        moveFocus('prev');
        break;
      case 'Home':
        moveFocus('first');
        break;
      case 'End':
        moveFocus('last');
        break;
      case 'Escape':
      case 'Tab':
        // Esc no debe llegar a los atajos de la ventana; Tab cierra el menú sin dejar el foco perdido.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    setOpen(true);
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        ref={setButton}
        type="button"
        className={buttonStyles.button}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        tabIndex={tabIndex}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={onButtonKeyDown}
      >
        {children}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {entries.map((entry, index) =>
            entry === 'separator' ? (
              <div key={`separator-${String(index)}`} role="separator" className={styles.separator} />
            ) : entry.kind === 'heading' ? (
              <div key={`heading-${String(index)}`} role="presentation" className={styles.heading}>
                {entry.label}
              </div>
            ) : (
              <button
                key={entry.label}
                type="button"
                role={entry.kind === 'action' ? 'menuitem' : entry.kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
                aria-checked={entry.kind === 'action' ? undefined : entry.checked}
                title={entry.kind === 'action' && entry.shortcut !== undefined ? `${entry.label} (${entry.shortcut})` : undefined}
                className={styles.item}
                disabled={entry.kind === 'action' && entry.disabled === true}
                onClick={() => {
                  entry.onSelect();
                  close(true);
                }}
              >
                {entry.kind === 'action' ? (
                  <span className={styles.mark} aria-hidden="true" />
                ) : (
                  <span className={styles.mark} aria-hidden="true">
                    {entry.checked ? '✓' : ''}
                  </span>
                )}
                {entry.kind === 'action' && entry.thumbnail !== undefined ? (
                  <img src={entry.thumbnail} alt={entry.label} title={entry.label} className={styles.thumb} />
                ) : (
                  entry.label
                )}
                {entry.kind !== 'action' && entry.swatch !== undefined && (
                  <span className={styles.swatch} style={{ background: entry.swatch }} aria-hidden="true" />
                )}
                {entry.kind === 'action' && entry.shortcut !== undefined && (
                  <span className={styles.shortcut} aria-hidden="true">
                    {entry.shortcut}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
