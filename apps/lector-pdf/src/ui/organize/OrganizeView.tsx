import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { indexOfKey, extendTo, selectAll, selectOnly, toggleKey, type OrganizePlan, type PlanSelection } from '../../core/organize/plan';
import {
  GRID_GAP,
  gridMetrics,
  insertionIndex,
  neighbour,
  ORGANIZE_CELL_SIZES,
  visibleCells,
  type GridKey,
  type GridMetrics,
} from '../../core/organize/grid';
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

/** Distancia (px) que el puntero debe recorrer desde la pulsación para que sea un arrastre. */
const DRAG_THRESHOLD_PX = 5;
/** Franja (px) junto a los bordes superior e inferior de la lista que la desplaza sola al arrastrar. */
const DRAG_EDGE_PX = 48;
/** Desplazamiento máximo por fotograma durante el arrastre, en px. */
const DRAG_MAX_SCROLL_PX = 20;
/** Grosor de la barra de inserción, en px. */
const DROP_BAR_PX = 3;
/** Separación de la imagen que acompaña al puntero, en px. */
const GHOST_OFFSET_PX = 12;

/** Estado de un arrastre en curso (o de una pulsación que aún puede serlo). Vive en una ref: no provoca renders. */
interface DragSession {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  active: boolean;
  clientX: number;
  clientY: number;
  /** Hueco de inserción calculado en el último movimiento. */
  drop: number | null;
  scrollFrame: number | null;
}

/** Índices (ordenados) de las celdas seleccionadas. */
function selectedIndices(plan: OrganizePlan, selection: PlanSelection): number[] {
  const indices: number[] = [];
  plan.slots.forEach((slot, i) => {
    if (selection.keys.has(slot.key)) indices.push(i);
  });
  return indices;
}

/** Mueve la selección delante del hueco `toIndex` y anuncia la posición nueva de la primera página movida. */
function moveAndAnnounce(toIndex: number, announce: (text: string) => void): void {
  moveSelected(toIndex);
  const { plan, selection } = useOrganize.getState();
  const first = selectedIndices(plan, selection)[0];
  if (first !== undefined) announce(organizeMsg.moved(first + 1));
}

/** Caja (px, en el contenido de la cuadrícula) de la barra que marca el hueco de inserción `at`. */
function dropBarBox(
  m: GridMetrics,
  count: number,
  cell: number,
  offsetX: number,
  at: number,
): { readonly left: number; readonly top: number; readonly height: number } {
  const columns = Math.max(1, m.columns);
  const after = at >= count;
  const k = after ? count - 1 : at;
  const row = Math.floor(k / columns);
  const col = k % columns;
  const edge = offsetX + col * (cell + GRID_GAP) + (after ? cell + GRID_GAP / 2 : -GRID_GAP / 2);
  return { left: edge - DROP_BAR_PX / 2, top: row * m.rowHeight, height: m.rowHeight - GRID_GAP };
}

/** Velocidad de desplazamiento automático según lo cerca que esté el puntero del borde (0 fuera de la franja). */
function edgeScroll(d: DragSession, rect: DOMRect): number {
  if (rect.height <= 0) return 0;
  const fromTop = d.clientY - rect.top;
  const fromBottom = rect.bottom - d.clientY;
  const speed = (dist: number): number =>
    Math.min(DRAG_MAX_SCROLL_PX, Math.max(1, Math.ceil(((DRAG_EDGE_PX - Math.max(0, dist)) / DRAG_EDGE_PX) * DRAG_MAX_SCROLL_PX)));
  if (fromTop < DRAG_EDGE_PX) return -speed(fromTop);
  if (fromBottom < DRAG_EDGE_PX) return speed(fromBottom);
  return 0;
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
  const ghostRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(listRef);
  const [cellSize, setCellSize] = useState<number>(ORGANIZE_CELL_SIZES[1]);
  const [scrollTop, setScrollTop] = useState(0);
  /** Hueco de inserción mientras se arrastra; `null` si no hay arrastre. */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dragRef = useRef<DragSession | null>(null);
  // Tras un arrastre el «clic» que llega al soltar no debe cambiar la selección. Se limpia en cada pulsación.
  const suppressClick = useRef(false);
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

  // Medidas para los manejadores globales del arrastre: se actualizan tras cada render.
  const layout = useRef({ metrics, count, offsetX, cellSize });
  useEffect(() => {
    layout.current = { metrics, count, offsetX, cellSize };
  });

  // Arrastre con eventos de puntero (ADR-0035). Los escuchas son de la ventana porque el puntero puede salir de la lista.
  useEffect(() => {
    const endDrag = (): void => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d !== null && d.scrollFrame !== null) cancelAnimationFrame(d.scrollFrame);
      setDropAt(null);
    };
    const updateDrag = (d: DragSession): void => {
      const el = listRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      const { metrics: m, count: n, offsetX: ox } = layout.current;
      d.drop = insertionIndex(m, n, d.clientX - rect.left + el.scrollLeft - ox, d.clientY - rect.top + el.scrollTop);
      setDropAt(d.drop);
      const ghost = ghostRef.current;
      if (ghost !== null) {
        ghost.style.transform = `translate(${String(d.clientX + GHOST_OFFSET_PX)}px, ${String(d.clientY + GHOST_OFFSET_PX)}px)`;
      }
      ensureScroll(d);
    };
    const stepScroll = (d: DragSession): void => {
      d.scrollFrame = null;
      const el = listRef.current;
      if (el === null || !d.active) return;
      const delta = edgeScroll(d, el.getBoundingClientRect());
      const before = el.scrollTop;
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, before + delta));
      if (el.scrollTop === before) return;
      updateDrag(d);
    };
    const ensureScroll = (d: DragSession): void => {
      const el = listRef.current;
      if (el === null || d.scrollFrame !== null) return;
      if (edgeScroll(d, el.getBoundingClientRect()) === 0) return;
      d.scrollFrame = requestAnimationFrame(() => {
        stepScroll(d);
      });
    };
    const onMove = (event: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || event.pointerId !== d.pointerId) return;
      d.clientX = event.clientX;
      d.clientY = event.clientY;
      if (!d.active) {
        if (Math.hypot(event.clientX - d.originX, event.clientY - d.originY) <= DRAG_THRESHOLD_PX) return;
        d.active = true;
      }
      updateDrag(d);
    };
    const onUp = (event: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || event.pointerId !== d.pointerId) return;
      const { active, drop } = d;
      endDrag();
      if (!active) return;
      suppressClick.current = true;
      if (drop !== null) dropSelection(drop);
    };
    const onCancel = (event: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || event.pointerId !== d.pointerId) return;
      suppressClick.current = d.active;
      endDrag();
    };
    // Escape cancela el arrastre en fase de captura: si no, llega antes a «Cerrar» y la vista se cierra.
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || dragRef.current?.active !== true) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = true;
      endDrag();
    };
    const dropSelection = (index: number): void => {
      const { plan, selection } = useOrganize.getState();
      const indices = selectedIndices(plan, selection);
      const low = indices[0];
      const high = indices[indices.length - 1];
      if (low === undefined || high === undefined) return;
      // Soltar dentro o junto al propio bloque contiguo no cambia nada: no se crea un paso de deshacer vacío.
      const contiguous = high - low + 1 === indices.length;
      if (contiguous && index >= low && index <= high + 1) return;
      moveAndAnnounce(index, setAnnouncement);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      endDrag();
    };
  }, []);

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
    'organize-move-first': () => {
      if (editable) moveAndAnnounce(0, setAnnouncement);
    },
    'organize-move-last': () => {
      if (editable) moveAndAnnounce(useOrganize.getState().plan.slots.length, setAnnouncement);
    },
  });

  const onScroll = (): void => {
    const el = listRef.current;
    if (el === null) return;
    scrollRef.current = el.scrollTop;
    setScrollTop(el.scrollTop);
  };

  /** Alt+← / Alt+→: mueve el bloque seleccionado una posición (la selección se conserva). */
  const moveByOne = (step: -1 | 1): void => {
    const indices = selectedIndices(plan, selection);
    const low = indices[0];
    const high = indices[indices.length - 1];
    if (low === undefined || high === undefined) return;
    if (step < 0) {
      if (low > 0) moveAndAnnounce(low - 1, setAnnouncement);
    } else if (high < count - 1) {
      // Delante del hueco que sigue al bloque (índice antes de mover).
      moveAndAnnounce(high + 2, setAnnouncement);
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

  /** Pulsación sobre una celda: prepara un posible arrastre y, si no estaba seleccionada, la selecciona sola. */
  const onCellPointerDown = (index: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    suppressClick.current = false;
    if (!editable || count === 0 || event.button !== 0) return;
    const slot = plan.slots[index];
    if (slot === undefined) return;
    const selected = selection.keys.has(slot.key);
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      // Con modificadores el clic decide la selección; solo se arrastra lo ya seleccionado.
      if (!selected) return;
    } else if (!selected) {
      setSelection(selectOnly(slot.key));
    }
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      active: false,
      clientX: event.clientX,
      clientY: event.clientY,
      drop: null,
      scrollFrame: null,
    };
  };

  const onCellSelect = (index: number, event: MouseEvent<HTMLDivElement>): void => {
    if (suppressClick.current) return;
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
          onPointerDown={onCellPointerDown}
        />,
      );
    }
  }

  const activeId = focusIndex >= 0 && focusIndex < count ? organizeCellDomId(focusIndex) : undefined;
  const savingText =
    progress === null ? organizeMsg.savingStart : organizeMsg.saving(progress.done, progress.total);

  return (
    <div className={styles.view}>
      <h1 className={styles.heading}>{organizeMsg.title}</h1>
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
        {editable && (
          <div className={styles.spacer} style={{ height: totalHeight }}>
            {cells}
            {dropAt !== null && count > 0 && (
              <div
                className={styles.dropBar}
                data-testid="organize-drop-bar"
                style={dropBarBox(metrics, count, cellSize, offsetX, dropAt)}
              />
            )}
          </div>
        )}
      </div>
      <div ref={ghostRef} className={styles.ghost} hidden={dropAt === null} aria-hidden="true">
        {organizeMsg.dragGhost(selection.keys.size)}
      </div>
      <div className={styles.sr} aria-live="polite">{announcement}</div>
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
