import { useEffect, useState } from 'react';
import { createLogger } from '@suite/shared';
import { useAnnotations } from '../../state/annotation-store';
import { useViewer } from '../../state/viewer-store';
import { markupSelection, type MarkupType } from '../../state/markup-actions';
import { markSelection } from '../../state/redact-actions';
import { setTool } from '../../state/annotation-actions';
import { normalizeUnicode } from '../../engine/text';
import { IconCopy, IconHighlight, IconRedact, IconStrikeout, IconUnderline } from '../icons';
import { IconButton } from '../kit/IconButton';
import { msg } from '../messages';
import { redactMsg } from '../messages-redact';
import { securityMsg } from '../messages-security';
import { selectionPageRects } from './selection-to-pages';
import styles from './SelectionActions.module.css';

const log = createLogger('viewer');

/** Separación entre el texto seleccionado y la barra, en píxeles. */
const GAP_PX = 8;
/** Alto y ancho aproximados de la barra (5 botones), en píxeles; sirven para colocarla dentro de la ventana. */
const BAR_HEIGHT_PX = 40;
const BAR_WIDTH_PX = 200;

interface Placement {
  readonly top: number;
  readonly left: number;
}

/** Último fragmento visible de la selección, en orden de documento: ahí se ancla la barra. */
function lastVisibleRect(sel: Selection): DOMRect | null {
  for (let i = sel.rangeCount - 1; i >= 0; i--) {
    const rects = Array.from(sel.getRangeAt(i).getClientRects());
    for (let j = rects.length - 1; j >= 0; j--) {
      const rect = rects[j];
      if (rect !== undefined && rect.width > 0 && rect.height > 0) return rect;
    }
  }
  return null;
}

/**
 * Dónde poner la barra: bajo el último fragmento de la selección y, si no cabe, por encima. `null` si no hay
 * texto seleccionado de ninguna capa, o si el fragmento ha salido de la ventana.
 */
function placementFor(sel: Selection | null): Placement | null {
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null;
  if (selectionPageRects(sel).size === 0) return null;
  const rect = lastVisibleRect(sel);
  if (rect === null || rect.bottom < 0 || rect.top > window.innerHeight) return null;

  const below = rect.bottom + GAP_PX;
  const top = below + BAR_HEIGHT_PX <= window.innerHeight ? below : Math.max(0, rect.top - GAP_PX - BAR_HEIGHT_PX);
  const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - BAR_WIDTH_PX));
  return { top, left };
}

/** Escribe el texto de la selección en el portapapeles con la misma normalización que copiar desde la capa. */
function copySelection(): void {
  const sel = document.getSelection();
  if (sel === null) return;
  const text = normalizeUnicode(sel.toString()).replace(/\0/g, '');
  navigator.clipboard.writeText(text).catch((cause: unknown) => {
    log.warn('no se ha podido copiar la selección', cause);
  });
}

/**
 * Barra flotante junto al texto seleccionado (PDF-032): resaltar, subrayar, tachar o copiar. Solo aparece sin
 * herramienta de anotación activa. No toma el foco al aparecer; Esc, desplazar o vaciar la selección la quitan.
 */
export function SelectionActions() {
  const tool = useAnnotations((s) => s.tool);
  const copyAllowed = useViewer((s) => s.permissions.copy);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    let frame: number | null = null;
    const update = (): void => {
      frame = null;
      setPlacement(placementFor(document.getSelection()));
    };
    const onSelectionChange = (): void => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const hide = (): void => {
      setPlacement(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, { capture: true });
    };
  }, []);

  if (placement === null || tool !== 'none') return null;

  const mark = (type: MarkupType): void => {
    const sel = document.getSelection();
    if (sel !== null) markupSelection(type, sel);
    setPlacement(null);
  };

  return (
    <div
      role="toolbar"
      aria-label={msg.selectionActions}
      className={styles.bar}
      style={{ top: placement.top, left: placement.left }}
      // Pulsar un botón no debe quitar la selección ni llevar el foco a la barra.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <IconButton label={msg.toolHighlight} onClick={() => { mark('highlight'); }}>
        <IconHighlight />
      </IconButton>
      <IconButton label={msg.toolUnderline} onClick={() => { mark('underline'); }}>
        <IconUnderline />
      </IconButton>
      <IconButton label={msg.toolStrikeout} onClick={() => { mark('strikeout'); }}>
        <IconStrikeout />
      </IconButton>
      <IconButton
        label={msg.copy}
        disabled={!copyAllowed}
        {...(copyAllowed ? {} : { description: securityMsg.copyBlocked })}
        onClick={copySelection}
      >
        <IconCopy />
      </IconButton>
      <IconButton
        label={redactMsg.tool}
        onClick={() => {
          // Marca el texto y pasa a «Redactar» (la barra se oculta sola con la herramienta activa).
          markSelection();
          setPlacement(null);
          setTool('redact');
        }}
      >
        <IconRedact />
      </IconButton>
    </div>
  );
}
