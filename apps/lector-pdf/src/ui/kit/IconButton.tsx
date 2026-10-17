import type { ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  /** Nombre accesible del botón (obligatorio: el botón es solo icono). */
  label: string;
  /** Atajo de teclado mostrado en el tooltip, p. ej. «Ctrl+O». */
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}

export function IconButton({ label, shortcut, onClick, disabled, pressed, children }: IconButtonProps) {
  const className = pressed ? `${styles.button} ${styles.pressed}` : styles.button;
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
