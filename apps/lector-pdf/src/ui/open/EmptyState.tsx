import { pickAndOpen } from '../../state/document-actions';
import { useRecent } from '../../state/recent-actions';
import { openCombineDialog } from '../../state/combine-actions';
import { IMAGES_MENU_ITEM } from '../../state/images-dialog-store';
import { services } from '../../state/services';
import { formatOpenShortcut } from '../shortcuts';
import { msg } from '../messages';
import { tabsMsg } from '../messages-tabs';
import { organizeMsg } from '../messages-organize';
import { RecentList } from './RecentList';
import styles from './open.module.css';

/** Sin File System Access no se pueden guardar recientes que se puedan reabrir (PDF-049). */
function hasFileSystemAccess(): boolean {
  return typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}

/** Estado sin documento: invita a abrir uno y lista los recientes. */
export function EmptyState() {
  const { platform } = services();
  const shortcut = formatOpenShortcut(platform.isMac);
  const recent = useRecent((s) => s.list);
  const unsupported = platform.kind === 'web' && !hasFileSystemAccess();
  return (
    <>
      <h1 className={styles.title}>{msg.emptyTitle}</h1>
      <p className={styles.hint}>{msg.emptyHint}</p>
      <p className={styles.hint}>{msg.openShortcutHint(shortcut)}</p>
      <button type="button" className={styles.primary} onClick={() => void pickAndOpen()}>
        {msg.open}
      </button>
      <button type="button" className={styles.secondary} onClick={openCombineDialog}>
        {organizeMsg.combine}
      </button>
      <button type="button" className={styles.secondary} onClick={() => { void import('../../state/images-pdf-actions').then((a) => a.openImagesDialog()); }}>
        {IMAGES_MENU_ITEM}
      </button>
      {unsupported && <p className={styles.hint}>{tabsMsg.recentUnsupported}</p>}
      {!unsupported && recent.length > 0 && <RecentList entries={recent} />}
    </>
  );
}
