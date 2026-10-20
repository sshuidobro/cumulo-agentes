import { Dialog } from '../kit/Dialog';
import { exportMsg } from '../messages-export';
import { cancelExport, useExportJob } from '../../state/export-actions';
import styles from './ExportDialog.module.css';

/** Progreso de la exportación, con Cancelar (PDF-113). Solo se ve mientras se exporta. */
export function ExportProgress() {
  const job = useExportJob((s) => s.job);
  const running = job.status === 'running';
  const done = job.status === 'running' ? job.done : 0;
  const total = job.status === 'running' ? job.total : 0;

  return (
    <Dialog
      open={running}
      title={exportMsg.progressTitle}
      onClose={cancelExport}
      actions={[{ label: exportMsg.cancel, onClick: cancelExport }]}
    >
      <progress className={styles.progress} max={total} value={done} aria-label={exportMsg.progressLabel} />
      <p className={styles.count}>{exportMsg.progress(Math.min(done + 1, total), total)}</p>
    </Dialog>
  );
}
