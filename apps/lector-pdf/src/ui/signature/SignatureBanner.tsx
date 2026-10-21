import { useSignatures } from '../../state/digital-signature-actions';
import { showSidebarTab } from '../../state/sidebar-actions';
import { useViewer } from '../../state/viewer-store';
import { digitalSignMsg } from '../messages-digital-signature';
import styles from './SignatureBanner.module.css';

/** Aviso al abrir un PDF firmado (PDF-139). Con alguna firma no válida, en rojo. */
export function SignatureBanner() {
  const ready = useViewer((s) => s.status === 'ready');
  const list = useSignatures((s) => s.list);
  if (!ready || list.length === 0) return null;
  const invalid = list.some((item) => item.verdict === 'invalid');
  return (
    <div className={invalid ? `${styles.banner} ${styles.invalid}` : styles.banner} role="status">
      <p className={styles.text}>{invalid ? digitalSignMsg.bannerInvalid : digitalSignMsg.bannerSigned}</p>
      <button type="button" className={styles.button} onClick={() => { showSidebarTab('signatures'); }}>
        {digitalSignMsg.viewSignatures}
      </button>
    </div>
  );
}
