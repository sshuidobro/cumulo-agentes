import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { NIGHT_PAGE_COLORS } from '../../core/night';
import type { PageViewport } from '../../engine/pdfjs';
import { beginLineEdit, removeLineEdit } from '../../state/edit-text-actions';
import { useEditText, type LineEditDraft } from '../../state/edit-text-store';
import { editTextMsg } from '../messages-edit-text';
import { cssColor } from './annotation-geometry';
import { baselineTop, centerOf, fontCss, lineBoxGeometry } from './edit-text-box';
import { LineEditor } from './LineEditor';
import styles from './EditTextLayer.module.css';

/** Fondo de papel de una página sin modo noche. */
const PAPER = '#fff';

export interface EditTextLayerProps {
  readonly pageIndex: number;
  /** Viewport de la página con el mismo zoom y rotación que su lienzo. */
  readonly viewport: PageViewport;
  /** Modo noche: el papel de la página es el oscuro del lienzo. */
  readonly night: boolean;
}

/** Fondo opaco que tapa la línea original: el mismo papel que el lienzo. */
export function paperColor(night: boolean): string {
  return night ? NIGHT_PAGE_COLORS.background : PAPER;
}

/**
 * Capa de «Editar texto» sobre una página (PDF-147): con la herramienta activa, un doble clic abre el cuadro de la línea
 * bajo el puntero; las ediciones de la página se muestran encima de su línea original, y el cuadro abierto sustituye
 * a la edición que corrige.
 */
export function EditTextLayer({ pageIndex, viewport, night }: EditTextLayerProps) {
  const active = useEditText((s) => s.active);
  const status = useEditText((s) => s.status);
  const edits = useEditText((s) => s.edits);
  const editing = useEditText((s) => s.editing);

  const here = edits.filter((edit) => edit.pageIndex === pageIndex);
  const editingHere = editing !== null && editing.pageIndex === pageIndex ? editing : null;
  if (!active && here.length === 0 && editingHere === null) return null;

  const paper = paperColor(night);
  const shown = here.filter((edit) => edit.id !== editingHere?.editId);

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!active) return;
    const box = event.currentTarget.getBoundingClientRect();
    const [x = 0, y = 0] = viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top);
    void beginLineEdit(pageIndex, [x, y]);
  };

  const layerClass = [styles.layer, active ? styles.active : '', status === 'probing' ? styles.wait : '']
    .filter((name) => name !== '')
    .join(' ');

  return (
    <div className={layerClass} onDoubleClick={onDoubleClick}>
      {shown.map((edit) => (
        <EditBox key={edit.id} edit={edit} pageIndex={pageIndex} viewport={viewport} paper={paper} />
      ))}
      {editingHere !== null && (
        <LineEditor
          key={`${String(editingHere.pageIndex)}:${editingHere.editId ?? 'new'}:${editingHere.line.origin.join(',')}`}
          editing={editingHere}
          viewport={viewport}
          paper={paper}
          pageIndex={pageIndex}
        />
      )}
    </div>
  );
}

interface EditBoxProps {
  readonly edit: LineEditDraft;
  readonly pageIndex: number;
  readonly viewport: PageViewport;
  readonly paper: string;
}

/** Una línea editada: rectángulo opaco sobre la línea original y el texto nuevo en su línea base. */
function EditBox({ edit, pageIndex, viewport, paper }: EditBoxProps) {
  const geometry = lineBoxGeometry(edit.line, viewport.transform);
  const font = fontCss(edit.line.style.font);
  const boxStyle: CSSProperties = {
    width: `${String(geometry.width)}px`,
    height: `${String(geometry.height)}px`,
    transform: `matrix(${geometry.matrix.join(', ')})`,
    background: paper,
  };
  const textStyle: CSSProperties = {
    top: `${String(baselineTop(geometry))}px`,
    fontSize: `${String(geometry.fontSize)}px`,
    color: cssColor(edit.line.style.color),
    ...font,
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void beginLineEdit(pageIndex, centerOf(edit.line.bounds));
    } else if (event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      removeLineEdit(edit.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={editTextMsg.editBoxLabel(pageIndex + 1, edit.text)}
      className={styles.box}
      style={boxStyle}
      onDoubleClick={(event) => {
        event.stopPropagation();
        void beginLineEdit(pageIndex, centerOf(edit.line.bounds));
      }}
      onKeyDown={onKeyDown}
    >
      <span className={styles.text} style={textStyle}>
        {edit.text}
      </span>
    </div>
  );
}
