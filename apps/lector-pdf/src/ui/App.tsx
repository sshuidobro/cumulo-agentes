import type { ChangeEvent } from 'react';
import { IconButton } from './kit/IconButton';
import { IconOpen } from './icons';
import { msg } from './messages';
import { formatOpenShortcut } from './shortcuts';
import { useShortcuts } from './use-shortcuts';
import { DropOverlay } from './open/DropOverlay';
import { EmptyState } from './open/EmptyState';
import { ErrorState } from './open/ErrorState';
import { IoErrorBanner } from './open/IoErrorBanner';
import { LoadingState } from './open/LoadingState';
import { Viewer } from './viewer/Viewer';
import { openBrowserFile, pickAndOpen } from '../state/document-actions';
import { services } from '../state/services';
import { useViewer } from '../state/viewer-store';
import styles from './App.module.css';

export function App() {
  const { platform } = services();
  const status = useViewer((s) => s.status);
  const numPages = useViewer((s) => s.pdf?.numPages ?? null);

  useShortcuts({ open: () => void pickAndOpen() });

  const onBrowserFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file !== undefined) openBrowserFile(file);
  };

  return (
    <div className={styles.app}>
      <header className={styles.toolbar} role="toolbar" aria-label={msg.toolbarLabel}>
        <IconButton
          label={msg.open}
          shortcut={formatOpenShortcut(platform.isMac)}
          onClick={() => void pickAndOpen()}
        >
          <IconOpen />
        </IconButton>
      </header>
      <IoErrorBanner />
      <main className={status === 'ready' ? styles.mainReady : styles.main}>
        {status === 'empty' && <EmptyState />}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState />}
        {status === 'ready' && numPages !== null && (
          <>
            <div className={styles.srOnly} data-testid="document-ready">
              {msg.pageCount(numPages)}
            </div>
            <Viewer />
          </>
        )}
      </main>
      {platform.kind === 'web' && (
        <>
          <input
            type="file"
            accept=".pdf,application/pdf"
            hidden
            data-testid="open-input"
            onChange={onBrowserFileChange}
          />
          <DropOverlay />
        </>
      )}
    </div>
  );
}
