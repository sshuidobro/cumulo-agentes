import { memo, useEffect, useRef, useState } from 'react';
import { createLogger } from '@suite/shared';
import { planCanvas } from '../../core/canvas-size';
import { NIGHT_PAGE_COLORS } from '../../core/night';
import { normalizeRotation, type Rotation } from '../../core/rotation';
import { renderPageToCanvas } from '../../engine/render';
import type { PDFPageProxy } from '../../engine/pdfjs';
import { goToPage, setCurrentPage } from '../../state/navigation';
import { renderQueue, releaseCanvas } from '../../state/render-service';
import { useAppearance } from '../../state/appearance-store';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import styles from './Sidebar.module.css';

const log = createLogger('thumbnails');

/** Prioridad de las miniaturas en la cola de render: van después de las páginas del visor (0 y 1). */
export const PRIORITY_THUMBNAIL = 2;

/** Id DOM de la miniatura `index`, para `aria-activedescendant` de la lista. */
export function thumbnailDomId(index: number): string {
  return `thumb-${String(index)}`;
}

/** Lleva el visor a la página y la marca como actual en el panel. Lo usan el clic y el teclado. */
export function selectThumbnail(index: number): void {
  setCurrentPage(index);
  goToPage(index);
}

export interface ThumbnailItemProps {
  readonly index: number;
  readonly numPages: number;
  /** Posición y tamaño CSS del marco dentro de la columna de miniaturas, en píxeles. */
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  /** Escala con la que se dibuja la página (puntos PDF → píxeles CSS). */
  readonly scale: number;
  /** Rotación de vista (se suma a la de la página). */
  readonly rotation: Rotation;
  /** Etiqueta de la página (la de `/PageLabels` si existe, si no el número). */
  readonly label: string;
  readonly selected: boolean;
}

/**
 * Miniatura de una página: marco con su lienzo y la etiqueta debajo. Se dibuja por la cola de render con
 * prioridad menor que las páginas del visor; al desmontarse cancela su dibujo y libera el lienzo.
 */
export const ThumbnailItem = memo(function ThumbnailItem({
  index,
  numPages,
  top,
  left,
  width,
  height,
  scale,
  rotation,
  label,
  selected,
}: ThumbnailItemProps) {
  const doc = useViewer((s) => s.pdf?.doc ?? null);
  const nightMode = useAppearance((s) => s.nightMode);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  const key = `thumb:${String(index)}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  /** Lienzo que se está dibujando ahora mismo (aún no está en el DOM). */
  const pendingRef = useRef<HTMLCanvasElement | null>(null);

  // Dibuja al montar y cada vez que cambian el documento, la escala, la rotación o el tamaño del marco.
  useEffect(() => {
    if (doc === null) return;
    const host = hostRef.current;

    const run = async (signal: AbortSignal): Promise<void> => {
      try {
        const page = await doc.getPage(index + 1);
        pageRef.current = page;
        if (signal.aborted) return;

        const plan = planCanvas(width, height, window.devicePixelRatio);
        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        pendingRef.current = canvas;
        const outcome = await renderPageToCanvas(page, canvas, {
          scale,
          rotation: normalizeRotation(page.rotate + rotation),
          outputScale: plan.outputScale,
          signal,
          ...(nightMode ? { pageColors: NIGHT_PAGE_COLORS } : {}),
        });
        if (pendingRef.current === canvas) pendingRef.current = null;

        if (outcome === 'cancelled' || signal.aborted || host === null) {
          releaseCanvas(canvas);
          return;
        }
        const previous = Array.from(host.querySelectorAll('canvas'));
        host.replaceChildren(canvas);
        for (const old of previous) releaseCanvas(old);
        setFailed(false);
        setRendered(true);
      } catch (cause: unknown) {
        if (signal.aborted) return;
        log.warn('no se ha podido dibujar la miniatura', { page: index + 1, error: cause });
        setFailed(true);
      }
    };

    renderQueue.request({ key, priority: PRIORITY_THUMBNAIL, run });
  }, [doc, key, index, scale, rotation, width, height, nightMode]);

  // Al desmontar: se cancela el dibujo, se liberan los lienzos y la página de pdf.js.
  useEffect(() => {
    const host = hostRef.current;
    return () => {
      renderQueue.cancel(key);
      if (pendingRef.current !== null) releaseCanvas(pendingRef.current);
      pendingRef.current = null;
      if (host !== null) for (const canvas of host.querySelectorAll('canvas')) releaseCanvas(canvas);
      pageRef.current?.cleanup();
      pageRef.current = null;
    };
  }, [key]);

  return (
    <div
      role="option"
      id={thumbnailDomId(index)}
      aria-selected={selected}
      aria-label={msg.pageOf(index + 1, numPages)}
      data-thumb-index={index}
      data-rendered={rendered ? 'true' : undefined}
      className={styles.item}
      style={{ top, left, width, height }}
      onClick={() => {
        selectThumbnail(index);
      }}
    >
      <div className={nightMode ? `${styles.frame} ${styles.frameNight}` : styles.frame} style={{ width, height }}>
        <div ref={hostRef} className={styles.canvasHost} />
        {failed && <span className={styles.failed}>{msg.pageRenderFailed}</span>}
      </div>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
    </div>
  );
});
