import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import { indexOfKey, extendTo, selectAll, selectOnly, toggleKey, type PlanSelection } from '../../core/organize/plan';
import { GRID_GAP, gridMetrics, neighbour, ORGANIZE_CELL_SIZES, visibleCells, type GridKey } from '../../core/organize/grid';
import {
  cancelOrganizeSave,
  closeOrganize,
  deleteSelected,
  moveSelected,
  organizeRedo,
  organizeUndo,
  rotateSelected,
  saveOrganize,
  setSelection,
} from '../../state/organize-actions';
import { organizeDirty, useOrganize } from '../../state/organize-store';
import { goToPage } from '../../state/navigation';
import { useShortcuts } from '../use-shortcuts';
import { useViewportSize } from '../viewer/use-viewport-size';
import { organizeMsg } from '../messages-organize';
import { propertiesMsg } from '../messages-properties';
import { OrganizeCell, organizeCellDomId } from './OrganizeCell';
import { OrganizeToolbar } from './OrganizeToolbar';
import styles from './OrganizeView.module.css';

/** Filas de celdas por encima y por debajo de las visibles que se montan. */
const OVERSCAN_ROWS = 2;

const NAV_KEYS: ReadonlySet<string> = new Set<GridKey>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function isNavKey(key: string): key is GridKey {
  return NAV_KEYS.has(key);
}

/** Botón «Más acciones» de la barra principal: a él vuelve el foco al cerrar la vista. */
function moreActionsButton(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('button')).find(
    (button) => button.getAttribute('aria-label') === propertiesMsg.moreActions,
  ) ?? null;
}

/**
 * Vista «Organizar páginas» (PDF-125, ADR-0035): sustituye al visor. Cuadrícula virtualizada de miniaturas del plan,
 * con selección por ratón y teclado, giros, borrado, movimiento e inserción en blanco, deshacer y guardar.
 */
export function OrganizeView(): ReactElement {
  const status = useOrganize((s) => s.status);
  const plan = useOrganize((s) => s.plan);
  const selection = useOrganize((s) => s.selection);
  const progress = useOrganize((s) => s.progress);
  const error = useOrganize((s) => s.error);

  const listRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(listRef);
  const [cellSize, setCellSize] = useState<number>(ORGANIZE_CELL_SIZES[1]);
  const [scrollTop, setScrollTop] = useState(0);
  // Copia síncrona del scroll: el efecto de foco la lee sin depender del render anterior.
  const scrollRef = useRef(0);
  const focusedOnOpen = useRef(false);

  const editable = status === 'ready' || status === 'saving';
  const count = plan.slots.length;
  const metrics = gridMetrics(viewport.width, count, cellSize);
  const focusIndex = selection.focus === null ? -1 : indexOfKey(plan, selection.focus);
  const viewHeight = viewport.height;
  const pageRows = Math.max(1, Math.floor(viewHeight / metrics.rowHeight));
  const range = visibleCells(metrics, scrollTop, viewHeight, OVERSCAN_ROWS);
  const offsetX = Math.max(0, (viewport.width - (metrics.columns * cellSize + (metrics.columns - 1) * GRID_GAP)) / 2);
  const totalHeight = metrics.rows * metrics.rowHeight;

  // Al abrir, el foco va a la cuadrícula y el primer hueco queda con foco (sin selección).
  useEffect(() => {
    if (status !== 'ready') return;
    const first = plan.slots[0];
    if (selection.focus === null && first !== undefined) {
      setSelection({ keys: new Set<string>(), anchor: null, focus: first.key });
    }
    if (!focusedOnOpen.current) {
      focusedOnOpen.current = true;
      listRef.current?.focus();
    }
  }, [status, plan, selection.focus]);

  // Al cerrar la vista el foco vuelve al botón «Más acciones».
  useEffect(() => {
    return () => {
      moreActionsButton()?.focus();
    };
  }, []);

  // Mantiene visible la celda con foco: desplaza la lista solo si la fila queda fuera.
  useEffect(() => {
    const el = listRef.current;
    if (el === null || focusIndex < 0 || metrics.columns <= 0) return;
    const rowTop = Math.floor(focusIndex / metrics.columns) * metrics.rowHeight;
    const rowBottom = rowTop + metrics.rowHeight - GRID_GAP;
    const current = scrollRef.current;
    let target: number | null = null;
    if (rowTop < current) target = rowTop;
    else if (rowBottom > current + viewHeight) target = Math.max(0, rowBottom - viewHeight);
    if (target === null) return;
    scrollRef.current = target;
    el.scrollTop = target;
    setScrollTop(target);
  }, [focusIndex, metrics.columns, metrics.rowHeight, viewHeight]);

  useShortcuts({
    undo: () => { organizeUndo(); },
    redo: () => { organizeRedo(); },
    save: () => { void saveOrganize(); },
    'cancel-tool': () => { void closeOrganize(); },
    'organize-rotate-left': () => { rotateSelected(-90); },
    'organize-rotate-right': () => { rotateSelected(90); },
    'organize-delete': () => { deleteSelected(); },
  });

  const onScroll = (): void => {
    const el = listRef.current;
    if (el === null) return;
    scrollRef.current = el.scrollTop;
    setScrollTop(el.scrollTop);
  };

  /** Alt+← / Alt+→: mueve el bloque seleccionado una posición (la selección se conserva). */
  const moveByOne = (step: -1 | 1): void => {
    const indices: number[] = [];
    plan.slots.forEach((slot, i) => {
      if (selection.keys.has(slot.key)) indices.push(i);
    });
    const low = indices[0];
    const high = indices[indices.length - 1];
    if (low === undefined || high === undefined) return;
    if (step < 0) {
      if (low > 0) moveSelected(low - 1);
    } else if (high < count - 1) {
      // Delante del hueco que sigue al bloque (índice antes de mover).
      moveSelected(high + 2);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!editable || count === 0) return;
    const { key } = event;
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+A selecciona todo; el resto (Ctrl+Z, Ctrl+[ …) llega a los atajos de la ventana.
      if (key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(selectAll(plan));
      }
      return;
    }
    if (event.altKey) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        moveByOne(key === 'ArrowLeft' ? -1 : 1);
      }
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      if (selection.focus !== null) setSelection(toggleKey(selection, selection.focus));
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (isNavKey(key)) {
      event.preventDefault();
      const current = focusIndex < 0 ? 0 : focusIndex;
      const next = plan.slots[neighbour(metrics, count, current, key, pageRows)];
      if (next === undefined) return;
      const sel: PlanSelection = event.shiftKey ? extendTo(plan, selection, next.key) : selectOnly(next.key);
      setSelection(sel);
    }
  };

  const onCellSelect = (index: number, event: MouseEvent<HTMLDivElement>): void => {
    const slot = plan.slots[index];
    if (slot === undefined) return;
    if (event.shiftKey) setSelection(extendTo(plan, selection, slot.key));
    else if (event.ctrlKey || event.metaKey) setSelection(toggleKey(selection, slot.key));
    else setSelection(selectOnly(slot.key));
  };

  /** Doble clic: va a la página en el visor, cerrando la vista. Con cambios sin guardar no hace nada. */
  const onCellOpen = (index: number): void => {
    const slot = plan.slots[index];
    if (slot === undefined || slot.kind !== 'original' || organizeDirty()) return;
    const target = slot.source;
    void closeOrganize().then((result) => {
      if (result === 'closed') goToPage(target);
    });
  };

  const cells: ReactElement[] = [];
  if (editable && count > 0) {
    const last = Math.min(range.last, count - 1);
    for (let i = range.first; i <= last; i++) {
      const slot = plan.slots[i];
      if (slot === undefined) continue;
      const row = Math.floor(i / metrics.columns);
      const column = i % metrics.columns;
      cells.push(
        <OrganizeCell
          key={slot.key}
          index={i}
          slot={slot}
          cell={cellSize}
          top={row * metrics.rowHeight}
          left={offsetX + column * (cellSize + GRID_GAP)}
          height={metrics.rowHeight - GRID_GAP}
          focused={i === focusIndex}
          selected={selection.keys.has(slot.key)}
          onSelect={onCellSelect}
          onOpen={onCellOpen}
        />,
      );
    }
  }

  const activeId = focusIndex >= 0 && focusIndex < count ? organizeCellDomId(focusIndex) : undefined;
  const savingText =
    progress === null ? organizeMsg.savingStart : organizeMsg.saving(progress.done, progress.total);

  return (
    <div className={styles.view}>
      {editable && <OrganizeToolbar cellSize={cellSize} onCellSize={setCellSize} />}
      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable="true"
        aria-label={organizeMsg.title}
        aria-activedescendant={activeId}
        tabIndex={0}
        className={styles.grid}
        data-testid="organize-grid"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        {editable && <div className={styles.spacer} style={{ height: totalHeight }}>{cells}</div>}
      </div>
      {status === 'loading' && (
        <div className={styles.state} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <p>{organizeMsg.loading}</p>
        </div>
      )}
      {status === 'error' && (
        <div className={styles.state} role="alert">
          <p>{error ?? ''}</p>
          <button
            type="button"
            onClick={() => {
              void closeOrganize();
            }}
          >
            {organizeMsg.close}
          </button>
        </div>
      )}
      {status === 'saving' && (
        <div className={styles.saving}>
          <div className={styles.savingBox}>
            <p>{savingText}</p>
            <div
              role="progressbar"
              aria-label={savingText}
              aria-valuemin={0}
              aria-valuemax={progress?.total}
              aria-valuenow={progress?.done}
              className={styles.track}
            >
              <div
                className={styles.bar}
                style={{ width: progress === null || progress.total === 0 ? '0%' : `${String((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <button type="button" onClick={cancelOrganizeSave}>
              {organizeMsg.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
