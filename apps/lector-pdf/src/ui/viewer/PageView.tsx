import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@suite/shared';
import { planCanvas } from '../../core/canvas-size';
import { needsRedraw, planDetail, visibleInFrame, type PxRect } from '../../core/detail';
import { normalizeRotation, type Rotation } from '../../core/rotation';
import { zoomToScale } from '../../core/zoom';
import { readPageDims } from '../../engine/page-dims';
import { NIGHT_PAGE_COLORS } from '../../core/night';
import { renderPageToCanvas } from '../../engine/render';
import type { PDFPageProxy } from '../../engine/pdfjs';
import { ensurePageAnnotations } from '../../state/annotation-actions';
import { useAppearance } from '../../state/appearance-store';
import { useAnnotations } from '../../state/annotation-store';
import { useForms } from '../../state/form-store';
import { reportPageDims } from '../../state/document-actions';
import { renderQueue, releaseCanvas } from '../../state/render-service';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import { AnnotationLayer } from './AnnotationLayer';
import { LinkLayer } from './LinkLayer';
import { PageFrame } from './PageFrame';
import { SearchHighlights } from './SearchHighlights';
import { TextLayerView } from './TextLayerView';
import styles from './Viewer.module.css';

// Capas que solo hacen falta con campos de formulario o con un comentario abierto (PDF-140): se cargan bajo demanda.
const FormLayer = lazy(() => import('./FormLayer').then((m) => ({ default: m.FormLayer })));
const AnnotationPopup = lazy(() => import('./AnnotationPopup').then((m) => ({ default: m.AnnotationPopup })));

const log = createLogger('viewer');

/** Prioridad de la cola: las páginas visibles antes que el *overscan*. */
const PRIORITY_VISIBLE = 0;
const PRIORITY_OVERSCAN = 1;
/** Retardo del lienzo de detalle tras el último cambio de la zona visible (ADR-0025). */
const DETAIL_DELAY_MS = 150;

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
  /**
   * Zona visible del visor, en las mismas coordenadas que el marco (`top`, `left`). `null` si la página solo está
   * en el *overscan*. Con zoom alto, la página dibuja además un lienzo de detalle de esta zona (ADR-0025).
   */
  readonly viewportRect?: PxRect | null;
}

/** Clave de lo que cambia el aspecto del lienzo de detalle: si cambia, el detalle dibujado ya no sirve. */
function drawStyleKey(zoom: number, rotation: Rotation, night: boolean, width: number, height: number): string {
  return `${zoom}|${rotation}|${night}|${width}|${height}`;
}

/** Lienzo de detalle dibujado: su zona en px del marco, la página y el estilo con el que se dibujó. */
interface DetailDrawn {
  readonly rect: PxRect;
  readonly page: PDFPageProxy;
  readonly style: string;
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
  viewportRect = null,
}: PageViewProps) {
  const doc = useViewer((s) => s.pdf?.doc ?? null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Página de pdf.js ya cargada; de ella sale el viewport de la capa de anotaciones. */
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  /** Versión de las anotaciones de esta página: al cambiar, el lienzo se vuelve a dibujar. */
  const version = useAnnotations((s) => s.pageVersion.get(index) ?? 0);
  const scan = useAnnotations((s) => s.scan);
  // Con campos de formulario en el documento, o con un comentario abierto, se montan las capas diferidas.
  const hasForms = useForms((s) => s.fields.size > 0);
  const popupOpen = useAnnotations((s) => s.openPopupId !== null);
  /** Modo noche: al cambiar, la página se vuelve a dibujar con los colores de noche. */
  const nightMode = useAppearance((s) => s.nightMode);

  const key = `page:${index}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const pageRef = useRef<PDFPageProxy | null>(null);
  /** Lienzo que se está dibujando ahora mismo (aún no está en el DOM). */
  const pendingRef = useRef<HTMLCanvasElement | null>(null);

  // Lienzo de detalle (ADR-0025): contenedor propio, hermano del de la página entera.
  const detailKey = `${key}:detail`;
  const detailHostRef = useRef<HTMLDivElement>(null);
  const detailPendingRef = useRef<HTMLCanvasElement | null>(null);
  const detailDrawnRef = useRef<DetailDrawn | null>(null);
  // Lienzo base: el mismo cálculo que el de su dibujo, así el detalle parte de la misma densidad.
  const basePlan = useMemo(() => planCanvas(width, height, window.devicePixelRatio), [width, height]);
  // Primitivos de la zona visible: el efecto no se reinicia si el objeto cambia sin que cambien sus valores.
  const hasViewport = viewportRect !== null;
  const viewX = viewportRect?.x ?? 0;
  const viewY = viewportRect?.y ?? 0;
  const viewWidth = viewportRect?.width ?? 0;
  const viewHeight = viewportRect?.height ?? 0;

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

        const canvas = document.createElement('canvas');
        canvas.width = basePlan.width;
        canvas.height = basePlan.height;
        pendingRef.current = canvas;
        const outcome = await renderPageToCanvas(loaded, canvas, {
          scale: zoomToScale(zoom),
          rotation: normalizeRotation(loaded.rotate + rotation),
          outputScale: basePlan.outputScale,
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
  }, [doc, key, index, zoom, rotation, width, height, version, nightMode, basePlan]);

  // Lienzo de detalle: tras el último cambio de la zona visible (o de zoom, rotación o noche), dibuja la zona
  // visible con margen a resolución completa. Mientras tanto, el detalle anterior y el lienzo base siguen en pantalla.
  useEffect(() => {
    const frame: PxRect = { x: left, y: top, width, height };
    const viewport: PxRect | null = hasViewport
      ? { x: viewX, y: viewY, width: viewWidth, height: viewHeight }
      : null;
    const style = drawStyleKey(zoom, rotation, nightMode, width, height);
    const plan = page === null || viewport === null ? null : planDetail(basePlan, frame, viewport, window.devicePixelRatio);
    const visibleRect = viewport === null ? null : visibleInFrame(frame, viewport);
    const drawn = detailDrawnRef.current;

    // Sin detalle que dibujar (zoom bajo, página fuera del visor): se quita lo que hubiera.
    if (page === null || plan === null || visibleRect === null) {
      releaseDetail(detailHostRef.current, detailPendingRef, detailDrawnRef);
      return undefined;
    }
    // Un detalle de otro zoom, rotación, documento o estilo no vale: se quita ya, no al terminar el nuevo.
    if (drawn !== null && (drawn.page !== page || drawn.style !== style)) {
      releaseDetail(detailHostRef.current, detailPendingRef, detailDrawnRef);
    }
    const current = detailDrawnRef.current;
    if (current !== null && !needsRedraw(current.rect, visibleRect)) return undefined;

    const { rect, canvas: canvasPlan } = plan;
    const run = async (signal: AbortSignal): Promise<void> => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvasPlan.width;
        canvas.height = canvasPlan.height;
        detailPendingRef.current = canvas;
        const outcome = await renderPageToCanvas(page, canvas, {
          scale: zoomToScale(zoom),
          rotation: normalizeRotation(page.rotate + rotation),
          outputScale: canvasPlan.outputScale,
          offset: { x: rect.x, y: rect.y },
          signal,
          ...(nightMode ? { night: NIGHT_PAGE_COLORS } : {}),
        });
        if (detailPendingRef.current === canvas) detailPendingRef.current = null;

        const host = detailHostRef.current;
        if (outcome === 'cancelled' || signal.aborted || host === null) {
          releaseCanvas(canvas);
          return;
        }
        const previous = Array.from(host.querySelectorAll('canvas'));
        host.replaceChildren(canvas);
        for (const old of previous) releaseCanvas(old);
        // Posición y marca en el mismo paso que el lienzo, para que nunca se vea uno sin el otro.
        host.style.left = `${rect.x}px`;
        host.style.top = `${rect.y}px`;
        host.style.width = `${rect.width}px`;
        host.style.height = `${rect.height}px`;
        host.setAttribute('data-detail', '');
        detailDrawnRef.current = { rect, page, style };
      } catch (cause: unknown) {
        if (signal.aborted) return;
        log.warn('no se ha podido dibujar el detalle de la página', { page: index + 1, error: cause });
      }
    };

    // Un único temporizador por cambio: cada nuevo cambio de zona reinicia la cuenta de 150 ms.
    const timer = window.setTimeout(() => {
      renderQueue.request({ key: detailKey, priority: PRIORITY_VISIBLE, run });
    }, DETAIL_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      renderQueue.cancel(detailKey);
    };
  }, [
    detailKey,
    index,
    top,
    left,
    width,
    height,
    zoom,
    rotation,
    nightMode,
    page,
    basePlan,
    hasViewport,
    viewX,
    viewY,
    viewWidth,
    viewHeight,
  ]);

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
    const detailHost = detailHostRef.current;
    return () => {
      renderQueue.cancel(key);
      renderQueue.cancel(detailKey);
      if (pendingRef.current !== null) releaseCanvas(pendingRef.current);
      pendingRef.current = null;
      if (host !== null) for (const canvas of host.querySelectorAll('canvas')) releaseCanvas(canvas);
      releaseDetail(detailHost, detailPendingRef, detailDrawnRef);
      pageRef.current?.cleanup();
      pageRef.current = null;
    };
  }, [key, detailKey]);

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
      <div ref={detailHostRef} className={styles.detailHost} />
      <SearchHighlights index={index} zoom={zoom} rotation={rotation} />
      <TextLayerView index={index} zoom={zoom} rotation={rotation} />
      {viewport !== null && <AnnotationLayer pageIndex={index} viewport={viewport} />}
      {viewport !== null && hasForms && (
        <Suspense fallback={null}>
          <FormLayer pageIndex={index} viewport={viewport} />
        </Suspense>
      )}
      {viewport !== null && popupOpen && (
        <Suspense fallback={null}>
          <AnnotationPopup pageIndex={index} viewport={viewport} visible={visible} />
        </Suspense>
      )}
      <LinkLayer index={index} zoom={zoom} rotation={rotation} />
      {failed && (
        <span className={styles.renderError} role="status">
          {msg.pageRenderFailed}
        </span>
      )}
    </PageFrame>
  );
});

/** Quita el lienzo de detalle: cancela el que se dibuja, libera los lienzos y oculta el contenedor. */
function releaseDetail(
  host: HTMLDivElement | null,
  pendingRef: { current: HTMLCanvasElement | null },
  drawnRef: { current: DetailDrawn | null },
): void {
  if (pendingRef.current !== null) releaseCanvas(pendingRef.current);
  pendingRef.current = null;
  drawnRef.current = null;
  if (host === null) return;
  for (const canvas of host.querySelectorAll('canvas')) releaseCanvas(canvas);
  host.replaceChildren();
  host.removeAttribute('data-detail');
}
