import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement } from 'react';
import type { Rgb } from '../../core/annotations/model';
import { FONT_SIZES, INK_WIDTHS, PALETTE } from '../../core/annotations/palette';
import { setFontSize, setInkWidth, setTool, setToolColor } from '../../state/annotation-actions';
import { useAnnotations, type AnnotationTool, type ColorTool } from '../../state/annotation-store';
import { isMarkupTool, markupSelection } from '../../state/markup-actions';
import { IconColor, IconFontSize, IconFreeText, IconHighlight, IconInk, IconInkWidth, IconNote, IconStrikeout, IconUnderline } from '../icons';
import { IconButton } from '../kit/IconButton';
import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { msg } from '../messages';
import styles from './CommentToolbar.module.css';

interface ToolSpec {
  readonly tool: ColorTool;
  readonly label: string;
  readonly Icon: () => ReactElement;
}

/** Herramientas de anotación de la segunda fila, en orden. */
const TOOLS: readonly ToolSpec[] = [
  { tool: 'highlight', label: msg.toolHighlight, Icon: IconHighlight },
  { tool: 'underline', label: msg.toolUnderline, Icon: IconUnderline },
  { tool: 'strikeout', label: msg.toolStrikeout, Icon: IconStrikeout },
  { tool: 'note', label: msg.toolNote, Icon: IconNote },
  { tool: 'freetext', label: msg.toolFreeText, Icon: IconFreeText },
  { tool: 'ink', label: msg.toolInk, Icon: IconInk },
];

/** Controles con foco itinerante: las herramientas y los menús visibles. */
type ControlId = ColorTool | 'color' | 'width' | 'fontSize';

/** Controles que hay en la barra con esa herramienta activa, en orden de tabulación. */
function visibleControls(tool: AnnotationTool): ControlId[] {
  const list: ControlId[] = TOOLS.map((spec) => spec.tool);
  if (tool !== 'none') list.push('color');
  if (tool === 'ink') list.push('width');
  if (tool === 'freetext') list.push('fontSize');
  return list;
}

/**
 * Botón de herramienta. Con texto seleccionado, «Resaltar», «Subrayar» o «Tachar» marcan la selección y no cambian
 * la herramienta (PDF-032); sin selección, activan la herramienta o la desactivan si ya estaba activa.
 */
function onToolClick(id: ColorTool, tool: AnnotationTool): void {
  if (isMarkupTool(id)) {
    const sel = document.getSelection();
    if (sel !== null && !sel.isCollapsed && markupSelection(id, sel) > 0) return;
  }
  setTool(tool === id ? 'none' : id);
}

function sameRgb(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Color CSS de una muestra (componentes 0-1 → 0-255). */
function swatchOf([r, g, b]: Rgb): string {
  return `rgb(${String(Math.round(r * 255))} ${String(Math.round(g * 255))} ${String(Math.round(b * 255))})`;
}

function colorEntries(tool: AnnotationTool, colors: Readonly<Record<ColorTool, Rgb>>): readonly MenuEntry[] {
  if (tool === 'none') return [];
  return PALETTE.map((entry): MenuEntry => ({
    kind: 'radio',
    label: entry.label,
    checked: sameRgb(colors[tool], entry.rgb),
    swatch: swatchOf(entry.rgb),
    onSelect: () => { setToolColor(tool, entry.rgb); },
  }));
}

function widthEntries(inkWidth: (typeof INK_WIDTHS)[number]): readonly MenuEntry[] {
  return INK_WIDTHS.map((width): MenuEntry => ({
    kind: 'radio',
    label: msg.pointSize(width),
    checked: width === inkWidth,
    onSelect: () => { setInkWidth(width); },
  }));
}

function fontSizeEntries(fontSize: (typeof FONT_SIZES)[number]): readonly MenuEntry[] {
  return FONT_SIZES.map((size): MenuEntry => ({
    kind: 'radio',
    label: msg.pointSize(size),
    checked: size === fontSize,
    onSelect: () => { setFontSize(size); },
  }));
}

/**
 * Segunda fila de la barra principal, con «Comentar» activo: herramientas de anotación, color y, según la
 * herramienta, grosor o tamaño de letra. Foco itinerante: solo un control es alcanzable con Tab; → y ← (circular),
 * Inicio y Fin lo mueven.
 */
export function CommentToolbar() {
  const tool = useAnnotations((s) => s.tool);
  const colors = useAnnotations((s) => s.colors);
  const inkWidth = useAnnotations((s) => s.inkWidth);
  const fontSize = useAnnotations((s) => s.fontSize);
  const [activeIndex, setActiveIndex] = useState(0);
  const elements = useRef(new Map<ControlId, HTMLButtonElement>());

  const controls = visibleControls(tool);
  // Si el control activo ya no existe (p. ej. se oculta «Grosor»), el foco itinerante pasa al último.
  const current = Math.min(activeIndex, controls.length - 1);
  const tabIndexOf = (id: ControlId): number => (controls[current] === id ? 0 : -1);

  // Una referencia por control; el mapa se lee solo en manejadores de eventos, nunca al pintar.
  const register = useCallback(
    (id: ControlId) =>
      (node: HTMLButtonElement | null): void => {
        if (node === null) elements.current.delete(id);
        else elements.current.set(id, node);
      },
    [],
  );

  /** Posición del control en la lista visible, o -1 si el objetivo no es un control visible. */
  const indexOfTarget = (target: EventTarget): number => {
    for (const [id, node] of elements.current) {
      if (node === target) return controls.indexOf(id);
    }
    return -1;
  };

  const moveTo = (index: number): void => {
    const id = controls[index];
    if (id === undefined) return;
    setActiveIndex(index);
    elements.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Las teclas dentro de un menú abierto no son de la barra.
    const from = indexOfTarget(event.target);
    if (from === -1) return;
    const last = controls.length - 1;
    switch (event.key) {
      case 'ArrowRight':
        moveTo(from === last ? 0 : from + 1);
        break;
      case 'ArrowLeft':
        moveTo(from === 0 ? last : from - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(last);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Un control enfocado (por clic o por teclado) pasa a ser el de foco itinerante.
  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const index = indexOfTarget(event.target);
    if (index !== -1) setActiveIndex(index);
  };

  return (
    <div
      role="toolbar"
      aria-label={msg.commentToolbar}
      aria-orientation="horizontal"
      className={styles.toolbar}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {TOOLS.map(({ tool: id, label, Icon }) => (
        <IconButton
          key={id}
          label={label}
          pressed={tool === id}
          tabIndex={tabIndexOf(id)}
          ref={register(id)}
          onClick={() => { onToolClick(id, tool); }}
        >
          <Icon />
        </IconButton>
      ))}
      <MenuButton
        label={msg.color}
        disabled={tool === 'none'}
        tabIndex={tabIndexOf('color')}
        ref={register('color')}
        entries={colorEntries(tool, colors)}
      >
        <IconColor />
      </MenuButton>
      {tool === 'ink' && (
        <MenuButton
          label={msg.inkWidth}
          tabIndex={tabIndexOf('width')}
          ref={register('width')}
          entries={widthEntries(inkWidth)}
        >
          <IconInkWidth />
        </MenuButton>
      )}
      {tool === 'freetext' && (
        <MenuButton
          label={msg.fontSize}
          tabIndex={tabIndexOf('fontSize')}
          ref={register('fontSize')}
          entries={fontSizeEntries(fontSize)}
        >
          <IconFontSize />
        </MenuButton>
      )}
    </div>
  );
}
