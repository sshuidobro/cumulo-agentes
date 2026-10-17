import { closeDocument } from '../../state/document-actions';
import { useViewer } from '../../state/viewer-store';
import { msg } from '../messages';
import styles from './open.module.css';

/** Error de lectura con el documento ya abierto (p. ej. el fichero desaparece del disco). */
export function IoErrorBanner() {
  const ioError = useViewer((s) => s.ioError);
  if (ioError === null) return null;
  return (
    <div className={styles.banner} role="alert">
      <p className={styles.bannerText}>{ioError.message}</p>
      <button type="button" onClick={() => void closeDocument()}>
        {msg.closeDocument}
      </button>
    </div>
  );
}
