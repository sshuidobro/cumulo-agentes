import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  computeLayout,
  contentYToScrollTop,
  maxContentY,
  scrollMap,
  scrollTopToContentY,
  visibleRange,
  type Layout,
  type ScrollMap,
} from '../../core/layout';
import {
  nextThumbnailPage,
  THUMB_GAP,
  THUMB_OVERSCAN,
  THUMB_PADDING,
  thumbnailScale,
} from '../../core/sidebar';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import { useViewportSize } from '../viewer/use-viewport-size';
import { selectThumbnail, thumbnailDomId, ThumbnailItem } from './ThumbnailItem';
import styles from './Sidebar.module.css';

/**
 * Lista virtualizada de miniaturas. Solo monta las visibles (más un margen), así que es igual de fluida con
 * cualquier número de páginas. Es un `listbox` con el foco en el contenedor y `aria-activedescendant`.
 */
export function Thumbnails(): ReactElement {
  const dims = useViewer((s) => s.dims);
  const dimsVersion = useViewer((s) => s.dimsVersion);
  const rotation = useViewer((s) => s.rotation);
  const currentPage = useViewer((s) => s.currentPage);
  const pageLabels = useViewer((s) => s.pageLabels);

  const ref = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(ref);
  const vh = viewport.height;
  // Posición de scroll del contenedor (px del navegador). El contenido se deriva de ella al pintar.
  const [scrollTop, setScrollTop] = useState(0);

  // La tabla de dimensiones se muta en sitio: el par (tabla, versión) cambia de identidad con cada cambio.
  const snapshot = useMemo(() => (dims === null ? null : { table: dims, version: dimsVersion }), [dims, dimsVersion]);
  const layout = useMemo<Layout | null>(
    () =>
      snapshot === null || snapshot.table.count === 0
        ? null
        : computeLayout(snapshot.table, {
            scale: thumbnailScale(snapshot.table, rotation),
            rotation,
            gap: THUMB_GAP,
            padding: THUMB_PADDING,
          }),
    [snapshot, rotation],
  );
  const map = useMemo<ScrollMap>(
    () => (layout === null ? { scrollHeight: 0, factor: 1 } : scrollMap(layout, vh)),
    [layout, vh],
  );

  const maxY = layout === null ? 0 : maxContentY(layout, vh);
  const contentY = Math.min(scrollTopToContentY(scrollTop, map), maxY);
  const scrollPx = contentYToScrollTop(contentY, map);
  const range = layout === null ? null : visibleRange(layout, contentY, contentY + vh, THUMB_OVERSCAN);
  const inView = layout === null ? null : visibleRange(layout, contentY, contentY + vh, 0);
  const visibleCount = inView === null ? 0 : inView.last - inView.first + 1;

  // Mantiene visible la página actual cuando cambia; si ya se ve, no mueve el scroll.
  useEffect(() => {
    const el = ref.current;
    if (el === null || layout === null || currentPage < 0 || currentPage >= layout.count) return;
    const top = layout.tops[currentPage] ?? 0;
    const bottom = top + (layout.heights[currentPage] ?? 0);
    const viewTop = scrollTopToContentY(el.scrollTop, map);
    const viewBottom = viewTop + vh;
    let target: number | null = null;
    if (top < viewTop) target = top - THUMB_PADDING;
    else if (bottom > viewBottom) target = bottom + THUMB_PADDING - vh;
    if (target === null) return;
    const clamped = Math.min(Math.max(target, 0), maxContentY(layout, vh));
    el.scrollTop = contentYToScrollTop(clamped, map);
    setScrollTop(el.scrollTop);
  }, [currentPage, layout, map, vh]);

  const onScroll = (): void => {
    const el = ref.current;
    if (el !== null) setScrollTop(el.scrollTop);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (layout === null || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = nextThumbnailPage(event.key, currentPage, layout.count, visibleCount);
    if (target === null) return;
    // La tecla es de la lista: no debe llegar a los atajos globales (Inicio, Fin, flechas de página).
    event.preventDefault();
    event.stopPropagation();
    selectThumbnail(target);
  };

  const activeId =
    layout !== null && currentPage >= 0 && currentPage < layout.count ? thumbnailDomId(currentPage) : undefined;

  const items: ReactElement[] = [];
  if (layout !== null && range !== null) {
    const left = (name: number): number => Math.max(0, (viewport.width - (layout.widths[name] ?? 0)) / 2);
    for (let i = range.first; i <= range.last; i++) {
      items.push(
        <ThumbnailItem
          key={i}
          index={i}
          numPages={layout.count}
          top={(layout.tops[i] ?? 0) - contentY + scrollPx}
          left={left(i)}
          width={layout.widths[i] ?? 0}
          height={layout.heights[i] ?? 0}
          scale={layout.params.scale}
          rotation={rotation}
          label={pageLabels?.[i] ?? String(i + 1)}
          selected={i === currentPage}
        />,
      );
    }
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={msg.thumbnails}
      aria-activedescendant={activeId}
      tabIndex={0}
      className={styles.list}
      data-testid="thumbnails"
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      {layout !== null && (
        <div className={styles.spacer} style={{ height: map.scrollHeight }}>
          {items}
        </div>
      )}
    </div>
  );
}
