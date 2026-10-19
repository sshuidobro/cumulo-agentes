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
  rowRange,
  scrollMap,
  scrollTopToContentY,
  visibleRange,
  type Layout,
  type ScrollMap,
} from '../../core/layout';
import { pagedWindow, referenceSize, rowFirstPage, stepRow } from '../../core/view-mode';
import { resolveZoom, zoomToScale, type Size, type ZoomMode } from '../../core/zoom';
import type { PageDimsTable } from '../../core/page-dims';
import type { Rotation } from '../../core/rotation';
import { msg } from '../messages';
import { placeSignatureFromKeyboard, select } from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { goToPage, setCurrentPage, setCurrentYFraction, setHorizontalOverflow } from '../../state/navigation';
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
/** Rueda que hay que acumular al final de una página (modo por páginas) para pasar a la fila siguiente, en px. */
const WHEEL_ROW_PX = 100;
/** Tiempo sin rueda (ms) tras el que el acumulador de la rueda se vacía. */
const WHEEL_IDLE_MS = 300;

/** Acumulador de la rueda en el modo por páginas: px recogidos en el borde y último instante de rueda. */
interface WheelAccumulator {
  total: number;
  last: number;
}

/** Ventana de contenido del modo por páginas para la página `page` (su fila), o null si no hay páginas. */
function windowOf(layout: Layout, page: number): { readonly top: number; readonly height: number } | null {
  if (layout.count === 0) return null;
  return pagedWindow(layout, layout.rowOf[Math.min(page, layout.count - 1)] ?? 0);
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

/** Acota una posición de contenido al intervalo [lo, hi] (en el modo por páginas, la ventana de la fila). */
function clampY(y: number, lo: number, hi: number): number {
  return Math.min(Math.max(y, lo), hi);
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
  const viewMode = useViewer((s) => s.viewMode);
  const currentPage = useViewer((s) => s.currentPage);
  const spread = viewMode.spread;
  const paged = viewMode.scroll === 'paged';

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
    const reference = referenceSize(snapshot.table, rotation, spread, zoomRefPage);
    const margin: Size = { width: FIT_MARGIN.width + reference.extraWidthPx, height: FIT_MARGIN.height };
    return resolveZoom(zoomMode, reference.pagePt, viewport, margin);
  }, [snapshot, zoomMode, zoomStored, rotation, spread, zoomRefPage, viewport, vh]);

  useEffect(() => {
    if (zoom !== zoomStored) useViewer.setState({ zoom });
  }, [zoom, zoomStored]);

  const layout = useMemo<Layout | null>(
    () =>
      snapshot === null
        ? null
        : computeLayout(snapshot.table, {
            scale: zoomToScale(zoom),
            rotation,
            gap: DEFAULT_GAP,
            padding: DEFAULT_PADDING,
            spread,
          }),
    [snapshot, zoom, rotation, spread],
  );

  // Modo por páginas: solo se muestra la fila de la página actual, y el scroll recorre su ventana.
  const win = paged && layout !== null ? windowOf(layout, currentPage) : null;
  const winTop = win?.top ?? 0;
  const winHeight = win?.height ?? 0;
  const shownPage = layout === null || layout.count === 0 ? 0 : Math.min(currentPage, layout.count - 1);

  const map = useMemo<ScrollMap>(() => {
    if (layout === null) return { scrollHeight: 0, factor: 1 };
    return paged ? { scrollHeight: winHeight, factor: 1 } : scrollMap(layout, vh);
  }, [layout, vh, paged, winHeight]);
  // Origen del scroll en px de contenido: 0 en continuo, el techo de la ventana en modo por páginas.
  const originY = paged ? winTop : 0;
  const maxY = layout === null ? 0 : maxContentY(layout, vh);
  const lo = originY;
  const hi = paged ? winTop + Math.max(0, winHeight - vh) : maxY;

  // Fuente de verdad del scroll vertical (px de contenido). El estado de React solo sirve para pintar.
  const contentYRef = useRef(0);
  const [contentY, setContentY] = useState(0);
  // scrollTop que el propio visor ha puesto: su evento `scroll` de eco se ignora para no perder precisión.
  const echoRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const prevLayoutRef = useRef<Layout | null>(null);
  const handledSeqRef = useRef(0);
  const wheelRef = useRef<WheelAccumulator>({ total: 0, last: -Infinity });

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
    const target = contentYToScrollTop(contentYRef.current, map) - originY;
    if (Math.abs(el.scrollTop - target) >= 0.5) {
      el.scrollTop = target;
      echoRef.current = el.scrollTop;
    }
  }, [map, originY]);

  /** Lleva la vista a `next` (acotado). Lo usan el teclado, la rueda con scroll escalado y la mano. */
  const applyContentY = useCallback(
    (next: number): void => {
      contentYRef.current = clampY(next, lo, hi);
      syncScrollTop();
      scheduleRender();
    },
    [lo, hi, syncScrollTop, scheduleRender],
  );

  /** Pasa a la fila siguiente (arriba del todo) o a la anterior (abajo del todo). Modo por páginas. */
  const turnRow = useCallback(
    (dir: 1 | -1): void => {
      const target = stepRow(useViewer.getState().currentPage, dir, spread, layout?.count ?? 0);
      if (target !== null) goToPage(target, { yFraction: dir === 1 ? 0 : 1 });
    },
    [spread, layout],
  );

  /** Desplaza `delta` px dentro de la fila. En modo por páginas, en un borde pasa a la fila vecina. */
  const stepScroll = useCallback(
    (delta: number): void => {
      const y = contentYRef.current;
      if (paged && delta > 0 && y >= hi - 1) turnRow(1);
      else if (paged && delta < 0 && y <= lo + 1) turnRow(-1);
      else applyContentY(y + delta);
    },
    [paged, lo, hi, turnRow, applyContentY],
  );

  // Al cambiar el layout (zoom, rotación, dimensiones, páginas por fila) la vista se recoloca en la misma página
  // y posición. Si lo pide una acción de zoom o giro (`zoomFocusY`), el punto indicado es el que no se mueve.
  // En modo por páginas se conserva la fila actual y el desplazamiento dentro de ella.
  useLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    prevLayoutRef.current = layout;
    if (layout === null) return;
    if (prev !== null && prev !== layout) {
      const focus = useViewer.getState().zoomFocusY;
      const focusPx = focus === null ? 0 : focus === 'center' ? vh / 2 : focus;
      if (paged) {
        const oldTop = windowOf(prev, useViewer.getState().currentPage)?.top ?? 0;
        contentYRef.current = winTop + (contentYRef.current - oldTop);
      } else {
        const anchor = anchorAt(prev, contentYRef.current + focusPx);
        contentYRef.current = contentYForAnchor(layout, anchor) - focusPx;
      }
      const el = ref.current;
      if (el !== null && focus !== null) {
        // Horizontal: el centro del visor conserva su posición relativa al contenido.
        const oldWidth = Math.max(prev.maxWidth + 2 * DEFAULT_PADDING, el.clientWidth);
        const newWidth = Math.max(layout.maxWidth + 2 * DEFAULT_PADDING, el.clientWidth);
        const centerX = el.scrollLeft + el.clientWidth / 2;
        el.scrollLeft = (centerX * newWidth) / oldWidth - el.clientWidth / 2;
      }
      if (focus !== null) useViewer.setState({ zoomFocusY: null });
    }
    contentYRef.current = clampY(contentYRef.current, lo, hi);
    syncScrollTop();
    setContentY(contentYRef.current);
  }, [layout, lo, hi, vh, paged, winTop, syncScrollTop]);

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
    // En modo por páginas se va a la fila entera: «arriba del todo» es el principio de la ventana, y «abajo del todo»
    // (yFraction 1) el final de su desplazamiento.
    if (paged) {
      const row = layout.rowOf[page] ?? 0;
      const top = layout.rowTops[row] ?? 0;
      const height = layout.rowHeights[row] ?? 0;
      contentYRef.current = yFraction <= 0 ? lo : clampY(top + yFraction * height - NAV_TOP_MARGIN, lo, hi);
    } else {
      const top = layout.tops[page] ?? 0;
      const height = layout.heights[page] ?? 0;
      contentYRef.current = clampY(top + yFraction * height - NAV_TOP_MARGIN, lo, hi);
    }
    syncScrollTop();
    const el = ref.current;
    const contentWidth = layout.maxWidth + 2 * DEFAULT_PADDING;
    if (el !== null && xFraction !== null && contentWidth > el.clientWidth) {
      el.scrollLeft = Math.max(0, contentWidth * xFraction - el.clientWidth / 2);
    }
    setContentY(contentYRef.current);
  }, [navRequest, layout, lo, hi, paged, syncScrollTop]);

  // Al cambiar entre desplazamiento continuo y por páginas, la vista va al principio de la fila de la página actual.
  const pagedBeforeRef = useRef(paged);
  useEffect(() => {
    if (pagedBeforeRef.current === paged) return;
    pagedBeforeRef.current = paged;
    goToPage(rowFirstPage(useViewer.getState().currentPage, spread));
  }, [paged, spread]);

  // Página actual: la que queda en el tercio superior del visor. En modo por páginas es la primera de la fila mostrada.
  useEffect(() => {
    if (layout === null || layout.count === 0) return;
    const page = paged ? rowFirstPage(shownPage, spread) : pageAtY(layout, contentY + vh / 3);
    setCurrentPage(page);
    // Posición dentro de la página: el borde superior del visor, con el mismo margen que usa «ir a página».
    const height = layout.heights[page] ?? 0;
    const top = layout.tops[page] ?? 0;
    const yFraction = height > 0 ? Math.min(Math.max((contentY + NAV_TOP_MARGIN - top) / height, 0), 1) : 0;
    setCurrentYFraction(yFraction);
  }, [layout, contentY, vh, paged, shownPage, spread]);

  // Ancho del contenido frente al del visor (el espaciador nunca es más estrecho que el visor).
  const contentWidth = layout === null ? 0 : layout.maxWidth + 2 * DEFAULT_PADDING;
  const hasOverflow = contentWidth > viewport.width;
  useEffect(() => {
    setHorizontalOverflow(hasOverflow);
  }, [hasOverflow]);

  // Con scroll escalado el navegador no puede recorrer todo el contenido, y en modo por páginas el desplazamiento
  // está acotado a la fila: rueda y teclado se gestionan aquí.
  const scaled = map.factor > 1;
  const custom = scaled || paged;
  useEffect(() => {
    const el = ref.current;
    if (el === null || !custom) return undefined;
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (isZoomWheel(event)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? vh : 1;
      const px = event.deltaY * unit;
      if (!paged) {
        applyContentY(contentYRef.current + px);
        return;
      }
      // Modo por páginas: al final (o principio) de la fila, la rueda acumula y al pasar de WHEEL_ROW_PX cambia de fila.
      const acc = wheelRef.current;
      if (event.timeStamp - acc.last > WHEEL_IDLE_MS) acc.total = 0;
      acc.last = event.timeStamp;
      const y = contentYRef.current;
      const atEdge = (px > 0 && y >= hi - 1) || (px < 0 && y <= lo + 1);
      if (!atEdge) {
        acc.total = 0;
        applyContentY(y + px);
        return;
      }
      if (Math.sign(acc.total) !== Math.sign(px)) acc.total = 0;
      acc.total += px;
      if (Math.abs(acc.total) > WHEEL_ROW_PX) {
        acc.total = 0;
        turnRow(px > 0 ? 1 : -1);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [custom, paged, vh, lo, hi, applyContentY, turnRow]);

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
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Con la herramienta «Firmar», Intro coloca la firma en la página actual, a un tercio de lo visible (PDF-043).
    // Va antes de comprobar `scaled`: un documento que cabe entero también debe poder firmarse con teclado.
    if (event.key === 'Enter' && useAnnotations.getState().tool === 'signature') {
      event.preventDefault();
      const pagePx = layout?.heights[useViewer.getState().currentPage] ?? 0;
      placeSignatureFromKeyboard(pagePx > 0 ? Math.min(1, vh / pagePx) : 1);
      return;
    }
    if (!scaled && !paged) return;
    const pageStep = vh - ARROW_STEP;
    let delta: number;
    switch (event.key) {
      case 'ArrowUp':
        delta = -ARROW_STEP;
        break;
      case 'ArrowDown':
        delta = ARROW_STEP;
        break;
      case 'PageUp':
        delta = -pageStep;
        break;
      case 'PageDown':
        delta = pageStep;
        break;
      case ' ':
        delta = event.shiftKey ? -pageStep : pageStep;
        break;
      default:
        return;
    }
    event.preventDefault();
    stepScroll(delta);
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
    contentYRef.current = clampY(scrollTopToContentY(el.scrollTop, map) + originY, lo, hi);
    scheduleRender();
  };

  // El contenedor siempre está montado para que el visor mida su tamaño desde el principio.
  const frames: ReactElement[] = [];
  let spacerWidth = 0;
  if (layout !== null) {
    spacerWidth = Math.max(layout.maxWidth + 2 * DEFAULT_PADDING, viewport.width);
    // Modo por páginas: solo los marcos de la fila mostrada.
    const range = paged ? rowRange(layout, shownPage) : visibleRange(layout, contentY, contentY + vh, 1);
    const inView = paged ? range : visibleRange(layout, contentY, contentY + vh, 0);
    const scrollTop = contentYToScrollTop(contentY, map) - originY;
    for (let i = range.first; i <= range.last; i++) {
      frames.push(
        <PageView
          key={i}
          index={i}
          numPages={layout.count}
          top={(layout.tops[i] ?? 0) - contentY + scrollTop}
          left={(spacerWidth - layout.maxWidth) / 2 + (layout.lefts[i] ?? 0)}
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
