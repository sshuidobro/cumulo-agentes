import { memo, type ReactNode } from 'react';
import { msg } from '../messages';
import styles from './Viewer.module.css';

export interface PageFrameProps {
  readonly index: number;
  readonly numPages: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  /** `true` cuando el lienzo de la página ya está dibujado. */
  readonly rendered?: boolean;
  /** Modo noche: el marco usa el fondo oscuro mientras no hay lienzo (PDF-020). */
  readonly night?: boolean;
  /** Contenido de la página (lienzo y mensajes); el marco pinta el blanco y el número debajo. */
  readonly children?: ReactNode;
}

/** Marco de una página: blanco, con su tamaño real y el número. El contenido lo dibuja `PageView`. */
export const PageFrame = memo(function PageFrame({
  index,
  numPages,
  top,
  left,
  width,
  height,
  rendered,
  night,
  children,
}: PageFrameProps) {
  return (
    <div
      role="group"
      aria-label={msg.pageOf(index + 1, numPages)}
      data-page-index={index}
      data-rendered={rendered === true ? 'true' : undefined}
      className={night === true ? `${styles.page} ${styles.night}` : styles.page}
      style={{ top, left, width, height }}
    >
      <span className={styles.marker} aria-hidden="true">
        {index + 1}
      </span>
      {children}
    </div>
  );
});
