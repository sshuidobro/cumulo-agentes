import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { RectPt } from '../../core/annotations/model';
import type { PageViewport } from '../../engine/pdfjs';
import { addMark, removeMark } from '../../state/redact-actions';
import { useAnnotations } from '../../state/annotation-store';
import { useRedact, type RedactMark } from '../../state/redact-store';
import { redactMsg } from '../messages-redact';
import styles from './RedactLayer.module.css';

/** Movimiento mínimo, en píxeles, para que un arrastre sea una zona y no un clic. */
const DRAG_MIN_PX = 3;

/** Rectángulo en píxeles relativos a la página. */
interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface RedactLayerProps {
  readonly pageIndex: number;
  readonly viewport: PageViewport;
}

/** Caja en píxeles de un rectángulo en puntos PDF, con el viewport de la página. */
function pixelBox(rect: RectPt, viewport: PageViewport): PixelBox {
  const [ax = 0, ay = 0] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [bx = 0, by = 0] = viewport.convertToViewportPoint(rect[2], rect[3]);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** Caja entre dos puntos en píxeles relativos a la página. */
function boxBetween(ax: number, ay: number, bx: number, by: number): PixelBox {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/**
 * Capa de «Redactar» sobre una página (PDF-137): muestra las marcas de la página y, con la herramienta activa,
 * convierte un arrastre en una zona. Escape cancela el arrastre en curso; Supr quita la marca enfocada.
 */
export function RedactLayer({ pageIndex, viewport }: RedactLayerProps) {
  const tool = useAnnotations((s) => s.tool);
  const marks = useRedact((s) => s.marks);
  const active = tool === 'redact';
  const [sketch, setSketch] = useState<PixelBox | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);

  // Un arrastre en curso se cancela si la página se desmonta o la herramienta deja de estar activa.
  useEffect(() => {
    if (!active) cancelDrag.current?.();
    return () => {
      cancelDrag.current?.();
    };
  }, [active]);

  const here = marks.filter((mark) => mark.pageIndex === pageIndex);
  if (!active && here.length === 0) return null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !active) return;
    event.preventDefault();
    cancelDrag.current?.();
    const box = event.currentTarget.getBoundingClientRect();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startX = startClientX - box.left;
    const startY = startClientY - box.top;
    let moved = false;

    const onMove = (e: globalThis.PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - startClientX, e.clientY - startClientY) < DRAG_MIN_PX) return;
      moved = true;
      setSketch(boxBetween(startX, startY, e.clientX - box.left, e.clientY - box.top));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', onKey, true);
      cancelDrag.current = null;
      setSketch(null);
    };
    const onUp = (e: globalThis.PointerEvent): void => {
      const wasMoved = moved;
      stop();
      if (!wasMoved) return;
      const [ax = 0, ay = 0] = viewport.convertToPdfPoint(startX, startY);
      const [bx = 0, by = 0] = viewport.convertToPdfPoint(e.clientX - box.left, e.clientY - box.top);
      addMark(pageIndex, [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
    };
    // Escape cancela el arrastre y no llega a los atajos (que dejarían la herramienta).
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop();
    };
    cancelDrag.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKey, true);
  };

  return (
    <div
      className={active ? `${styles.layer} ${styles.active}` : styles.layer}
      onPointerDown={onPointerDown}
    >
      {here.map((mark) => (
        <MarkBox key={mark.id} mark={mark} viewport={viewport} />
      ))}
      {sketch !== null && (
        <div className={styles.sketch} style={{ left: sketch.left, top: sketch.top, width: sketch.width, height: sketch.height }} />
      )}
    </div>
  );
}

interface MarkBoxProps {
  readonly mark: RedactMark;
  readonly viewport: PageViewport;
}

/** Una marca: enfocable, con nombre accesible y quitable con Supr. */
function MarkBox({ mark, viewport }: MarkBoxProps) {
  const box = pixelBox(mark.rect, viewport);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Delete') return;
    event.preventDefault();
    removeMark(mark.id);
  };
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={redactMsg.mark(mark.pageIndex + 1)}
      className={styles.mark}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onKeyDown={onKeyDown}
    />
  );
}
