import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import {
  anchorAt,
  computeLayout,
  contentYForAnchor,
  contentYToScrollTop,
  DEFAULT_GAP,
  DEFAULT_PADDING,
  maxContentY,
  pageAtY,
  scrollMap,
  scrollTopToContentY,
  visibleRange,
  type Layout,
  type ScrollMap,
} from '../../core/layout';
import { resolveZoom, zoomToScale, type Size, type ZoomMode } from '../../core/zoom';
import type { PageDimsTable } from '../../core/page-dims';
import type { Rotation } from '../../core/rotation';
import { msg } from '../messages';
import { placeSignatureFromKeyboard, select } from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { setCurrentPage, setCurrentYFraction, setHorizontalOverflow } from '../../state/navigation';
import { zoomWithWheel } from '../../state/view-actions';
import { useViewer } from '../../state/viewer-store';
import { PageView } from './PageView';
import { useViewportSize } from './use-viewport-size';
import styles from './Viewer.module.css';

/** Margen que descuentan los modos de ajuste (ancho y página), en px. */
const FIT_MARGIN: Size = { width: 2 * DEFAULT_PADDING + 16, height: 2 * DEFAULT_PADDING };
/** Desplazamiento de las flechas en modo de scroll escalado, en px de contenido. */
const ARROW_STEP = 40;
/** Margen superior al ir a una página, en px. */
const NAV_TOP_MARGIN = 8;
/** Píxeles por línea de rueda (deltaMode 1). */
const LINE_PX = 16;

/** Tamaño de la página `i` ya rotado según la rotación de vista, en puntos PDF. */
function rotatedPt(dims: PageDimsTable, i: number, viewRotation: number): Size {
  const turned = (dims.rotation(i) + viewRotation) % 360;
  const swap = turned === 90 || turned === 270;
  return swap ? { width: dims.height(i), height: dims.width(i) } : { width: dims.width(i), height: dims.height(i) };
}

/** Entradas con las que se fijó la página de referencia del zoom automático. */
interface ZoomRefState {
  readonly dims: PageDimsTable | null;
  readonly zoomMode: ZoomMode;
  readonly rotation: Rotation;
  readonly width: number;
  readonly height: number;
  readonly page: number;
}

/** En Mac el gesto de zoom es Cmd+rueda; en el resto, Ctrl+rueda. */
const IS_MAC = typeof navigator !== 'undefined' && /Macintosh|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Rueda con el modificador de zoom (Ctrl, o Cmd en Mac). */
function isZoomWheel(event: globalThis.WheelEvent): boolean {
  return event.ctrlKey || (IS_MAC && event.metaKey);
}

function clampY(y: number, maxY: number): number {
  return Math.min(Math.max(y, 0), maxY);
}

/** Un clic fuera de las anotaciones de la página deselecciona la anotación seleccionada. */
function clearAnnotationSelection(target: EventTarget | null): void {
  if (target instanceof Element && target.closest('[data-annot-id]') !== null) return;
  if (useAnnotations.getState().selectedId !== null) select(null);
}

export function Viewer() {
  const dims = useViewer((s) => s.dims);
  const dimsVersion = useViewer((s) => s.dimsVersion);
  const zoomMode = useViewer((s) => s.zoomMode);
  const zoomStored = useViewer((s) => s.zoom);
  const rotation = useViewer((s) => s.rotation);
  const navRequest = useViewer((s) => s.navRequest);
  const name = useViewer((s) => s.file?.name ?? '');
  const tool = useViewer((s) => s.tool);
  const annotationTool = useAnnotations((s) => s.tool);

  const ref = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(ref);
  const vh = viewport.height;

  // La tabla de dimensiones se muta en sitio: el par (tabla, versión) cambia de identidad con cada cambio.
  const snapshot = useMemo(
    () => (dims === null ? null : { table: dims, version: dimsVersion }),
    [dims, dimsVersion],
  );

  // Página de referencia de los modos de ajuste. Se fija al cambiar el modo, la rotación, el tamaño del visor
  // o el documento, y NO con cada cambio de página: si dependiera de la página actual, el zoom cambiaría el
  // layout, el layout cambiaría la página actual y el zoom volvería a cambiar (bucle de actualizaciones).
  const [refState, setRefState] = useState<ZoomRefState>({
    dims,
    zoomMode,
    rotation,
    width: viewport.width,
    height: vh,
    page: 0,
  });
  const refStale =
    refState.dims !== dims ||
    refState.zoomMode !== zoomMode ||
    refState.rotation !== rotation ||
    refState.width !== viewport.width ||
    refState.height !== vh;
  const zoomRefPage = refStale ? useViewer.getState().currentPage : refState.page;
  if (refStale) {
    // Ajuste de estado durante el render (patrón de React para reaccionar a cambios de props): no hay efecto ni bucle.
    setRefState({ dims, zoomMode, rotation, width: viewport.width, height: vh, page: zoomRefPage });
  }

  // Zoom efectivo: los modos de ajuste usan el tamaño de la página de referencia.
  const zoom = useMemo(() => {
    if (snapshot === null || snapshot.table.count === 0 || viewport.width <= 0 || vh <= 0) return zoomStored;
    const page = Math.min(zoomRefPage, snapshot.table.count - 1);
    return resolveZoom(zoomMode, rotatedPt(snapshot.table, page, rotation), viewport, FIT_MARGIN);
  }, [snapshot, zoomMode, zoomStored, rotation, zoomRefPage, viewport, vh]);

  useEffect(() => {
    if (zoom !== zoomStored) useViewer.setState({ zoom });
  }, [zoom, zoomStored]);

  const layout = useMemo<Layout | null>(
    () =>
      snapshot === null
        ? null
        : computeLayout(snapshot.table, { scale: zoomToScale(zoom), rotation, gap: DEFAULT_GAP, padding: DEFAULT_PADDING }),
    [snapshot, zoom, rotation],
  );

  const map = useMemo<ScrollMap>(
    () => (layout === null ? { scrollHeight: 0, factor: 1 } : scrollMap(layout, vh)),
    [layout, vh],
  );
  const maxY = layout === null ? 0 : maxContentY(layout, vh);

  // Fuente de verdad del scroll vertical (px de contenido). El estado de React solo sirve para pintar.
  const contentYRef = useRef(0);
  const [contentY, setContentY] = useState(0);
  // scrollTop que el propio visor ha puesto: su evento `scroll` de eco se ignora para no perder precisión.
  const echoRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const prevLayoutRef = useRef<Layout | null>(null);
  const handledSeqRef = useRef(0);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Como mucho un render de React por frame, aunque lleguen muchos eventos de scroll.
  const scheduleRender = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setContentY(contentYRef.current);
    });
  }, []);

  /** Pone el scrollTop del navegador según `contentYRef` y anota el eco que provocará. */
  const syncScrollTop = useCallback((): void => {
    const el = ref.current;
    if (el === null) return;
    const target = contentYToScrollTop(contentYRef.current, map);
    if (Math.abs(el.scrollTop - target) >= 0.5) {
      el.scrollTop = target;
      echoRef.current = el.scrollTop;
    }
  }, [map]);

  /** Lleva la vista a `next` (acotado). Lo usan el teclado y la rueda con scroll escalado. */
  const applyContentY = useCallback(
    (next: number): void => {
      contentYRef.current = clampY(next, maxY);
      syncScrollTop();
      scheduleRender();
    },
    [maxY, syncScrollTop, scheduleRender],
  );

  // Al cambiar el layout (zoom, rotación, dimensiones) la vista se recoloca en la misma página y posición.
  // Si lo pide una acción de zoom o giro (`zoomFocusY`), el punto indicado es el que no se mueve.
  useLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    prevLayoutRef.current = layout;
    if (layout === null || prev === null || prev === layout) return;
    const focus = useViewer.getState().zoomFocusY;
    const focusPx = focus === null ? 0 : focus === 'center' ? vh / 2 : focus;
    const anchor = anchorAt(prev, contentYRef.current + focusPx);
    contentYRef.current = clampY(contentYForAnchor(layout, anchor) - focusPx, maxY);
    const el = ref.current;
    if (el !== null && focus !== null) {
      // Horizontal: el centro del visor conserva su posición relativa al contenido.
      const oldWidth = Math.max(prev.maxWidth + 2 * DEFAULT_PADDING, el.clientWidth);
      const newWidth = Math.max(layout.maxWidth + 2 * DEFAULT_PADDING, el.clientWidth);
      const centerX = el.scrollLeft + el.clientWidth / 2;
      el.scrollLeft = (centerX * newWidth) / oldWidth - el.clientWidth / 2;
    }
    if (focus !== null) useViewer.setState({ zoomFocusY: null });
    syncScrollTop();
    setContentY(contentYRef.current);
  }, [layout, maxY, vh, syncScrollTop]);

  // Un cambio de zoom o giro sin cambio de layout (p. ej. ya en el máximo) no debe dejar un foco pendiente
  // que se aplique a un cambio posterior. Este efecto corre después del de layout, que es el que consume el foco.
  useEffect(() => {
    if (useViewer.getState().zoomFocusY !== null) useViewer.setState({ zoomFocusY: null });
  }, [zoomMode, rotation, zoom]);

  // Ir a una página pedida: se atiende una vez por `seq`.
  useEffect(() => {
    if (navRequest === null || layout === null || navRequest.seq === handledSeqRef.current) return;
    handledSeqRef.current = navRequest.seq;
    const { page, yFraction, xFraction } = navRequest;
    const top = layout.tops[page] ?? 0;
    const height = layout.heights[page] ?? 0;
    contentYRef.current = clampY(top + yFraction * height - NAV_TOP_MARGIN, maxY);
    syncScrollTop();
    const el = ref.current;
    const contentWidth = layout.maxWidth + 2 * DEFAULT_PADDING;
    if (el !== null && xFraction !== null && contentWidth > el.clientWidth) {
      el.scrollLeft = Math.max(0, contentWidth * xFraction - el.clientWidth / 2);
    }
    setContentY(contentYRef.current);
  }, [navRequest, layout, maxY, syncScrollTop]);

  // Página actual: la que queda en el tercio superior del visor.
  useEffect(() => {
    if (layout === null || layout.count === 0) return;
    const page = pageAtY(layout, contentY + vh / 3);
    setCurrentPage(page);
    // Posición dentro de la página: el borde superior del visor, con el mismo margen que usa «ir a página».
    const height = layout.heights[page] ?? 0;
    const top = layout.tops[page] ?? 0;
    const yFraction = height > 0 ? Math.min(Math.max((contentY + NAV_TOP_MARGIN - top) / height, 0), 1) : 0;
    setCurrentYFraction(yFraction);
  }, [layout, contentY, vh]);

  // Ancho del contenido frente al del visor (el espaciador nunca es más estrecho que el visor).
  const contentWidth = layout === null ? 0 : layout.maxWidth + 2 * DEFAULT_PADDING;
  const hasOverflow = contentWidth > viewport.width;
  useEffect(() => {
    setHorizontalOverflow(hasOverflow);
  }, [hasOverflow]);

  // Con scroll escalado el navegador no puede recorrer todo el contenido: rueda y teclado se gestionan aquí.
  const scaled = map.factor > 1;
  useEffect(() => {
    const el = ref.current;
    if (el === null || !scaled) return undefined;
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (isZoomWheel(event)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? vh : 1;
      applyContentY(contentYRef.current + event.deltaY * unit);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scaled, vh, applyContentY]);

  // Ctrl+rueda acerca o aleja centrado en el cursor, y no hace el zoom del navegador.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const onZoomWheel = (event: globalThis.WheelEvent): void => {
      if (!isZoomWheel(event)) return;
      event.preventDefault();
      const mode = event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? 2 : 0;
      zoomWithWheel(event.deltaY, mode, event.clientY - el.getBoundingClientRect().top);
    };
    el.addEventListener('wheel', onZoomWheel, { passive: false });
    return () => el.removeEventListener('wheel', onZoomWheel);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!scaled || event.ctrlKey || event.altKey || event.metaKey) return;
    // Con la herramienta «Firmar», Intro coloca la firma en la página actual, a un tercio de lo visible (PDF-043).
    if (event.key === 'Enter' && useAnnotations.getState().tool === 'signature') {
      event.preventDefault();
      const pagePx = layout?.heights[useViewer.getState().currentPage] ?? 0;
      placeSignatureFromKeyboard(pagePx > 0 ? Math.min(1, vh / pagePx) : 1);
      return;
    }
    const pageStep = vh - ARROW_STEP;
    const current = contentYRef.current;
    let next: number;
    switch (event.key) {
      case 'ArrowUp':
        next = current - ARROW_STEP;
        break;
      case 'ArrowDown':
        next = current + ARROW_STEP;
        break;
      case 'PageUp':
        next = current - pageStep;
        break;
      case 'PageDown':
        next = current + pageStep;
        break;
      case ' ':
        next = current + (event.shiftKey ? -pageStep : pageStep);
        break;
      default:
        return;
    }
    event.preventDefault();
    applyContentY(next);
  };

  // Herramienta mano: el arrastre desplaza el visor por el mismo camino que el teclado (`contentYRef`), así
  // funciona igual con scroll nativo y con scroll escalado.
  const panRef = useRef<{ readonly pointerId: number; lastY: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    clearAnnotationSelection(event.target);
    if (tool !== 'hand' || event.button !== 0) return;
    panRef.current = { pointerId: event.pointerId, lastY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    if (pan === null || pan.pointerId !== event.pointerId) return;
    const dy = event.clientY - pan.lastY;
    pan.lastY = event.clientY;
    applyContentY(contentYRef.current - dy);
  };

  const endPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
  };

  // Tras abrir un documento, el visor recibe el foco para que el teclado funcione de inmediato.
  useEffect(() => {
    if (dims !== null) ref.current?.focus();
  }, [dims]);

  const onScroll = (): void => {
    const el = ref.current;
    if (el === null) return;
    const echo = echoRef.current;
    echoRef.current = null;
    if (echo !== null && el.scrollTop === echo) return;
    contentYRef.current = clampY(scrollTopToContentY(el.scrollTop, map), maxY);
    scheduleRender();
  };

  // El contenedor siempre está montado para que el visor mida su tamaño desde el principio.
  const frames: ReactElement[] = [];
  let spacerWidth = 0;
  if (layout !== null) {
    spacerWidth = Math.max(layout.maxWidth + 2 * DEFAULT_PADDING, viewport.width);
    const range = visibleRange(layout, contentY, contentY + vh, 1);
    const inView = visibleRange(layout, contentY, contentY + vh, 0);
    const scrollTop = contentYToScrollTop(contentY, map);
    for (let i = range.first; i <= range.last; i++) {
      frames.push(
        <PageView
          key={i}
          index={i}
          numPages={layout.count}
          top={(layout.tops[i] ?? 0) - contentY + scrollTop}
          left={(spacerWidth - (layout.widths[i] ?? 0)) / 2}
          width={layout.widths[i] ?? 0}
          height={layout.heights[i] ?? 0}
          zoom={zoom}
          rotation={rotation}
          visible={i >= inView.first && i <= inView.last}
        />,
      );
    }
  }

  return (
    <div
      ref={ref}
      className={panning ? `${styles.viewer} ${styles.panning}` : styles.viewer}
      role="region"
      aria-label={msg.documentRegion(name)}
      data-testid="viewer"
      data-tool={annotationTool === 'none' ? tool : annotationTool}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
    >
      {layout !== null && (
        <div className={styles.spacer} style={{ height: map.scrollHeight, width: spacerWidth }}>
          {frames}
        </div>
      )}
    </div>
  );
}
