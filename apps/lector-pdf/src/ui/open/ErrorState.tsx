import { pickAndOpen } from '../../state/document-actions';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import styles from './open.module.css';

/** Fallo al abrir: qué fichero era y por qué no se ha podido abrir. */
export function ErrorState() {
  const name = useViewer((s) => s.loadingName);
  const message = useViewer((s) => s.error?.message) ?? '';
  const title = name === null ? msg.openFailedGeneric : msg.openFailed(name);
  return (
    <div className={styles.state} role="alert">
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.hint}>{message}</p>
      <button type="button" className={styles.primary} onClick={() => void pickAndOpen()}>
        {msg.openAnother}
      </button>
    </div>
  );
}
