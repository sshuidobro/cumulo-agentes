import { memo } from 'react';
import { msg } from '../messages';
import styles from './Viewer.module.css';

export interface PageFrameProps {
  readonly index: number;
  readonly numPages: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Marco de una página: blanco, con su tamaño real y el número. El contenido lo dibuja PDF-010. */
export const PageFrame = memo(function PageFrame({ index, numPages, top, left, width, height }: PageFrameProps) {
  return (
    <div
      role="group"
      aria-label={msg.pageOf(index + 1, numPages)}
      data-page-index={index}
      className={styles.page}
      style={{ top, left, width, height }}
    >
      <span className={styles.marker} aria-hidden="true">
        {index + 1}
      </span>
    </div>
  );
});
