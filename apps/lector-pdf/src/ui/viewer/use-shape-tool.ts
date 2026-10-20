import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { RectPt } from '../../core/annotations/model';
import { dragBox, dragLine } from '../../core/annotations/shape-drag';
import type { PageViewport } from '../../engine/pdfjs';
import { useAnnotations } from '../../state/annotation-store';
import { createBox, createLine, isShapeTool, type ShapeTool } from '../../state/shape-actions';

/** Forma que se traza mientras se arrastra: caja en puntos PDF, o segmento `[x1, y1, x2, y2]`. */
export type ShapeSketch =
  | { readonly kind: 'square' | 'circle'; readonly rect: RectPt }
  | { readonly kind: 'line' | 'arrow'; readonly points: readonly [number, number, number, number] };

export interface ShapeToolHandle {
  readonly sketch: ShapeSketch | null;
  onPointerDown(event: PointerEvent<SVGSVGElement>): void;
}

/** Forma del arrastre según la herramienta. Mayús (`shift`): cuadrado o círculo, o ángulo de 45°. */
function sketchFor(tool: ShapeTool, sx: number, sy: number, ex: number, ey: number, shift: boolean, page: RectPt): ShapeSketch {
  if (tool === 'square' || tool === 'circle') {
    return { kind: tool, rect: dragBox(sx, sy, ex, ey, shift, page) };
  }
  return { kind: tool, points: dragLine(sx, sy, ex, ey, shift, page) };
}

/**
 * Herramientas de forma (PDF-108): arrastrar en la capa crea un rectángulo, una elipse, una línea o una flecha. Solo
 * botón principal, con una herramienta de forma, sin editor abierto y fuera de las anotaciones y sus tiradores. Al
 * soltar se crea la forma; Escape o `pointercancel` cancelan sin crear nada.
 */
export function useShapeTool(pageIndex: number, viewport: PageViewport, pageBounds: () => RectPt): ShapeToolHandle {
  const [sketch, setSketch] = useState<ShapeSketch | null>(null);
  /** Quita los escuchadores del arrastre en curso (si lo hay). */
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      endDrag.current?.();
    },
    [],
  );

  function onPointerDown(event: PointerEvent<SVGSVGElement>): void {
    const state = useAnnotations.getState();
    const tool = state.tool;
    if (event.button !== 0 || !isShapeTool(tool)) return;
    // Con un editor abierto, el clic solo confirma su texto; no empieza una forma.
    if (state.editing !== null) return;
    // Un clic sobre una anotación o sobre su tirador es de esa anotación, no de una nueva.
    if (event.target instanceof Element && event.target.closest('[data-annot-id], [data-resize-id]') !== null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const toPdf = (clientX: number, clientY: number): readonly [number, number] => {
      const [x = 0, y = 0] = viewport.convertToPdfPoint(clientX - box.left, clientY - box.top);
      return [x, y];
    };
    const [sx, sy] = toPdf(event.clientX, event.clientY);
    const page = pageBounds();
    const sketchAt = (e: globalThis.PointerEvent): ShapeSketch => {
      const [ex, ey] = toPdf(e.clientX, e.clientY);
      return sketchFor(tool, sx, sy, ex, ey, e.shiftKey, page);
    };

    endDrag.current?.();
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      endDrag.current = null;
      setSketch(null);
    };
    const onMove = (e: globalThis.PointerEvent): void => {
      setSketch(sketchAt(e));
    };
    const onUp = (e: globalThis.PointerEvent): void => {
      const finalSketch = e.type === 'pointercancel' ? null : sketchAt(e);
      stop();
      if (finalSketch === null) return;
      if ('points' in finalSketch) {
        createLine(pageIndex, finalSketch.points, finalSketch.kind === 'arrow');
      } else {
        createBox(pageIndex, finalSketch.kind, finalSketch.rect);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      stop();
    };
    endDrag.current = stop;
    setSketch(sketchAt(event.nativeEvent));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
  }

  return { sketch, onPointerDown };
}
