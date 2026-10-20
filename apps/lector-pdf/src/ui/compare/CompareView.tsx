import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { describeChange, type PageComparison } from '../../core/compare/compare';
import { cancelCompare, closeCompare, countChanges, selectChange, useCompare } from '../../state/compare-actions';
import { useViewer } from '../../state/viewer-store';
import { compareMsg } from '../messages-compare';
import { useViewportSize } from '../viewer/use-viewport-size';
import styles from './CompareView.module.css';

/** Altura fija de cada fila de la lista de cambios. */
const ROW_HEIGHT = 56;
/** Filas extra pintadas a cada lado de la franja visible. */
const OVERSCAN = 4;
/** Altura de referencia de la lista mientras aún no se conoce la real (primer pintado). */
const DEFAULT_VIEW_HEIGHT = 600;

/** Vista de comparación (PDF-112): progreso, lista de cambios por página y hueco para las páginas (PDF-117). */
export function CompareView() {
  const status = useCompare((s) => s.status);
  const otherName = useCompare((s) => s.otherName);
  const results = useCompare((s) => s.results);
  const progress = useCompare((s) => s.progress);
  const cancelled = useCompare((s) => s.cancelled);
  const selected = useCompare((s) => s.selected);
  const fileName = useViewer((s) => s.file?.name ?? '');

  const titleId = useId();
  const progressId = useId();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(listRef);
  const viewHeight = viewport.height > 0 ? viewport.height : DEFAULT_VIEW_HEIGHT;
  const [scrollTop, setScrollTop] = useState(0);
  const [active, setActive] = useState(() => Math.max(0, selected ?? 0));
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  // Foco inicial en la lista; al cerrar, vuelve al visor.
  useEffect(() => {
    listRef.current?.focus();
    return () => {
      document.querySelector<HTMLElement>('[data-testid="viewer"]')?.focus();
    };
  }, []);

  const range = visibleRange(results.length, scrollTop, viewHeight, ROW_HEIGHT, OVERSCAN);
  const rows = results.slice(range.first, range.last + 1).map((result, offset) => {
    const index = range.first + offset;
    return (
      <div
        key={index}
        id={optionId(listId, index)}
        role="option"
        aria-selected={selected === index}
        className={styles.row}
        style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
        onClick={() => {
          setActive(index);
          selectChange(index);
        }}
      >
        {rowText(result)}
      </div>
    );
  });

  function moveActive(delta: 1 | -1): void {
    const next = Math.min(Math.max(activeIndex + delta, 0), results.length - 1);
    setActive(next);
    const el = listRef.current;
    if (el === null) return;
    const top = next * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    let nextScroll = el.scrollTop;
    if (top < el.scrollTop) nextScroll = top;
    else if (bottom > el.scrollTop + viewHeight) nextScroll = bottom - viewHeight;
    el.scrollTop = nextScroll;
    setScrollTop(nextScroll);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void closeCompare();
      return;
    }
    if (results.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectChange(activeIndex);
    }
  }

  const changes = countChanges(results);
  const done = status === 'done';
  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className={styles.bar}>
        <h2 id={titleId} className={styles.title}>
          {compareMsg.title(fileName, otherName ?? '')}
        </h2>
        {progress !== null && !done && (
          <div className={styles.progress}>
            <progress className={styles.meter} max={progress.totalPages} value={progress.pagesDone} aria-labelledby={progressId} />
            <span id={progressId}>{compareMsg.progress(progress.pagesDone, progress.totalPages)}</span>
          </div>
        )}
        <div className={styles.actions}>
          {status === 'running' && (
            <button type="button" className={styles.button} onClick={cancelCompare}>
              {compareMsg.cancel}
            </button>
          )}
          <button type="button" className={styles.button} onClick={() => { void closeCompare(); }}>
            {compareMsg.close}
          </button>
        </div>
      </header>
      <div className={styles.summary} role="status">
        {done && !cancelled && results.length === 0 && <p>{compareMsg.noChanges}</p>}
        {results.length > 0 && <p>{compareMsg.summary(changes, results.length)}</p>}
        {cancelled && <p>{compareMsg.cancelledNote(progress?.pagesDone ?? 0)}</p>}
      </div>
      <div className={styles.body}>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={0}
          aria-label={compareMsg.listLabel}
          aria-activedescendant={results.length > 0 ? optionId(listId, activeIndex) : undefined}
          className={styles.list}
          onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); }}
        >
          <div role="presentation" className={styles.rows} style={{ height: results.length * ROW_HEIGHT }}>
            {rows}
          </div>
        </div>
        <div className={styles.pages} data-testid="compare-pages">
          {compareMsg.selectChange}
        </div>
      </div>
    </div>
  );
}

function optionId(listId: string, index: number): string {
  return `${listId}-${String(index)}`;
}

/** Texto de la fila de una página: «Página N» más lo que cambió. */
function rowText(result: PageComparison): string {
  const n = result.page + 1;
  switch (result.kind) {
    case 'changed':
      return compareMsg.pageRow(n, result.changes.map(describeChange).join(' '));
    case 'too-different':
      return compareMsg.pageRow(n, compareMsg.tooDifferent(n));
    case 'only-in-a':
      return compareMsg.pageRow(n, compareMsg.onlyInA(n));
    case 'only-in-b':
      return compareMsg.pageRow(n, compareMsg.onlyInB(n));
    case 'same':
      return compareMsg.pageRow(n, '');
  }
}

/** Índices de las filas de altura fija que caen en la franja visible, con `overscan` a cada lado. `last < first` si no hay filas. */
function visibleRange(
  count: number,
  scrollTop: number,
  viewHeight: number,
  rowHeight: number,
  overscan: number,
): { readonly first: number; readonly last: number } {
  if (count === 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  return { first, last };
}
