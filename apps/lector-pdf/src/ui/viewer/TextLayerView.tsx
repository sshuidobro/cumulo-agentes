import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createLogger } from '@suite/shared';
import { normalizeRotation, type Rotation } from '../../core/rotation';
import { zoomToScale } from '../../core/zoom';
import { createTextLayer, type TextLayerHandle } from '../../engine/text';
import type { PDFPageProxy, PageViewport } from '../../engine/pdfjs';
import { markupSelection, isMarkupTool } from '../../state/markup-actions';
import { useAnnotations } from '../../state/annotation-store';
import { useViewer } from '../../state/viewer-store';
import { attachSelectionBehavior } from './text-selection';
import { register, unregister } from './text-layer-registry';
import './text-layer.css';

const log = createLogger('viewer');

export interface TextLayerViewProps {
  /** Índice de la página (0-based). */
  readonly index: number;
  /** Zoom efectivo del visor. */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de la página). */
  readonly rotation: Rotation;
}

/**
 * Con una herramienta de marcado activa, soltar el ratón sobre la capa marca el texto seleccionado (PDF-032).
 * Sin selección no hace nada.
 */
function markOnRelease(): void {
  const tool = useAnnotations.getState().tool;
  if (!isMarkupTool(tool)) return;
  const sel = document.getSelection();
  if (sel === null || sel.isCollapsed) return;
  markupSelection(tool, sel);
}

/** Viewport de la página con el mismo zoom y rotación que su lienzo (ver `PageView`). */
function viewportFor(page: PDFPageProxy, zoom: number, rotation: Rotation): PageViewport {
  return page.getViewport({ scale: zoomToScale(zoom), rotation: normalizeRotation(page.rotate + rotation) });
}

/**
 * Capa de texto transparente de una página, encima del lienzo. Al montar crea la capa, activa la selección y
 * la registra; al cambiar el zoom o la rotación la recoloca; al desmontar la cancela y la desregistra.
 */
export function TextLayerView({ index, zoom, rotation }: TextLayerViewProps) {
  const doc = useViewer((s) => s.pdf?.doc ?? null);
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<TextLayerHandle | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  /** Zoom y rotación vigentes, para dibujar con ellos aunque la página tarde en cargarse. */
  const viewRef = useRef({ zoom, rotation });

  // Variables que usa la capa para escalar sus textos (ver text-layer.css).
  const scale = zoomToScale(zoom);
  const style = useMemo(
    () =>
      ({
        '--scale-factor': String(scale),
        '--total-scale-factor': String(scale),
        '--scale-round-x': '1px',
        '--scale-round-y': '1px',
      }) as CSSProperties,
    [scale],
  );

  // Cambio de zoom: se recoloca la capa existente, no se crea otra. Un cambio de rotación no entra aquí: la
  // capa se vuelve a montar (ver el efecto siguiente), porque pdf.js no recoloca el texto solo por rotación.
  useEffect(() => {
    viewRef.current = { zoom, rotation };
    const layer = layerRef.current;
    const page = pageRef.current;
    if (layer === null || page === null) return;
    layer.update(viewportFor(page, zoom, rotation));
  }, [zoom, rotation]);

  // Montaje: crea la capa cuando el documento está listo. Al cambiar la rotación o desmontar, la anterior se
  // cancela y se desregistra.
  useEffect(() => {
    const host = hostRef.current;
    if (doc === null || host === null) return undefined;
    let disposed = false;
    let detach: (() => void) | null = null;

    const mount = async (): Promise<void> => {
      try {
        const page = await doc.getPage(index + 1);
        if (disposed) return;
        pageRef.current = page;
        const layer = createTextLayer(page, host, viewportFor(page, viewRef.current.zoom, viewRef.current.rotation));
        layerRef.current = layer;
        await layer.render();
        if (disposed) return;
        const detachSelection = attachSelectionBehavior(host);
        host.addEventListener('pointerup', markOnRelease);
        detach = () => {
          host.removeEventListener('pointerup', markOnRelease);
          detachSelection();
        };
        register(index, layer);
      } catch (cause: unknown) {
        if (!disposed) log.warn('no se ha podido crear la capa de texto', { page: index + 1, error: cause });
      }
    };
    void mount();

    return () => {
      disposed = true;
      if (layerRef.current !== null) {
        layerRef.current.cancel();
        unregister(index);
      }
      detach?.();
      layerRef.current = null;
      pageRef.current = null;
      host.replaceChildren();
    };
  }, [doc, index, rotation]);

  return <div ref={hostRef} className="textLayer" style={style} />;
}
