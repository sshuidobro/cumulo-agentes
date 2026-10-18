import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import { flattenVisible, type OutlineNode, type VisibleRow } from '../../core/outline';
import { navigateToDest, runNamedAction } from '../../state/history';
import { showNotice } from '../../state/notice';
import { collapseAllOutline, expandAllOutline, toggleOutlineNode } from '../../state/outline-actions';
import { useViewer } from '../../state/viewer-store';
import { ConfirmExternalLink } from '../links/confirm-external';
import { msg } from '../messages';
import { useViewportSize } from '../viewer/use-viewport-size';
import styles from './OutlinePanel.module.css';

/** Alto fijo de cada fila del árbol, en px. La virtualización depende de él. */
export const OUTLINE_ROW_HEIGHT = 28;
/** Sangría de cada nivel, en px. */
const OUTLINE_INDENT = 16;
/** Filas que se montan por encima y por debajo de las visibles. */
const OUTLINE_OVERSCAN = 5;
/** Teclas que maneja el árbol (el resto pasa a los atajos globales). */
const TREE_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ']);

/** Id DOM de la fila de un marcador, para `aria-activedescendant`. */
export function outlineRowDomId(id: string): string {
  return `outline-${id}`;
}

/**
 * Pestaña «Marcadores» (PDF-016): índice del PDF como árbol accesible (patrón ARIA *tree view*). Mientras se lee
 * muestra un aviso; si el documento no tiene índice, lo dice.
 */
export function OutlinePanel(): ReactElement {
  const outline = useViewer((s) => s.outline);
  if (outline === null) {
    return (
      <p role="status" className={styles.message}>
        {msg.loadingBookmarks}
      </p>
    );
  }
  if (outline.length === 0) {
    return <p className={styles.message}>{msg.noBookmarks}</p>;
  }
  return <OutlineTree outline={outline} />;
}

interface OutlineTreeProps {
  readonly outline: readonly OutlineNode[];
}

/** Árbol virtualizado de marcadores. Solo monta las filas visibles (más un margen). */
function OutlineTree({ outline }: OutlineTreeProps) {
  const expanded = useViewer((s) => s.outlineExpanded);
  const rows = useMemo(() => flattenVisible(outline, expanded), [outline, expanded]);

  const ref = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(ref);
  // Posición de scroll del contenedor en px; de ella salen las filas que se montan.
  const [scrollTop, setScrollTop] = useState(0);
  // Marcador con el foco del teclado (`aria-activedescendant`). Si no es visible, cuenta la primera fila.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const focusedIndex = rows.findIndex((row) => row.node.id === focusId);
  const activeIndex = focusedIndex < 0 ? 0 : focusedIndex;
  const active: VisibleRow | undefined = rows[activeIndex];

  // Mantiene visible la fila con el foco al moverlo con el teclado; si ya se ve, no mueve el scroll.
  useEffect(() => {
    const el = ref.current;
    if (el === null || el.clientHeight <= 0) return;
    const top = activeIndex * OUTLINE_ROW_HEIGHT;
    const bottom = top + OUTLINE_ROW_HEIGHT;
    let target: number | null = null;
    if (top < el.scrollTop) target = top;
    else if (bottom > el.scrollTop + el.clientHeight) target = bottom - el.clientHeight;
    if (target === null) return;
    el.scrollTop = target;
    setScrollTop(target);
  }, [activeIndex]);

  const firstRow = Math.max(0, Math.floor(scrollTop / OUTLINE_ROW_HEIGHT) - OUTLINE_OVERSCAN);
  const lastRow = Math.min(
    rows.length - 1,
    Math.floor((scrollTop + viewport.height) / OUTLINE_ROW_HEIGHT) + OUTLINE_OVERSCAN,
  );

  const activate = (node: OutlineNode): void => {
    const { target } = node;
    switch (target.kind) {
      case 'internal':
        void navigateToDest(target.dest);
        break;
      case 'action':
        runNamedAction(target.action);
        break;
      case 'external':
        setPendingUrl(target.url);
        break;
      case 'blocked':
        showNotice(msg.linkBlocked);
        break;
    }
  };

  const moveTo = (index: number): void => {
    const row = rows[index];
    if (row !== undefined) setFocusId(row.node.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (active === undefined || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!TREE_KEYS.has(event.key)) return;
    // Las teclas del árbol no llegan a los atajos globales (flechas de página, Inicio, Fin).
    event.preventDefault();
    event.stopPropagation();
    const { node, parentId } = active;
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    switch (event.key) {
      case 'ArrowDown':
        moveTo(Math.min(activeIndex + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        moveTo(Math.max(activeIndex - 1, 0));
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      case 'ArrowRight':
        if (!hasChildren) break;
        // Cerrado: se despliega. Abierto: el primer hijo es la fila siguiente.
        if (isExpanded) moveTo(activeIndex + 1);
        else toggleOutlineNode(node.id);
        break;
      case 'ArrowLeft':
        if (isExpanded) toggleOutlineNode(node.id);
        else if (parentId !== null) setFocusId(parentId);
        break;
      case 'Enter':
      case ' ':
        activate(node);
        break;
    }
  };

  const items: ReactElement[] = [];
  for (let index = firstRow; index <= lastRow; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    const isActive = index === activeIndex;
    const { node, depth } = row;
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    const onChevronClick = (event: MouseEvent<HTMLSpanElement>): void => {
      // El chevrón solo despliega: no activa el marcador.
      event.stopPropagation();
      setFocusId(node.id);
      if (hasChildren) toggleOutlineNode(node.id);
    };
    items.push(
      <div
        key={node.id}
        id={outlineRowDomId(node.id)}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isActive}
        className={styles.row}
        style={{ top: index * OUTLINE_ROW_HEIGHT, paddingLeft: depth * OUTLINE_INDENT + 4 }}
        title={node.title}
        onClick={() => {
          setFocusId(node.id);
          activate(node);
        }}
      >
        <span className={styles.chevron} aria-hidden="true" onClick={onChevronClick}>
          {hasChildren ? '▸' : ''}
        </span>
        <span className={[styles.title, node.bold ? styles.bold : '', node.italic ? styles.italic : ''].join(' ')}>
          {node.title}
        </span>
      </div>,
    );
  }

  const activeInWindow = activeIndex >= firstRow && activeIndex <= lastRow;

  return (
    <>
      <div className={styles.toolbar}>
        <button type="button" className={styles.button} onClick={expandAllOutline}>
          {msg.expandAll}
        </button>
        <button type="button" className={styles.button} onClick={collapseAllOutline}>
          {msg.collapseAll}
        </button>
      </div>
      <div
        ref={ref}
        role="tree"
        aria-label={msg.bookmarks}
        aria-activedescendant={active !== undefined && activeInWindow ? outlineRowDomId(active.node.id) : undefined}
        tabIndex={0}
        className={styles.tree}
        onScroll={() => {
          if (ref.current !== null) setScrollTop(ref.current.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        <div className={styles.spacer} style={{ height: rows.length * OUTLINE_ROW_HEIGHT }}>
          {items}
        </div>
      </div>
      <ConfirmExternalLink
        url={pendingUrl}
        onClose={() => {
          setPendingUrl(null);
        }}
      />
    </>
  );
}
