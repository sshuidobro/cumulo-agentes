import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement } from 'react';
import type { Rgb } from '../../core/annotations/model';
import { FONT_SIZES, INK_WIDTHS, PALETTE } from '../../core/annotations/palette';
import {
  addNoteFromKeyboard,
  getEffective,
  setFreeTextColor,
  setFreeTextFontSize,
  setInkColor,
  setInkWidth,
  setTool,
  setToolColor,
} from '../../state/annotation-actions';
import { useAnnotations, type AnnotationTool, type ColorTool } from '../../state/annotation-store';
import { addShapeFromKeyboard, chooseStamp, isShapeTool, setShapeColor, setShapeWidth } from '../../state/shape-actions';
import { STAMP_LABELS, STAMP_NAMES, type StampName } from '../../core/annotations/shapes';
import { isMarkupTool, markupSelection } from '../../state/markup-actions';
import {
  IconArrow,
  IconCircle,
  IconColor,
  IconFontSize,
  IconFreeText,
  IconHighlight,
  IconInk,
  IconInkWidth,
  IconLine,
  IconNote,
  IconPolygon,
  IconSquare,
  IconStamp,
  IconStrikeout,
  IconUnderline,
} from '../icons';
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
  { tool: 'square', label: msg.toolSquare, Icon: IconSquare },
  { tool: 'circle', label: msg.toolCircle, Icon: IconCircle },
  { tool: 'line', label: msg.toolLine, Icon: IconLine },
  { tool: 'arrow', label: msg.toolArrow, Icon: IconArrow },
  { tool: 'polygon', label: msg.toolPolygon, Icon: IconPolygon },
];

/** Controles con foco itinerante: las herramientas y los menús visibles. */
type ControlId = ColorTool | 'stamp' | 'color' | 'width' | 'fontSize';

/**
 * Lo que hay seleccionado y admite «Color», «Grosor» o «Tamaño de letra» aunque la herramienta activa sea otra. `shape`:
 * el color de la forma seleccionada (rectángulo, elipse, línea, flecha o polígono), o `null`.
 */
interface Selection {
  readonly text: boolean;
  readonly ink: boolean;
  readonly shape: Rgb | null;
}

/** Destino de «Color»: una herramienta de color, o la forma seleccionada (PDF-108). */
export type ColorTarget = ColorTool | 'shape';
/** Destino de «Grosor»: el dibujo a mano alzada (PDF-035) o las formas (PDF-108). */
type WidthTarget = 'ink' | 'shape';

/**
 * Controles que hay en la barra con esa herramienta activa, en orden de tabulación. «Color» y «Tamaño de letra» también
 * aparecen con un texto libre seleccionado (PDF-034); «Color» y «Grosor», con un dibujo seleccionado (PDF-035) o una
 * forma (PDF-108).
 */
function visibleControls(tool: AnnotationTool, selection: Selection): ControlId[] {
  const list: ControlId[] = TOOLS.map((spec) => spec.tool);
  list.push('stamp');
  if (tool !== 'none' || selection.text || selection.ink || selection.shape !== null) list.push('color');
  if (widthTargetOf(tool, selection) !== null) list.push('width');
  if (tool === 'freetext' || selection.text) list.push('fontSize');
  return list;
}

/**
 * Herramienta a la que se aplica «Color»: el texto libre, el dibujo o la forma seleccionados (PDF-034, PDF-035, PDF-108)
 * o, si no, la herramienta activa. `null` si no hay ninguna.
 */
function colorTargetOf(tool: AnnotationTool, selection: Selection): ColorTarget | null {
  if (selection.text) return 'freetext';
  if (selection.ink) return 'ink';
  if (selection.shape !== null) return 'shape';
  return tool === 'none' || tool === 'signature' || tool === 'stamp' || tool === 'page-image' || tool === 'redact' ? null : tool;
}

/** A qué afecta «Grosor»: el dibujo o la forma seleccionados, o la herramienta activa. `null` si ninguna aplica. */
function widthTargetOf(tool: AnnotationTool, selection: Selection): WidthTarget | null {
  if (selection.ink || (selection.shape === null && tool === 'ink')) return 'ink';
  if (selection.shape !== null || isShapeTool(tool) || tool === 'polygon') return 'shape';
  return null;
}

/**
 * Botón de herramienta. Con texto seleccionado, «Resaltar», «Subrayar» o «Tachar» marcan la selección y no cambian
 * la herramienta (PDF-032); sin selección, activan la herramienta o la desactivan si ya estaba activa.
 * «Nota» activada con teclado o lector de pantalla (`fromKeyboard`) crea la nota en la página actual (PDF-072), salvo
 * que la herramienta «Nota» ya estuviera activa: entonces se desactiva como con el ratón.
 */
function onToolClick(id: ColorTool, tool: AnnotationTool, fromKeyboard: boolean): void {
  if (id === 'note' && fromKeyboard && tool !== 'note') {
    addNoteFromKeyboard();
    return;
  }
  // Una forma activada con teclado (PDF-108) se crea en la página actual, como la nota; también el polígono (PDF-115).
  if ((isShapeTool(id) || id === 'polygon') && fromKeyboard && tool !== id) {
    addShapeFromKeyboard(id);
    return;
  }
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

export function colorEntries(
  target: ColorTarget | null,
  colors: Readonly<Record<ColorTool, Rgb>>,
  shapeColor: Rgb | null,
): readonly MenuEntry[] {
  if (target === null) return [];
  const current = target === 'shape' ? (shapeColor ?? colors.square) : colors[target];
  return PALETTE.map((entry): MenuEntry => ({
    kind: 'radio',
    label: entry.label,
    checked: sameRgb(current, entry.rgb),
    swatch: swatchOf(entry.rgb),
    onSelect: () => { applyColor(target, entry.rgb); },
  }));
}

/**
 * El color de «Texto» llega también al texto libre seleccionado (PDF-034), el de «Dibujar», al dibujo seleccionado
 * (PDF-035) y «Color» con una forma seleccionada, a esa forma (PDF-108); el resto de herramientas, solo a su herramienta.
 */
export function applyColor(target: ColorTarget, rgb: Rgb): void {
  if (target === 'freetext') setFreeTextColor(rgb);
  else if (target === 'ink') setInkColor(rgb);
  else if (target === 'shape') setShapeColor(rgb);
  else setToolColor(target, rgb);
}

/**
 * Entradas del menú «Sello» (PDF-115): los catorce sellos, en el orden de `STAMP_NAMES`, con el elegido marcado. Elegir
 * una la activa; con Intro (`fromKeyboard`) además se coloca en la página actual, como las formas con teclado.
 */
function stampEntries(pending: StampName): readonly MenuEntry[] {
  const heading: MenuEntry = { kind: 'heading', label: msg.stampMenu };
  const items = STAMP_NAMES.map((name): MenuEntry => ({
    kind: 'radio',
    label: STAMP_LABELS[name],
    checked: name === pending,
    onSelect: (fromKeyboard) => {
      chooseStamp(name);
      if (fromKeyboard) addShapeFromKeyboard('stamp');
    },
  }));
  return [heading, ...items];
}

function widthEntries(target: WidthTarget, inkWidth: (typeof INK_WIDTHS)[number], shapeWidth: (typeof INK_WIDTHS)[number]): readonly MenuEntry[] {
  const current = target === 'ink' ? inkWidth : shapeWidth;
  return INK_WIDTHS.map((width): MenuEntry => ({
    kind: 'radio',
    label: msg.pointSize(width),
    checked: width === current,
    onSelect: () => { if (target === 'ink') setInkWidth(width); else setShapeWidth(width); },
  }));
}

export function fontSizeEntries(fontSize: (typeof FONT_SIZES)[number]): readonly MenuEntry[] {
  return FONT_SIZES.map((size): MenuEntry => ({
    kind: 'radio',
    label: msg.pointSize(size),
    checked: size === fontSize,
    onSelect: () => { setFreeTextFontSize(size); },
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
  // Un texto libre o un dibujo seleccionados reciben sus controles (PDF-034, PDF-035). Booleanos: no re-renderizan al teclear.
  const textSelected = useAnnotations((s) => {
    const id = s.selectedId;
    return id !== null && getEffective().get(id)?.type === 'freetext';
  });
  const inkSelected = useAnnotations((s) => {
    const id = s.selectedId;
    return id !== null && getEffective().get(id)?.type === 'ink';
  });
  // Color de la forma seleccionada (PDF-108); `null` si no hay ninguna. La referencia cambia solo al cambiar el color.
  const shapeColor = useAnnotations((s) => {
    const id = s.selectedId;
    if (id === null) return null;
    const a = getEffective().get(id);
    switch (a?.type) {
      case 'square':
      case 'circle':
      case 'line':
      case 'polygon':
        return a.color;
      default:
        return null;
    }
  });
  const shapeWidth = useAnnotations((s) => s.shapeWidth);
  const pendingStamp = useAnnotations((s) => s.pendingStamp);
  const selection: Selection = { text: textSelected, ink: inkSelected, shape: shapeColor };
  const colorTarget = colorTargetOf(tool, selection);
  const widthTarget = widthTargetOf(tool, selection);
  const [activeIndex, setActiveIndex] = useState(0);
  const elements = useRef(new Map<ControlId, HTMLButtonElement>());

  const controls = visibleControls(tool, selection);
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

  /**
   * Mueve el foco itinerante con → ← Inicio Fin. Las teclas tratadas no llegan a los atajos globales de la ventana
   * (p. ej. las flechas, que pasan de página); las demás teclas siguen su curso.
   */
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
    event.stopPropagation();
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
          {...(id === 'note' ? { description: msg.toolNoteKeyboardHint } : {})}
          pressed={tool === id}
          tabIndex={tabIndexOf(id)}
          ref={register(id)}
          onClick={(event) => {
            // `detail` es 0 cuando la activación llega del teclado o de un lector de pantalla (PDF-072).
            onToolClick(id, tool, event.detail === 0);
          }}
        >
          <Icon />
        </IconButton>
      ))}
      <MenuButton
        label={msg.toolStamp}
        tabIndex={tabIndexOf('stamp')}
        ref={register('stamp')}
        entries={stampEntries(pendingStamp)}
      >
        <IconStamp />
      </MenuButton>
      <MenuButton
        label={msg.color}
        disabled={colorTarget === null}
        tabIndex={tabIndexOf('color')}
        ref={register('color')}
        entries={colorEntries(colorTarget, colors, shapeColor)}
      >
        <IconColor />
      </MenuButton>
      {widthTarget !== null && (
        <MenuButton
          label={msg.inkWidth}
          tabIndex={tabIndexOf('width')}
          ref={register('width')}
          entries={widthEntries(widthTarget, inkWidth, shapeWidth)}
        >
          <IconInkWidth />
        </MenuButton>
      )}
      {tool === 'polygon' && (
        <p className={styles.hint} aria-live="polite">
          {msg.polygonHint}
        </p>
      )}
      {(tool === 'freetext' || textSelected) && (
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
