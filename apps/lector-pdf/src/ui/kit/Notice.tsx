import { useEffect } from 'react';
import type { NoticeItem } from '../../state/viewer-store';
import styles from './Notice.module.css';

/** Tiempo que permanece visible un aviso, en ms. */
export const NOTICE_MS = 4000;

export interface NoticeProps {
  /** Aviso visible, o null. */
  readonly notice: NoticeItem | null;
  /** Llamado cuando el aviso caduca, con su `id`. */
  readonly onExpire: (id: number) => void;
}

/** Aviso temporal (`role="status"`) que desaparece a los 4 s. Un aviso nuevo reinicia el tiempo. */
export function Notice({ notice, onExpire }: NoticeProps) {
  const id = notice?.id;
  useEffect(() => {
    if (id === undefined) return undefined;
    const timer = setTimeout(() => { onExpire(id); }, NOTICE_MS);
    return () => { clearTimeout(timer); };
  }, [id, onExpire]);

  if (notice === null) return null;
  return (
    <div role="status" className={styles.notice}>
      {notice.text}
    </div>
  );
}
