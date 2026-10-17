import { pickAndOpen } from '../../state/document-actions';
import { services } from '../../state/services';
import { formatOpenShortcut } from '../shortcuts';
import { msg } from '../messages';
import styles from './open.module.css';

/** Estado sin documento: invita a abrir uno. */
export function EmptyState() {
  const shortcut = formatOpenShortcut(services().platform.isMac);
  return (
    <>
      <h1 className={styles.title}>{msg.emptyTitle}</h1>
      <p className={styles.hint}>{msg.emptyHint}</p>
      <p className={styles.hint}>{msg.openShortcutHint(shortcut)}</p>
      <button type="button" className={styles.primary} onClick={() => void pickAndOpen()}>
        {msg.open}
      </button>
    </>
  );
}
