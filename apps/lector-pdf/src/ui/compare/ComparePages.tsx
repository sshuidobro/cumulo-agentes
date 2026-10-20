import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { planCanvas } from '../../core/canvas-size';
import { marksForSide, type CompareMark, type MarkKind } from '../../core/compare/marks';
import type { PageComparison } from '../../core/compare/compare';
import { renderPageToCanvas } from '../../engine/render';
import { createTextLayer, type TextLayerHandle } from '../../engine/text';
import type { PDFDocumentProxy, PDFPageProxy } from '../../engine';
import { comparedDocument } from '../../state/compare-actions';
import { releaseCanvas } from '../../state/render-service';
import { useViewer } from '../../state/viewer-store';
import { createLogger } from '@suite/shared';
import { compareMsg } from '../messages-compare';
import { rangeForMatch } from '../viewer/SearchHighlights';
import { useViewportSize } from '../viewer/use-viewport-size';
import '../viewer/text-layer.css';
import styles from './ComparePages.module.css';

const log = createLogger('compare-pages');

/** Padding horizontal de `.area` (1rem): el ancho de la página es el de la zona menos este margen a cada lado. */
const AREA_PADDING_PX = 16;

type CompareMode = 'side' | 'overlay';

/** Rectángulo de un resaltado, en píxeles CSS relativos a la página. */
interface HitBox {
  readonly key: string;
  readonly kind: MarkKind;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ComparePagesProps {
  /** Cambio seleccionado: su página se muestra en las dos columnas. */
  readonly result: PageComparison;
  /** Índice del cambio en la lista. Cada selección nueva cancela el dibujo anterior. */
  readonly token: number;
  readonly otherName: string;
}

/** Páginas del cambio seleccionado (PDF-117): lado a lado con resaltados, o superposición. */
export function ComparePages({ result, token, otherName }: ComparePagesProps) {
  const [mode, setMode] = useState<CompareMode>('side');
  const openDoc = useViewer((s) => s.pdf);
  const otherDoc = comparedDocument();
  const aDoc = openDoc?.doc ?? null;
  const bDoc = otherDoc?.doc ?? null;
  const marksA = useMemo(() => marksForSide(result, 'a'), [result]);
  const marksB = useMemo(() => marksForSide(result, 'b'), [result]);
  const inA = result.kind !== 'only-in-b';
  const inB = result.kind !== 'only-in-a';

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div role="group" aria-label={compareMsg.viewMode} className={styles.modes}>
          <button
            type="button"
            className={styles.modeButton}
            aria-pressed={mode === 'side'}
            onClick={() => { setMode('side'); }}
          >
            {compareMsg.sideBySide}
          </button>
          <button
            type="button"
            className={styles.modeButton}
            aria-pressed={mode === 'overlay'}
            onClick={() => { setMode('overlay'); }}
          >
            {compareMsg.overlay}
          </button>
        </div>
        {mode === 'overlay' && <p className={styles.legend}>{compareMsg.overlayLegend}</p>}
      </div>
      {mode === 'side' ? (
        <div className={styles.columns}>
          <PageColumn
            title={compareMsg.openDocument}
            doc={aDoc}
            pageIndex={result.page}
            present={inA}
            marks={marksA}
            token={token}
          />
          <PageColumn title={otherName} doc={bDoc} pageIndex={result.page} present={inB} marks={marksB} token={token} />
        </div>
      ) : aDoc !== null && bDoc !== null && inA && inB ? (
        <OverlayPage a={aDoc} b={bDoc} pageIndex={result.page} token={token} />
      ) : (
        <p className={styles.missing}>{compareMsg.missingPage}</p>
      )}
    </div>
  );
}

interface PageColumnProps {
  readonly title: string;
  readonly doc: PDFDocumentProxy | null;
  /** Página 0-based. */
  readonly pageIndex: number;
  /** `false` si la página no existe en este documento. */
  readonly present: boolean;
  readonly marks: readonly CompareMark[];
  readonly token: number;
}

/** Una página del cambio con su capa de texto oculta (para medir) y los resaltados encima. */
function PageColumn({ title, doc, pageIndex, present, marks, token }: PageColumnProps) {
  const titleId = useId();
  const areaRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const area = useViewportSize(areaRef);
  const width = Math.max(0, area.width - 2 * AREA_PADDING_PX);
  const shown = present && doc !== null;
  const [view, setView] = useState<{ readonly token: number; readonly boxes: readonly HitBox[] } | null>(null);
  const boxes = view !== null && view.token === token ? view.boxes : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    const page = pageRef.current;
    const text = textRef.current;
    if (!shown || doc === null || canvas === null || page === null || text === null || width <= 0) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    const loaded: PDFPageProxy[] = [];
    let layer: TextLayerHandle | null = null;

    void (async () => {
      try {
        const pdfPage = await doc.getPage(pageIndex + 1);
        loaded.push(pdfPage);
        if (signal.aborted) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = pdfPage.getViewport({ scale, rotation: 0 });
        const plan = planCanvas(viewport.width, viewport.height, window.devicePixelRatio);
        canvas.width = plan.width;
        canvas.height = plan.height;
        fitBox(canvas, viewport.width, viewport.height);
        fitBox(page, viewport.width, viewport.height);
        text.style.setProperty('--total-scale-factor', String(scale));
        text.style.setProperty('--scale-round-x', '1px');
        text.style.setProperty('--scale-round-y', '1px');

        const outcome = await renderPageToCanvas(pdfPage, canvas, {
          scale,
          rotation: 0,
          outputScale: plan.outputScale,
          signal,
        });
        if (outcome === 'cancelled' || signal.aborted) return;

        layer = createTextLayer(pdfPage, text, viewport);
        await layer.render();
        if (signal.aborted) return;
        setView({ token, boxes: boxesFor(layer, marks) });
      } catch (cause: unknown) {
        if (!signal.aborted) log.warn('no se ha podido dibujar la página de la comparación', { page: pageIndex + 1, error: cause });
      } finally {
        for (const p of loaded) p.cleanup();
      }
    })();

    return () => {
      controller.abort();
      layer?.cancel();
      text.replaceChildren();
      releaseCanvas(canvas);
    };
  }, [shown, doc, pageIndex, width, marks, token]);

  return (
    <section className={styles.column} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.heading}>
        {title}
      </h3>
      <div ref={areaRef} className={styles.area}>
        {shown ? (
          <div ref={pageRef} className={styles.page}>
            <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
            <div ref={textRef} className={`textLayer ${styles.text}`} />
            <div className={styles.highlights} aria-hidden="true">
              {boxes.map((box) => (
                <div
                  key={box.key}
                  className={styles.mark}
                  data-change={box.kind}
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className={styles.missing}>{compareMsg.missingPage}</p>
        )}
      </div>
    </section>
  );
}

interface OverlayPageProps {
  readonly a: PDFDocumentProxy;
  readonly b: PDFDocumentProxy;
  readonly pageIndex: number;
  readonly token: number;
}

/**
 * Superposición: la página del documento abierto y la del otro, a la misma escala (la de A), con la diferencia
 * de colores. Lo igual sale negro; lo distinto, en color. Si B tiene otro tamaño, se ancla arriba a la izquierda.
 */
function OverlayPage({ a, b, pageIndex, token }: OverlayPageProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const area = useViewportSize(areaRef);
  const width = Math.max(0, area.width - 2 * AREA_PADDING_PX);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || width <= 0) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    const loaded: PDFPageProxy[] = [];
    const offscreen: HTMLCanvasElement[] = [];

    void (async () => {
      try {
        const pageA = await a.getPage(pageIndex + 1);
        loaded.push(pageA);
        const pageB = await b.getPage(pageIndex + 1);
        loaded.push(pageB);
        if (signal.aborted) return;

        const base = pageA.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewA = pageA.getViewport({ scale, rotation: 0 });
        const viewB = pageB.getViewport({ scale, rotation: 0 });
        const { outputScale } = planCanvas(viewA.width, viewA.height, window.devicePixelRatio);

        const canvasA = document.createElement('canvas');
        const canvasB = document.createElement('canvas');
        offscreen.push(canvasA, canvasB);
        sizeBuffer(canvasA, viewA.width, viewA.height, outputScale);
        sizeBuffer(canvasB, viewB.width, viewB.height, outputScale);

        const options = { scale, rotation: 0 as const, outputScale, signal };
        const rendered = await renderPageToCanvas(pageA, canvasA, options);
        if (rendered === 'cancelled' || signal.aborted) return;
        const renderedB = await renderPageToCanvas(pageB, canvasB, options);
        if (renderedB === 'cancelled' || signal.aborted) return;

        sizeBuffer(canvas, viewA.width, viewA.height, outputScale);
        fitBox(canvas, viewA.width, viewA.height);
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('lienzo sin contexto 2d'); // bug
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(canvasA, 0, 0);
        ctx.globalCompositeOperation = 'difference';
        ctx.drawImage(canvasB, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      } catch (cause: unknown) {
        if (!signal.aborted) log.warn('no se ha podido superponer la página de la comparación', { page: pageIndex + 1, error: cause });
      } finally {
        for (const p of loaded) p.cleanup();
        for (const c of offscreen) releaseCanvas(c);
      }
    })();

    return () => {
      controller.abort();
      releaseCanvas(canvas);
    };
  }, [a, b, pageIndex, width, token]);

  return (
    <div ref={areaRef} className={styles.area}>
      <canvas ref={canvasRef} className={`${styles.canvas} ${styles.page}`} aria-hidden="true" />
    </div>
  );
}

/** Lienzo de trabajo de `cssWidth × cssHeight` píxeles CSS a `outputScale` píxeles por píxel CSS. */
function sizeBuffer(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, outputScale: number): void {
  canvas.width = Math.max(1, Math.floor(cssWidth * outputScale));
  canvas.height = Math.max(1, Math.floor(cssHeight * outputScale));
}

/** Tamaño CSS de un elemento (el lienzo ya tiene su resolución en píxeles de dispositivo). */
function fitBox(el: HTMLElement, cssWidth: number, cssHeight: number): void {
  el.style.width = `${String(cssWidth)}px`;
  el.style.height = `${String(cssHeight)}px`;
}

/**
 * Rectángulos de los resaltados de la página, en píxeles CSS relativos a la capa de texto. Cada palabra se mide
 * con su `Range` sobre la capa; una palabra sin rango medible no se resalta.
 */
function boxesFor(layer: TextLayerHandle, marks: readonly CompareMark[]): readonly HitBox[] {
  const origin = layer.container.getBoundingClientRect();
  const boxes: HitBox[] = [];
  marks.forEach((mark, i) => {
    const range = rangeForMatch(layer.textDivs, mark.match);
    if (range === null) return;
    Array.from(range.getClientRects()).forEach((rect, j) => {
      boxes.push({
        key: `${String(i)}-${String(j)}`,
        kind: mark.kind,
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      });
    });
  });
  return boxes;
}
