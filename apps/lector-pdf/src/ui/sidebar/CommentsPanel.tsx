import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  authorsOf,
  buildCommentRows,
  EMPTY_COMMENT_FILTER,
  nextItemRow,
  rectTopFraction,
  rowLayout,
  typeLabelsOf,
  visibleRowRange,
  type CommentFilter,
  type CommentRow,
  type RowLayout,
} from '../../core/annotations/comment-list';
import { effectiveAnnotations } from '../../core/annotations/effective';
import type { Annotation, ReviewState, Rgb } from '../../core/annotations/model';
import { dependentIds, REVIEW_STATE_LABELS, REVIEW_STATES, threadRootId } from '../../core/annotations/replies';
import {
  cancelScanAll,
  deleteAnnotation,
  openPopupWhenPageCurrent,
  scanAllAnnotations,
  select,
  setAuthor,
} from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { goToPage } from '../../state/navigation';
import { useViewer } from '../../state/viewer-store';
import {
  IconComment,
  IconFreeText,
  IconHighlight,
  IconInk,
  IconNote,
  IconStrikeout,
  IconTrash,
  IconUnderline,
} from '../icons';
import { IconButton } from '../kit/IconButton';
import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { msg } from '../messages';
import { commentsMsg } from '../messages-comments';
import { useViewportSize } from '../viewer/use-viewport-size';
import styles from './CommentsPanel.module.css';

/** Formato de fecha de los comentarios (igual que la ventana de comentario, PDF-033). */
const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });
/** Filas de margen que se montan a cada lado de las visibles. */
const OVERSCAN = 4;
/** Altura de referencia de la lista mientras aún no se conoce la real (primer pintado). */
const DEFAULT_VIEW_HEIGHT = 600;
/** Estados que ofrece el menú de filtro (sin «Ninguno»: ese caso es «Sin estado»). */
const FILTER_STATES: readonly ReviewState[] = REVIEW_STATES.filter((state) => state !== 'None');

type ItemRow = Extract<CommentRow, { kind: 'item' }>;
type ReplyRow = Extract<CommentRow, { kind: 'reply' }>;

/** Id DOM de la fila `index`, para `aria-activedescendant` de la lista. */
function rowDomId(index: number): string {
  return `comment-row-${String(index)}`;
}

/** Lleva una fila al área visible de la lista (solo si queda fuera). */
function revealRow(el: HTMLElement, layout: RowLayout, index: number, viewHeight: number): void {
  const top = layout.tops[index] ?? 0;
  const bottom = top + (layout.heights[index] ?? 0);
  if (top < el.scrollTop) el.scrollTop = top;
  else if (bottom > el.scrollTop + viewHeight) el.scrollTop = bottom - viewHeight;
}

function toggleMember<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function isFiltered(filter: CommentFilter): boolean {
  return filter.types.size > 0 || filter.author !== null || filter.states.size > 0 || filter.text.trim() !== '';
}

/**
 * Id de la fila de comentario o respuesta más cercana a `index` que no esté en `gone` (primero hacia abajo, luego hacia
 * arriba). `null` si no queda ninguna.
 */
function nearestRowId(rows: readonly CommentRow[], index: number, gone: ReadonlySet<string>): string | null {
  const navigable = (row: CommentRow | undefined): row is ItemRow | ReplyRow =>
    (row?.kind === 'item' || row?.kind === 'reply') && !gone.has(row.id);
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i];
    if (navigable(row)) return row.id;
  }
  for (let i = index - 1; i >= 0; i--) {
    const row = rows[i];
    if (navigable(row)) return row.id;
  }
  return null;
}

function cssColor([r, g, b]: Rgb): string {
  return `rgb(${String(Math.round(r * 255))}, ${String(Math.round(g * 255))}, ${String(Math.round(b * 255))})`;
}

/**
 * Panel de comentarios (PDF-036): todas las anotaciones del documento agrupadas por página, con filtros, navegación
 * a cada una, borrado y el nombre del autor. Lista virtualizada de filas de altura fija; es un `listbox` con el foco
 * en el contenedor y `aria-activedescendant`.
 */
export function CommentsPanel(): ReactElement {
  const baseline = useAnnotations((s) => s.baseline);
  const edits = useAnnotations((s) => s.edits);
  const foreign = useAnnotations((s) => s.foreign);
  const scan = useAnnotations((s) => s.scan);
  const scanProgress = useAnnotations((s) => s.scanProgress);
  const scanCancelable = useAnnotations((s) => s.scanCancelable);
  const selectedId = useAnnotations((s) => s.selectedId);
  const author = useAnnotations((s) => s.author);
  const numPages = useViewer((s) => s.dims?.count ?? 0);

  const [filter, setFilter] = useState<CommentFilter>(EMPTY_COMMENT_FILTER);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shownSelection, setShownSelection] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const revealedRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(listRef);
  const viewHeight = viewport.height > 0 ? viewport.height : DEFAULT_VIEW_HEIGHT;

  const effective = useMemo(() => effectiveAnnotations(baseline, edits), [baseline, edits]);
  const rows = useMemo(() => buildCommentRows(effective, foreign, filter), [effective, foreign, filter]);
  const layout = useMemo(() => rowLayout(rows), [rows]);
  const authors = useMemo(() => authorsOf(effective, foreign), [effective, foreign]);
  const types = useMemo(() => typeLabelsOf(effective, foreign), [effective, foreign]);
  const itemCount = useMemo(
    () => rows.reduce((n, row) => (row.kind === 'item' ? n + 1 : n), 0),
    [rows],
  );
  const range = visibleRowRange(layout, scrollTop, viewHeight, OVERSCAN);
  const activeIndex = activeId === null ? -1 : rows.findIndex((row) => row.kind !== 'page' && row.id === activeId);
  const activeCandidate = activeIndex < 0 ? undefined : rows[activeIndex];
  const activeRow = activeCandidate?.kind === 'item' ? activeCandidate : undefined;

  // Al seleccionarse una anotación en la página, su fila pasa a ser la activa (ajuste de estado durante el render).
  if (selectedId !== shownSelection) {
    setShownSelection(selectedId);
    if (selectedId !== null) setActiveId(selectedId);
  }

  // Y se desplaza a la vista si el panel está abierto. Cada selección se revela una sola vez.
  useEffect(() => {
    if (selectedId === null) {
      revealedRef.current = null;
      return;
    }
    if (selectedId === revealedRef.current) return;
    const index = rows.findIndex((row) => row.kind === 'item' && row.id === selectedId);
    const el = listRef.current;
    if (index < 0 || el === null) return;
    revealedRef.current = selectedId;
    revealRow(el, layout, index, viewHeight);
    setScrollTop(el.scrollTop);
  }, [selectedId, rows, layout, viewHeight]);

  /**
   * Va a la anotación: su página en la posición del `rect`, y si es editable, la selecciona y abre su comentario.
   * Una respuesta lleva a la ventana de su comentario raíz.
   */
  function activate(row: ItemRow | ReplyRow): void {
    const id = row.kind === 'reply' ? threadRootId(effective, row.id) : row.id;
    const rect = effective.get(id)?.rect ?? foreign.get(id)?.rect;
    const { dims, rotation } = useViewer.getState();
    let yFraction = 0;
    if (rect !== undefined && dims !== null && row.pageIndex < dims.count) {
      const i = row.pageIndex;
      yFraction = rectTopFraction(rect, dims.width(i), dims.height(i), (dims.rotation(i) + rotation) % 360);
    }
    goToPage(row.pageIndex, { yFraction });
    if (row.kind === 'item' && row.readOnly) return;
    select(id);
    openPopupWhenPageCurrent(id, row.pageIndex);
  }

  /**
   * Borra una anotación (PDF-070) con sus respuestas y estados. La fila activa pasa a la fila de comentario o respuesta
   * más cercana que sobreviva; si no queda ninguna, no hay fila activa. El foco no se mueve.
   */
  function deleteRow(id: string): void {
    const gone = new Set([id, ...dependentIds(effective, id)]);
    const index = rows.findIndex((row) => row.kind !== 'page' && row.id === id);
    const nextId = nearestRowId(rows, index, gone);
    deleteAnnotation(id);
    setActiveId(nextId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      const row = rows[activeIndex];
      if (row !== undefined && row.kind === 'item' && !row.readOnly) deleteRow(row.id);
      return;
    }
    const step = keyStep(event.key);
    if (step === null && event.key !== 'Enter') return;
    // Las teclas de la lista no deben llegar a los atajos globales (Inicio, Fin, flechas de página).
    event.preventDefault();
    event.stopPropagation();
    if (step === null) {
      const row = rows[activeIndex];
      if (row !== undefined && row.kind !== 'page') activate(row);
      return;
    }
    const target = nextItemRow(rows, activeIndex, step);
    const row = target === null ? undefined : rows[target];
    if (target === null || row === undefined || row.kind === 'page') return;
    setActiveId(row.id);
    const el = listRef.current;
    if (el !== null) {
      revealRow(el, layout, target, viewHeight);
      setScrollTop(el.scrollTop);
    }
  }

  function onRowClick(row: ItemRow | ReplyRow): void {
    setActiveId(row.id);
    activate(row);
  }

  const filterEntries: MenuEntry[] = [
    ...types.map((label): MenuEntry => ({
      kind: 'checkbox',
      label,
      checked: filter.types.has(label),
      onSelect: () => {
        setFilter((f) => ({ ...f, types: toggleMember(f.types, label) }));
      },
    })),
    ...(types.length > 0 && authors.length > 0 ? (['separator'] as const) : []),
    {
      kind: 'radio',
      label: msg.commentsAllAuthors,
      checked: filter.author === null,
      onSelect: () => {
        setFilter((f) => ({ ...f, author: null }));
      },
    },
    ...authors.map((name): MenuEntry => ({
      kind: 'radio',
      label: name,
      checked: filter.author === name,
      onSelect: () => {
        setFilter((f) => ({ ...f, author: name }));
      },
    })),
    'separator',
    { kind: 'heading', label: commentsMsg.filterStates },
    ...FILTER_STATES.map((state): MenuEntry => ({
      kind: 'checkbox',
      label: REVIEW_STATE_LABELS[state],
      checked: filter.states.has(state),
      onSelect: () => {
        setFilter((f) => ({ ...f, states: toggleMember<ReviewState | 'none'>(f.states, state) }));
      },
    })),
    {
      kind: 'checkbox',
      label: commentsMsg.stateNone,
      checked: filter.states.has('none'),
      onSelect: () => {
        setFilter((f) => ({ ...f, states: toggleMember<ReviewState | 'none'>(f.states, 'none') }));
      },
    },
  ];

  const items: ReactElement[] = [];
  if (range !== null) {
    for (let i = range.first; i <= range.last; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      const top = layout.tops[i] ?? 0;
      const height = layout.heights[i] ?? 0;
      if (row.kind === 'page') {
        items.push(
          <div
            key={`page-${String(row.pageIndex)}`}
            role="presentation"
            className={styles.pageRow}
            style={{ top, height }}
          >
            <span>{msg.commentPage(row.pageIndex + 1)}</span>
            <span className={styles.pageCount}>{msg.commentsCount(row.count)}</span>
          </div>,
        );
        continue;
      }
      if (row.kind === 'reply') {
        const replyDate = formatDate(row.modified);
        items.push(
          <div
            key={row.id}
            id={rowDomId(i)}
            role="option"
            aria-selected={row.id === selectedId}
            className={row.id === selectedId ? `${styles.row} ${styles.replyRow} ${styles.rowSelected}` : `${styles.row} ${styles.replyRow}`}
            style={{ top, height }}
            onClick={() => {
              onRowClick(row);
            }}
          >
            <div className={styles.body}>
              <div className={styles.meta}>
                <span className={styles.name}>{commentsMsg.replyRowName(row.author)}</span>
                {' '}
                {replyDate !== null && <span className={styles.date}>{replyDate}</span>}
              </div>
              <p className={`${styles.excerpt} ${styles.replyExcerpt}`}>{row.excerpt}</p>
            </div>
          </div>,
        );
        continue;
      }
      const annotation: Annotation | undefined = effective.get(row.id);
      const date = row.modified === null ? null : formatDate(row.modified);
      items.push(
        <div
          key={row.id}
          id={rowDomId(i)}
          role="option"
          aria-selected={row.id === selectedId}
          className={row.id === selectedId ? `${styles.row} ${styles.rowSelected}` : styles.row}
          style={{ top, height }}
          onClick={() => {
            onRowClick(row);
          }}
        >
          <span
            className={styles.typeIcon}
            style={annotation === undefined ? undefined : { color: cssColor(annotation.color) }}
            aria-hidden="true"
          >
            <TypeIcon annotation={annotation} />
          </span>
          <div className={styles.body}>
            <div className={styles.meta}>
              <span className={styles.name}>
                {msg.annotationName(row.typeLabel, row.author)}
                <span className={styles.srOnly}>{msg.commentOptionPage(row.pageIndex + 1)}</span>
              </span>
              {/* Espacio de separación en el nombre accesible (en flex no se pinta). */}
              {' '}
              {date !== null && <span className={styles.date}>{date}</span>}
              {row.readOnly && <span className={styles.readOnly}>{msg.commentReadOnly}</span>}
              {row.state !== null && <span className={styles.state}>{REVIEW_STATE_LABELS[row.state]}</span>}
              {row.replyCount > 0 && <span className={styles.replies}>{commentsMsg.replyCount(row.replyCount)}</span>}
            </div>
            <p className={styles.excerpt}>{row.excerpt}</p>
          </div>
          {!row.readOnly && (
            // Icono decorativo (el borrado accesible es el botón de la barra o Supr): su clic borra y no navega.
            <span
              className={styles.rowActions}
              aria-hidden="true"
              title={msg.commentDelete}
              data-testid="comment-row-delete"
              onClick={(event) => {
                event.stopPropagation();
                deleteRow(row.id);
              }}
            >
              <IconTrash />
            </span>
          )}
        </div>,
      );
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <label className={styles.field}>
          <span>{msg.commentsAuthor}</span>
          <input
            key={author}
            type="text"
            className={styles.input}
            defaultValue={author}
            onBlur={(event) => {
              setAuthor(event.currentTarget.value);
            }}
          />
        </label>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.input}
            aria-label={msg.commentsSearch}
            placeholder={msg.commentsSearch}
            value={filter.text}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setFilter((f) => ({ ...f, text }));
            }}
          />
          <MenuButton label={msg.commentsFilter} entries={filterEntries} disabled={filterEntries.length === 0}>
            <span className={styles.filterLabel}>{msg.commentsFilter}</span>
          </MenuButton>
          <IconButton
            label={msg.commentDeleteActive}
            disabled={activeRow === undefined || activeRow.readOnly}
            onClick={() => {
              if (activeRow !== undefined) deleteRow(activeRow.id);
            }}
          >
            <IconTrash />
          </IconButton>
        </div>
        <p className={styles.count} aria-live="polite">
          {msg.commentsCount(itemCount)}
        </p>
      </div>

      {scan === 'scanning' && (
        <div className={styles.notice} role="status">
          <span>{msg.commentsScanning(scanProgress, numPages)}</span>
          {scanCancelable && (
            <button type="button" className={styles.textButton} onClick={cancelScanAll}>
              {msg.cancel}
            </button>
          )}
        </div>
      )}
      {scan === 'lazy' && (
        <div className={styles.notice}>
          <p>{msg.commentsLazyNotice}</p>
          <button type="button" className={styles.textButton} onClick={scanAllAnnotations}>
            {msg.commentsScanAll}
          </button>
        </div>
      )}
      {rows.length === 0 && (
        <p className={styles.empty}>
          {isFiltered(filter) ? msg.commentsNoMatches : scan === 'done' ? msg.commentsEmpty : null}
        </p>
      )}

      <div
        ref={listRef}
        role="listbox"
        aria-label={msg.commentsList}
        aria-activedescendant={activeIndex >= 0 ? rowDomId(activeIndex) : undefined}
        tabIndex={0}
        className={styles.list}
        data-testid="comments-list"
        onScroll={() => {
          const el = listRef.current;
          if (el !== null) setScrollTop(el.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        <div className={styles.spacer} style={{ height: layout.total }}>
          {items}
        </div>
      </div>
    </div>
  );
}

/** Paso de navegación de una tecla (↑ ↓ Inicio Fin), o `null` si no es de navegación. */
function keyStep(key: string): 'prev' | 'next' | 'first' | 'last' | null {
  switch (key) {
    case 'ArrowUp':
      return 'prev';
    case 'ArrowDown':
      return 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

function TypeIcon({ annotation }: { readonly annotation: Annotation | undefined }) {
  switch (annotation?.type) {
    case 'highlight':
      return <IconHighlight />;
    case 'underline':
      return <IconUnderline />;
    case 'strikeout':
      return <IconStrikeout />;
    case 'note':
      return <IconNote />;
    case 'freetext':
      return <IconFreeText />;
    case 'ink':
      return <IconInk />;
    default:
      return <IconComment />;
  }
}

function formatDate(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : DATE_FORMAT.format(time);
}
