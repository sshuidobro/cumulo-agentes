import { saveTextEdits } from '../../state/edit-text-actions';
import { useEditText } from '../../state/edit-text-store';
import { editTextMsg } from '../messages-edit-text';
import styles from './EditTextBar.module.css';

/**
 * Parte de «Editar texto» de la barra «Editar» (PDF-147): cuántas líneas hay editadas y «Guardar», que pide
 * confirmación. Solo aparece con ediciones pendientes. Los botones son nativos: se alcanzan con Tab.
 */
export function EditTextBar() {
  const count = useEditText((s) => s.edits.length);
  if (count === 0) return null;
  return (
    <div role="group" aria-label={editTextMsg.tool} className={styles.bar}>
      <span role="status" className={styles.count}>
        {editTextMsg.edited(count)}
      </span>
      <button
        type="button"
        className={styles.save}
        onClick={() => {
          void saveTextEdits();
        }}
      >
        {editTextMsg.save}
      </button>
    </div>
  );
}
