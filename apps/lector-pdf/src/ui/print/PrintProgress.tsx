import { Dialog } from '../kit/Dialog';
import { printMsg } from '../messages-print';
import { cancelPrint, usePrintJob } from '../../state/print-actions';
import styles from './PrintDialog.module.css';

/** Progreso de la preparación de las páginas, con Cancelar (PDF-044). Solo se ve mientras se preparan. */
export function PrintProgress() {
  const job = usePrintJob((s) => s.job);
  const preparing = job.status === 'preparing';
  const done = job.status === 'preparing' ? job.done : 0;
  const total = job.status === 'preparing' ? job.total : 0;

  return (
    <Dialog
      open={preparing}
      title={printMsg.preparingTitle}
      onClose={cancelPrint}
      actions={[{ label: printMsg.cancel, onClick: cancelPrint }]}
    >
      <progress className={styles.progress} max={total} value={done} aria-label={printMsg.progressLabel} />
      <p className={styles.count}>{printMsg.preparing(Math.min(done + 1, total), total)}</p>
    </Dialog>
  );
}
