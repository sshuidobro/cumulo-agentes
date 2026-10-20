import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { RectPt } from '../../core/annotations/model';
import { addPolygonVertex, clipPointToPage, dragBox, dragLine, POLYGON_CLOSE_PX } from '../../core/annotations/shape-drag';
import type { PageViewport } from '../../engine/pdfjs';
import { useAnnotations } from '../../state/annotation-store';
import { createBox, createLine, createPolygon, isShapeTool, placeStamp, type ShapeTool } from '../../state/shape-actions';

/** Forma que se traza mientras se arrastra: caja en puntos PDF, o segmento `[x1, y1, x2, y2]`. */
export type ShapeSketch =
  | { readonly kind: 'square' | 'circle'; readonly rect: RectPt }
  | { readonly kind: 'line' | 'arrow'; readonly points: readonly [number, number, number, number] };

/** Polígono en curso (PDF-115): vértices `[x0, y0, ...]` y el puntero, en puntos PDF. */
export interface PolygonSketch {
  readonly vertices: readonly number[];
  readonly cursor: readonly [number, number];
}

export interface ShapeToolHandle {
  /** Forma que se arrastra ahora mismo, o `null`. */
  readonly sketch: ShapeSketch | null;
  /** Polígono que se dibuja con clics, o `null` (PDF-115). */
  readonly polygon: PolygonSketch | null;
  onPointerDown(event: PointerEvent<SVGSVGElement>): void;
  onPointerMove(event: PointerEvent<SVGSVGElement>): void;
  onDoubleClick(event: MouseEvent<SVGSVGElement>): void;
}

/** Un polígono necesita tres vértices: seis coordenadas. */
const POLYGON_MIN_COORDS = 6;

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
 *
 * Polígono (PDF-115): cada clic añade un vértice; clic cerca del primero, doble clic o Intro (con tres vértices o más)
 * lo cierran y lo crean. Escape descarta el polígono en curso; Retroceso quita el último vértice; cambiar de herramienta
 * también lo descarta. Sello (PDF-115): un clic coloca el sello pendiente.
 */
export function useShapeTool(pageIndex: number, viewport: PageViewport, pageBounds: () => RectPt): ShapeToolHandle {
  const [sketch, setSketch] = useState<ShapeSketch | null>(null);
  const [polygon, setPolygon] = useState<PolygonSketch | null>(null);
  /** Quita los escuchadores del arrastre (o del polígono) en curso, si lo hay. */
  const endDrag = useRef<(() => void) | null>(null);
  /** Polígono en curso: fuente de verdad para los manejadores; `polygon` es su copia para pintar. */
  const draft = useRef<PolygonSketch | null>(null);
  /** Escuchador de teclado registrado para el polígono en curso: se guarda para quitar exactamente ese (PDF-115). */
  const polygonKey = useRef<((e: globalThis.KeyboardEvent) => void) | null>(null);
  const tool = useAnnotations((s) => s.tool);

  useEffect(
    () => () => {
      endDrag.current?.();
    },
    [],
  );

  // Cambiar de herramienta descarta el polígono en curso (PDF-115).
  useEffect(() => {
    if (tool !== 'polygon' && draft.current !== null) endDrag.current?.();
  }, [tool]);

  function publishDraft(next: PolygonSketch | null): void {
    draft.current = next;
    setPolygon(next);
  }

  /** Descarta el polígono en curso y quita el escuchador de teclado registrado (el mismo que se añadió). */
  function stopPolygon(): void {
    if (polygonKey.current !== null) window.removeEventListener('keydown', polygonKey.current, true);
    polygonKey.current = null;
    endDrag.current = null;
    publishDraft(null);
  }

  /** Cierra el polígono con esos vértices y lo crea si tiene tres o más. */
  function finishPolygon(vertices: readonly number[]): void {
    stopPolygon();
    if (vertices.length >= POLYGON_MIN_COORDS) createPolygon(pageIndex, vertices);
  }

  /** Escape, Intro (con tres vértices o más) y Retroceso. Solo actúa con un polígono en curso. */
  function onPolygonKey(e: globalThis.KeyboardEvent): void {
    const d = draft.current;
    if (d === null) return;
    switch (e.key) {
      case 'Escape':
        stopPolygon();
        break;
      case 'Enter':
        if (d.vertices.length < POLYGON_MIN_COORDS) return;
        finishPolygon(d.vertices);
        break;
      case 'Backspace': {
        const vertices = d.vertices.slice(0, -2);
        if (vertices.length === 0) stopPolygon();
        else publishDraft({ vertices, cursor: d.cursor });
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Clic de la herramienta «Polígono»: añade un vértice. Un clic en el mismo sitio que el último vértice (el de un doble
   * clic, por ejemplo) no añade otro; el cierre por doble clic lo gestiona `onDoubleClick`.
   */
  function polygonClick(x: number, y: number, page: RectPt): void {
    const current = draft.current;
    const closePt = POLYGON_CLOSE_PX / viewport.scale;
    const result = addPolygonVertex(current?.vertices ?? [], x, y, closePt, page);
    if (result.closed) {
      finishPolygon(result.vertices);
      return;
    }
    if (current === null) {
      endDrag.current = stopPolygon;
      polygonKey.current = onPolygonKey;
      window.addEventListener('keydown', onPolygonKey, true);
    }
    publishDraft({ vertices: result.vertices, cursor: [x, y] });
  }

  /** Doble clic en la capa: cierra el polígono en curso si tiene tres vértices o más (PDF-115). */
  function onDoubleClick(event: MouseEvent<SVGSVGElement>): void {
    const current = draft.current;
    if (current === null || current.vertices.length < POLYGON_MIN_COORDS) return;
    if (event.target instanceof Element && event.target.closest('[data-annot-id]') !== null) return;
    finishPolygon(current.vertices);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>): void {
    const state = useAnnotations.getState();
    const current = state.tool;
    const drawsShape = isShapeTool(current) || current === 'polygon' || current === 'stamp';
    if (event.button !== 0 || !drawsShape) return;
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
    if (current === 'stamp') {
      placeStamp(pageIndex, [sx, sy], page);
      return;
    }
    if (current === 'polygon') {
      polygonClick(sx, sy, page);
      return;
    }
    if (!isShapeTool(current)) return;

    endDrag.current?.();
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      endDrag.current = null;
      setSketch(null);
    };
    const sketchAt = (e: globalThis.PointerEvent): ShapeSketch => {
      const [ex, ey] = toPdf(e.clientX, e.clientY);
      return sketchFor(current, sx, sy, ex, ey, e.shiftKey, page);
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

  /** Puntero sobre la capa: el tramo del polígono en curso sigue al puntero, recortado a la página (PDF-115). */
  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    const current = draft.current;
    if (current === null) return;
    const box = event.currentTarget.getBoundingClientRect();
    const [x = 0, y = 0] = viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top);
    const cursor = clipPointToPage(x, y, pageBounds());
    publishDraft({ vertices: current.vertices, cursor });
  }

  return { sketch, polygon, onPointerDown, onPointerMove, onDoubleClick };
}
