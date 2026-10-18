import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { FREETEXT_MARGIN_PT, fitFreeTextRect } from '../../core/annotations/freetext';
import type { PageViewport } from '../../engine/pdfjs';
import { commitFreeText } from '../../state/annotation-actions';
import type { FreeTextEditing } from '../../state/annotation-store';
import { msg } from '../messages';
import { cssColor } from './annotation-geometry';
import { freeTextBox } from './freetext-box';
import styles from './FreeTextEditor.module.css';

/** Marcador del visor (región con foco): Esc devuelve el foco aquí. */
const VIEWER_REGION = '[role="region"]';

export interface FreeTextEditorProps {
  /** Cuadro en edición (ver `FreeTextEditing`). */
  readonly editing: FreeTextEditing;
  /** Viewport de la página con el mismo zoom y rotación que su lienzo. */
  readonly viewport: PageViewport;
}

/**
 * Editor en el sitio de un texto libre (PDF-034): un `textarea` sobre el cuadro de la página, con la misma fuente,
 * tamaño, color, márgenes y giro que el dibujo. Confirma al perder el foco o con Esc. Mientras escribe, el cuadro
 * crece hacia abajo si el texto no cabe. Solo se guarda al confirmar (una única entrada de deshacer).
 */
export function FreeTextEditor({ editing, viewport }: FreeTextEditorProps) {
  const { base, floor } = editing;
  const [text, setText] = useState(base.contents);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Al abrir, el foco va al texto con el cursor al final, para seguir escribiendo.
  useEffect(() => {
    const area = areaRef.current;
    if (area === null) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  // Se calcula en cada render: el cuadro crece con el texto y no pasa del borde inferior de la página.
  const rect = fitFreeTextRect(base.rect, text, base.fontSize, floor);
  const box = freeTextBox(rect, viewport.transform);
  const style: CSSProperties = {
    width: `${String(box.width)}px`,
    height: `${String(box.height)}px`,
    transform: `matrix(${box.matrix.join(', ')})`,
    fontSize: `${String(base.fontSize * box.scale)}px`,
    padding: `${String(FREETEXT_MARGIN_PT * box.scale)}px`,
    color: cssColor(base.textColor),
    borderColor: cssColor(base.color),
  };

  function onChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setText(event.currentTarget.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Las teclas del texto son del texto: no llegan al desplazamiento del visor ni a los atajos.
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const area = event.currentTarget;
    commitFreeText(area.value);
    area.closest<HTMLElement>(VIEWER_REGION)?.focus();
  }

  return (
    <textarea
      ref={areaRef}
      className={styles.editor}
      style={style}
      aria-label={msg.freeTextBox}
      spellCheck={false}
      value={text}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        commitFreeText(event.currentTarget.value);
      }}
    />
  );
}
