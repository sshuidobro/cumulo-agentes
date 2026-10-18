import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@suite/shared';
import { planCanvas } from '../../core/canvas-size';
import { normalizeRotation, type Rotation } from '../../core/rotation';
import { zoomToScale } from '../../core/zoom';
import { readPageDims } from '../../engine/page-dims';
import { NIGHT_PAGE_COLORS } from '../../core/night';
import { renderPageToCanvas } from '../../engine/render';
import type { PDFPageProxy } from '../../engine/pdfjs';
import { ensurePageAnnotations } from '../../state/annotation-actions';
import { useAppearance } from '../../state/appearance-store';
import { useAnnotations } from '../../state/annotation-store';
import { reportPageDims } from '../../state/document-actions';
import { renderQueue, releaseCanvas } from '../../state/render-service';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import { AnnotationLayer } from './AnnotationLayer';
import { AnnotationPopup } from './AnnotationPopup';
import { FormLayer } from './FormLayer';
import { LinkLayer } from './LinkLayer';
import { PageFrame } from './PageFrame';
import { SearchHighlights } from './SearchHighlights';
import { TextLayerView } from './TextLayerView';
import styles from './Viewer.module.css';

const log = createLogger('viewer');

/** Prioridad de la cola: las páginas visibles antes que el *overscan*. */
const PRIORITY_VISIBLE = 0;
const PRIORITY_OVERSCAN = 1;

export interface PageViewProps {
  readonly index: number;
  readonly numPages: number;
  /** Posición y tamaño CSS del marco, en píxeles. */
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  /** Zoom efectivo del visor. */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de la página). */
  readonly rotation: Rotation;
  /** `true` si la página está dentro del área visible (sin *overscan*). */
  readonly visible: boolean;
}

/**
 * Página con su lienzo. Dibuja la página con pdf.js a través de la cola de render, cancela lo que
 * sale del visor y libera los lienzos al desmontarse. Mientras se dibuja una versión nueva, la anterior
 * sigue en pantalla estirada; al terminar, la sustituye y libera su memoria.
 */
export const PageView = memo(function PageView({
  index,
  numPages,
  top,
  left,
  width,
  height,
  zoom,
  rotation,
  visible,
}: PageViewProps) {
  const doc = useViewer((s) => s.pdf?.doc ?? null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Página de pdf.js ya cargada; de ella sale el viewport de la capa de anotaciones. */
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  /** Versión de las anotaciones de esta página: al cambiar, el lienzo se vuelve a dibujar. */
  const version = useAnnotations((s) => s.pageVersion.get(index) ?? 0);
  const scan = useAnnotations((s) => s.scan);
  /** Modo noche: al cambiar, la página se vuelve a dibujar con los colores de noche. */
  const nightMode = useAppearance((s) => s.nightMode);

  const key = `page:${index}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const pageRef = useRef<PDFPageProxy | null>(null);
  /** Lienzo que se está dibujando ahora mismo (aún no está en el DOM). */
  const pendingRef = useRef<HTMLCanvasElement | null>(null);

  // La prioridad se ajusta sin reiniciar el dibujo: solo afecta a los trabajos pendientes.
  useEffect(() => {
    visibleRef.current = visible;
    renderQueue.setPriority(key, visible ? PRIORITY_VISIBLE : PRIORITY_OVERSCAN);
  }, [key, visible]);

  // Documentos grandes: la página se importa sus anotaciones al hacerse visible (una sola vez).
  useEffect(() => {
    if (visible && scan === 'lazy') void ensurePageAnnotations(index);
  }, [visible, index, scan]);

  // Dibuja al montar y cada vez que cambian el documento, el zoom, la rotación, el tamaño del marco o las anotaciones.
  useEffect(() => {
    if (doc === null) return;
    const host = hostRef.current;

    const run = async (signal: AbortSignal): Promise<void> => {
      try {
        const loaded = await doc.getPage(index + 1);
        pageRef.current = loaded;
        if (signal.aborted) return;
        setPage(loaded);
        reportPageDims(await readPageDims(loaded));
        if (signal.aborted) return;

        const plan = planCanvas(width, height, window.devicePixelRatio);
        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        pendingRef.current = canvas;
        const outcome = await renderPageToCanvas(loaded, canvas, {
          scale: zoomToScale(zoom),
          rotation: normalizeRotation(loaded.rotate + rotation),
          outputScale: plan.outputScale,
          signal,
          ...(nightMode ? { night: NIGHT_PAGE_COLORS } : {}),
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
        log.warn('no se ha podido dibujar la página', { page: index + 1, error: cause });
        setFailed(true);
      }
    };

    renderQueue.request({
      key,
      priority: visibleRef.current ? PRIORITY_VISIBLE : PRIORITY_OVERSCAN,
      run,
    });
  }, [doc, key, index, zoom, rotation, width, height, version, nightMode]);

  // Viewport con el mismo zoom y rotación que el lienzo; la capa de anotaciones lo usa para dibujar.
  const viewport = useMemo(
    () =>
      page === null
        ? null
        : page.getViewport({ scale: zoomToScale(zoom), rotation: normalizeRotation(page.rotate + rotation) }),
    [page, zoom, rotation],
  );

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
    <PageFrame
      index={index}
      numPages={numPages}
      top={top}
      left={left}
      width={width}
      height={height}
      rendered={rendered}
      night={nightMode}
    >
      <div ref={hostRef} className={styles.canvasHost} />
      <SearchHighlights index={index} zoom={zoom} rotation={rotation} />
      <TextLayerView index={index} zoom={zoom} rotation={rotation} />
      {viewport !== null && <AnnotationLayer pageIndex={index} viewport={viewport} />}
      {viewport !== null && <FormLayer pageIndex={index} viewport={viewport} />}
      {viewport !== null && <AnnotationPopup pageIndex={index} viewport={viewport} visible={visible} />}
      <LinkLayer index={index} zoom={zoom} rotation={rotation} />
      {failed && (
        <span className={styles.renderError} role="status">
          {msg.pageRenderFailed}
        </span>
      )}
    </PageFrame>
  );
});
