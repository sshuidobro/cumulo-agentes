import { useId, type MouseEvent, type ReactNode, type Ref } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  /** Nombre accesible del botón (obligatorio: el botón es solo icono). */
  label: string;
  /** Atajo de teclado mostrado en el tooltip, p. ej. «Ctrl+O». */
  shortcut?: string;
  /** Descripción accesible (PDF-072): va en el tooltip y en `aria-describedby`; el nombre no cambia. */
  description?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Orden de tabulación (barras con foco itinerante: solo un control lleva 0). */
  tabIndex?: number;
  /** Referencia al `<button>` (React 19: `ref` es una prop normal). */
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

export function IconButton({ label, shortcut, description, onClick, disabled, pressed, tabIndex, ref, children }: IconButtonProps) {
  const className = pressed ? `${styles.button} ${styles.pressed}` : styles.button;
  const descId = useId();
  const base = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-label={label}
      title={description === undefined ? base : `${base}\n${description}`}
      aria-describedby={description === undefined ? undefined : descId}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      tabIndex={tabIndex}
    >
      {children}
      {description !== undefined && (
        <span id={descId} hidden>
          {description}
        </span>
      )}
    </button>
  );
}
