import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createLogger } from '@suite/shared';
import { planCanvas } from '../../core/canvas-size';
import type { PageDimsTable } from '../../core/page-dims';
import type { PlanSlot } from '../../core/organize/plan';
import { fitBox } from '../../core/organize/grid';
import { NIGHT_PAGE_COLORS } from '../../core/night';
import { renderPageToCanvas } from '../../engine/render';
import type { PDFPageProxy } from '../../engine/pdfjs';
import { renderQueue, releaseCanvas } from '../../state/render-service';
import { useAppearance } from '../../state/appearance-store';
import { useOrganize } from '../../state/organize-store';
import { useViewer } from '../../state/viewer-store';
import { PRIORITY_THUMBNAIL } from '../sidebar/ThumbnailItem';
import { organizeMsg } from '../messages-organize';
import styles from './OrganizeView.module.css';

const log = createLogger('organize-cell');

/** Id DOM de la celda `index`, para `aria-activedescendant` de la cuadrícula. */
export function organizeCellDomId(index: number): string {
  return `organize-cell-${String(index)}`;
}

/**
 * Tamaño en puntos de un hueco ya girado (intercambia ancho y alto a 90 o 270). `null` si no se conoce
 * (página original sin medidas, o página importada).
 */
export function slotPageSize(
  slot: PlanSlot,
  dims: PageDimsTable | null,
): { readonly width: number; readonly height: number } | null {
  let width: number;
  let height: number;
  if (slot.kind === 'blank') {
    width = slot.width;
    height = slot.height;
  } else if (slot.kind === 'original' && dims !== null && dims.isKnown(slot.source)) {
    width = dims.width(slot.source);
    height = dims.height(slot.source);
  } else {
    return null;
  }
  return slot.rotate === 90 || slot.rotate === 270 ? { width: height, height: width } : { width, height };
}

/** Nombre corto de un fichero para la etiqueta de la celda (el completo va en `title`). */
export function shortFileName(name: string, max = 16): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

export interface OrganizeCellProps {
  /** Posición en la cuadrícula (0 based). */
  readonly index: number;
  readonly slot: PlanSlot;
  /** Ancho de la celda en px CSS (`ORGANIZE_CELL_SIZES`). */
  readonly cell: number;
  /** Posición y tamaño del marco de la celda dentro de la cuadrícula, en px CSS. */
  readonly top: number;
  readonly left: number;
  readonly height: number;
  readonly focused: boolean;
  readonly selected: boolean;
  readonly onSelect: (index: number, event: MouseEvent<HTMLDivElement>) => void;
  readonly onOpen: (index: number) => void;
  /** Inicio de un posible arrastre (botón principal pulsado sobre la celda). */
  readonly onPointerDown: (index: number, event: PointerEvent<HTMLDivElement>) => void;
}

/**
 * Celda de la cuadrícula: miniatura de la página de origen con el giro del hueco (absoluto), o un rectángulo
 * blanco para una página en blanco. La etiqueta da la posición nueva y, si cambió, la original.
 */
export const OrganizeCell = memo(function OrganizeCell({
  index,
  slot,
  cell,
  top,
  left,
  height,
  focused,
  selected,
  onSelect,
  onOpen,
  onPointerDown,
}: OrganizeCellProps) {
  const viewerDoc = useViewer((s) => s.pdf?.doc ?? null);
  const dims = useViewer((s) => s.dims);
  const nightMode = useAppearance((s) => s.nightMode);
  // Hueco importado (PDF-128): su documento y nombre están en la vista; sus medidas, en `importedPage`.
  const importedEntry = useOrganize((s) => (slot.kind === 'imported' ? (s.imported[slot.doc] ?? null) : null));
  const [rendered, setRendered] = useState(false);
  const [importedPage, setImportedPage] = useState<{ readonly key: string; readonly width: number; readonly height: number } | null>(null);

  const doc = slot.kind === 'imported' ? (importedEntry?.doc ?? null) : viewerDoc;
  const importedKey = slot.kind === 'imported' ? `${String(slot.doc)}:${String(slot.source)}` : null;
  const importedSource = slot.kind === 'imported' ? slot.source : null;
  const importedFile = importedEntry?.name ?? null;

  // Medidas de la página importada (sin giro): pdf.js da el viewport a escala 1. Solo cambia el estado al llegar.
  useEffect(() => {
    if (doc === null || importedSource === null || importedKey === null) return;
    let cancelled = false;
    void doc.getPage(importedSource + 1).then(
      (page) => {
        const viewport = page.getViewport({ scale: 1 });
        page.cleanup();
        if (!cancelled) setImportedPage({ key: importedKey, width: viewport.width, height: viewport.height });
      },
      (cause: unknown) => {
        log.warn('no se han podido leer las medidas de la página importada', { error: cause });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc, importedSource, importedKey]);

  const measured = importedPage !== null && importedPage.key === importedKey ? importedPage : null;
  const size =
    slot.kind === 'imported'
      ? measured === null
        ? null
        : slot.rotate === 90 || slot.rotate === 270
          ? { width: measured.height, height: measured.width }
          : { width: measured.width, height: measured.height }
      : slotPageSize(slot, dims);
  const box = size === null ? fitBox(cell, 1, Math.SQRT2) : fitBox(cell, size.width, size.height);
  const source = slot.kind === 'original' || slot.kind === 'imported' ? slot.source : null;
  const rotate = slot.rotate;
  const canDraw = doc !== null && source !== null && size !== null;
  const scale = size === null || size.width <= 0 ? 0 : box.width / size.width;
  const key = `organize:${slot.key}`;

  const hostRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const pendingRef = useRef<HTMLCanvasElement | null>(null);

  // Dibuja la página de origen con el giro del hueco. Igual que las miniaturas: cola de render con prioridad menor.
  useEffect(() => {
    if (!canDraw || doc === null || source === null) return;
    const host = hostRef.current;
    const plan = planCanvas(box.width, box.height, window.devicePixelRatio);

    const run = async (signal: AbortSignal): Promise<void> => {
      try {
        const page = await doc.getPage(source + 1);
        pageRef.current = page;
        if (signal.aborted) return;
        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        pendingRef.current = canvas;
        const outcome = await renderPageToCanvas(page, canvas, {
          scale,
          rotation: rotate,
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
        setRendered(true);
      } catch (cause: unknown) {
        if (signal.aborted) return;
        log.warn('no se ha podido dibujar la celda', { page: source + 1, error: cause });
      }
    };

    renderQueue.request({ key, priority: PRIORITY_THUMBNAIL, run });
  }, [canDraw, doc, source, rotate, scale, box.width, box.height, nightMode, key]);

  // Al desmontarse (o cambiar de hueco) se cancela el dibujo, se liberan los lienzos y la página de pdf.js.
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

  const origin = slot.kind === 'original' ? slot.source + 1 : null;
  const position = index + 1;
  const pageClass = slot.kind === 'blank' ? `${styles.page} ${styles.blank}` : styles.page;
  const frameClass = [styles.frame, focused ? styles.focused : '', selected ? styles.selected : '']
    .filter((c) => c !== '')
    .join(' ');

  return (
    <div
      role="option"
      id={organizeCellDomId(index)}
      aria-selected={selected}
      aria-label={importedFile === null ? organizeMsg.pageOption(position, rotate) : `${organizeMsg.pageOption(position, rotate)} ${importedFile}`}
      data-organize-index={index}
      data-rendered={rendered ? 'true' : undefined}
      className={frameClass}
      style={{ top, left, width: cell, height }}
      onPointerDown={(event) => {
        onPointerDown(index, event);
      }}
      onClick={(event) => {
        onSelect(index, event);
      }}
      onDoubleClick={() => {
        onOpen(index);
      }}
    >
      <div className={styles.stage}>
        <div className={pageClass} style={{ width: box.width, height: box.height }}>
          <div ref={hostRef} className={styles.canvasHost} />
        </div>
      </div>
      <span className={styles.label} aria-hidden="true">
        <span>{position}</span>
        {origin !== null && origin !== position && <span className={styles.was}>{organizeMsg.was(origin)}</span>}
        {importedFile !== null && (
          <>
            {' '}
            <span className={styles.source} title={importedFile}>
              {shortFileName(importedFile)}
            </span>
          </>
        )}
      </span>
    </div>
  );
});
