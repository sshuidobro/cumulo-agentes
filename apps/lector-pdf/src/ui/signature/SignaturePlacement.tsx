import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { RectPt } from '../../core/annotations/model';
import type { PageViewport } from '../../engine/pdfjs';
import { isLargeEnoughBox } from '../../core/signature/digital/placement';
import { cancelPlacing, signAtCurrentPageCenter, signDocument, useSignDialog } from '../../state/digital-signature-actions';
import { showNotice } from '../../state/notice';
import { digitalSignMsg } from '../messages-digital-signature';
import styles from './SignaturePlacement.module.css';

/** Movimiento mínimo, en píxeles, para que un arrastre sea un recuadro y no un clic. */
const DRAG_MIN_PX = 3;

interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function boxBetween(ax: number, ay: number, bx: number, by: number): PixelBox {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export interface SignaturePlaceLayerProps {
  readonly pageIndex: number;
  readonly viewport: PageViewport;
}

/**
 * Capa de colocación sobre una página (PDF-139). Solo existe mientras se coloca la firma: arrastrar dibuja el
 * recuadro y, al soltar, firma en esa página. Un recuadro menor que el mínimo se descarta con un aviso.
 */
export function SignaturePlaceLayer({ pageIndex, viewport }: SignaturePlaceLayerProps) {
  const placing = useSignDialog((s) => s.placing);
  const [sketch, setSketch] = useState<PixelBox | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);

  // Un arrastre en curso se cancela si la capa se desmonta (Escape, otra firma, cambio de documento).
  useEffect(() => () => { cancelDrag.current?.(); }, []);

  if (!placing) return null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    cancelDrag.current?.();
    const box = event.currentTarget.getBoundingClientRect();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startX = startClientX - box.left;
    const startY = startClientY - box.top;
    let moved = false;

    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      cancelDrag.current = null;
      setSketch(null);
    };
    const onMove = (e: globalThis.PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - startClientX, e.clientY - startClientY) < DRAG_MIN_PX) return;
      moved = true;
      setSketch(boxBetween(startX, startY, e.clientX - box.left, e.clientY - box.top));
    };
    const onUp = (e: globalThis.PointerEvent): void => {
      const wasMoved = moved;
      stop();
      if (!wasMoved) return;
      const [ax = 0, ay = 0] = viewport.convertToPdfPoint(startX, startY);
      const [bx = 0, by = 0] = viewport.convertToPdfPoint(e.clientX - box.left, e.clientY - box.top);
      const rect: RectPt = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
      if (!isLargeEnoughBox(rect)) {
        showNotice(digitalSignMsg.placingTooSmall);
        return;
      }
      void signDocument(pageIndex, rect);
    };
    cancelDrag.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <div className={styles.layer} aria-hidden="true" onPointerDown={onPointerDown}>
      {sketch !== null && (
        <div className={styles.sketch} style={{ left: sketch.left, top: sketch.top, width: sketch.width, height: sketch.height }} />
      )}
    </div>
  );
}

/**
 * Teclado y aviso de la colocación (PDF-139), una sola instancia en la aplicación. Escape cancela; Intro coloca la
 * firma en el centro de la página actual. Mientras se coloca, muestra el texto de ayuda.
 */
export function SignaturePlacementKeys() {
  const placing = useSignDialog((s) => s.placing);
  useEffect(() => {
    if (!placing) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPlacing();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        void signAtCurrentPageCenter();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); };
  }, [placing]);
  if (!placing) return null;
  return <p className={styles.hint} role="status">{digitalSignMsg.placingHint}</p>;
}
