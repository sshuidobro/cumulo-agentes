import { useId, useState } from 'react';
import type { RecentFile } from '@suite/platform';
import { folderOf, formatRecentDate } from '../../core/recent';
import { forgetRecent, openRecentFile } from '../../state/recent-actions';
import { tabsMsg } from '../messages-tabs';
import styles from './open.module.css';

/** Sección «Recientes» de la pantalla de inicio (PDF-049): nombre, carpeta, fecha y las entradas que ya no existen. */
export function RecentList({ entries }: { readonly entries: readonly RecentFile[] }) {
  const headingId = useId();
  // Hora de la vista: fija al mostrarse la lista (las fechas relativas no necesitan reloj en vivo).
  const [now] = useState(() => Date.now());
  return (
    <section className={styles.recent} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.recentTitle}>{tabsMsg.recentTitle}</h2>
      <ul className={styles.recentList}>
        {entries.map((entry) => (
          <li key={entry.id} className={entry.available ? styles.recentItem : styles.recentItemMissing}>
            <button
              type="button"
              className={styles.recentName}
              disabled={!entry.available}
              onClick={() => { void openRecentFile(entry.id); }}
            >
              {entry.name}
            </button>
            <span className={styles.recentMeta}>
              {entry.path !== null && <span className={styles.recentFolder}>{folderOf(entry.path)}</span>}
              <time dateTime={new Date(entry.openedAt).toISOString()}>{formatRecentDate(entry.openedAt, now)}</time>
            </span>
            {!entry.available && (
              <>
                <span className={styles.recentMissing}>{tabsMsg.recentUnavailable}</span>
                <button
                  type="button"
                  className={styles.recentRemove}
                  onClick={() => { void forgetRecent(entry.id); }}
                >
                  {tabsMsg.recentRemove}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
