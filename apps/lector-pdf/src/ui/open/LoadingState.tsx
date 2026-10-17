import { cancelOpening } from '../../state/document-actions';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import styles from './open.module.css';

/** Estado de carga: nombre del fichero, progreso si se conoce y botón para cancelar. */
export function LoadingState() {
  const name = useViewer((s) => s.loadingName) ?? '';
  const progress = useViewer((s) => s.loadProgress);
  return (
    <div className={styles.state} role="status">
      <p className={styles.title}>{msg.opening(name)}</p>
      <progress className={styles.progress} aria-label={msg.loadProgress} max={1} value={progress ?? undefined} />
      <button type="button" onClick={cancelOpening}>
        {msg.cancel}
      </button>
    </div>
  );
}
