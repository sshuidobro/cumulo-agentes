import { applyRedactions, markSearchResults, markSelection, redactRedo, redactUndo } from '../../state/redact-actions';
import { useRedact } from '../../state/redact-store';
import { useSearch } from '../../state/search-store';
import { IconButton } from '../kit/IconButton';
import { IconRedo, IconUndo } from '../icons';
import { msg } from '../messages';
import { redactMsg } from '../messages-redact';
import styles from './RedactBar.module.css';

/**
 * Controles de «Redactar» dentro de la barra «Editar» (PDF-137): marcar el texto seleccionado o los resultados de
 * la búsqueda, deshacer y rehacer marcas, y aplicar. Los botones son nativos: se alcanzan con Tab.
 */
export function RedactBar() {
  const count = useRedact((s) => s.marks.length);
  const canUndo = useRedact((s) => s.undo.canUndo);
  const canRedo = useRedact((s) => s.undo.canRedo);
  const matches = useSearch((s) => s.total);

  return (
    <div role="group" aria-label={redactMsg.tool} className={styles.bar}>
      <IconButton label={msg.undo} disabled={!canUndo} onClick={redactUndo}>
        <IconUndo />
      </IconButton>
      <IconButton label={msg.redo} disabled={!canRedo} onClick={redactRedo}>
        <IconRedo />
      </IconButton>
      <button type="button" className={styles.button} onClick={markSelection}>
        {redactMsg.markSelection}
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={matches === 0}
        onClick={() => {
          void markSearchResults();
        }}
      >
        {redactMsg.markSearch}
      </button>
      <button
        type="button"
        className={styles.apply}
        disabled={count === 0}
        onClick={() => {
          void applyRedactions();
        }}
      >
        {redactMsg.apply(count)}
      </button>
    </div>
  );
}
