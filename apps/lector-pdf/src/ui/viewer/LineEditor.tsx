import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react';
import type { PageViewport } from '../../engine/pdfjs';
import { cancelLineEdit, commitLineEdit, validateLineText } from '../../state/edit-text-actions';
import { useEditText, type ActiveLineEdit } from '../../state/edit-text-store';
import { editTextMsg } from '../messages-edit-text';
import { baselineTop, fontCss, lineBoxGeometry } from './edit-text-box';
import styles from './LineEditor.module.css';

export interface LineEditorProps {
  /** Cuadro abierto (ver `ActiveLineEdit`). */
  readonly editing: ActiveLineEdit;
  /** Viewport de la página con el mismo zoom y rotación que su lienzo. */
  readonly viewport: PageViewport;
  /** Fondo opaco que tapa la línea original. */
  readonly paper: string;
  readonly pageIndex: number;
}

/**
 * Cuadro de escritura sobre la línea que se corrige (PDF-147): un `input` del tamaño de la línea, con su letra y su
 * fondo. Enter o perder el foco confirma; Escape cancela. Con un texto no válido, Enter no cierra y el error se muestra
 * bajo el cuadro.
 */
export function LineEditor({ editing, viewport, paper, pageIndex }: LineEditorProps) {
  const edit = useEditText((s) => (editing.editId === null ? undefined : s.edits.find((e) => e.id === editing.editId)));
  const [text, setText] = useState(() => edit?.text ?? editing.original);
  const inputRef = useRef<HTMLInputElement>(null);

  // Al abrir, el foco va al texto y se selecciona para sustituirlo al escribir.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const error = validateLineText(text);
  const geometry = lineBoxGeometry(editing.line, viewport.transform);
  const font = fontCss(editing.line.style.font);
  const boxStyle: CSSProperties = {
    width: `${String(geometry.width)}px`,
    height: `${String(geometry.height)}px`,
    transform: `matrix(${geometry.matrix.join(', ')})`,
  };
  const inputStyle: CSSProperties = {
    width: `${String(geometry.textWidth(text.length))}px`,
    height: `${String(geometry.height)}px`,
    top: `${String(baselineTop(geometry))}px`,
    fontSize: `${String(geometry.fontSize)}px`,
    background: paper,
    color: 'inherit',
    ...font,
  };

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    setText(event.currentTarget.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (error === null) commitLineEdit(text);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelLineEdit();
    }
  }

  return (
    <div className={styles.box} style={boxStyle}>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        style={inputStyle}
        aria-label={editTextMsg.editorLabel(pageIndex + 1)}
        aria-invalid={error === null ? undefined : true}
        value={text}
        spellCheck={false}
        autoComplete="off"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => {
          commitLineEdit(text);
        }}
      />
      {error !== null && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
