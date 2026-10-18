import type { ReactNode, Ref } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  /** Nombre accesible del botón (obligatorio: el botón es solo icono). */
  label: string;
  /** Atajo de teclado mostrado en el tooltip, p. ej. «Ctrl+O». */
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Orden de tabulación (barras con foco itinerante: solo un control lleva 0). */
  tabIndex?: number;
  /** Referencia al `<button>` (React 19: `ref` es una prop normal). */
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

export function IconButton({ label, shortcut, onClick, disabled, pressed, tabIndex, ref, children }: IconButtonProps) {
  const className = pressed ? `${styles.button} ${styles.pressed}` : styles.button;
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      tabIndex={tabIndex}
    >
      {children}
    </button>
  );
}
