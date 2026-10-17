import type { ChangeEvent } from 'react';
import { msg } from './messages';
import { useShortcuts } from './use-shortcuts';
import { MainToolbar } from './toolbar/MainToolbar';
import { DropOverlay } from './open/DropOverlay';
import { EmptyState } from './open/EmptyState';
import { ErrorState } from './open/ErrorState';
import { IoErrorBanner } from './open/IoErrorBanner';
import { LoadingState } from './open/LoadingState';
import { Viewer } from './viewer/Viewer';
import { redo, setTool, undo } from '../state/annotation-actions';
import { useAnnotations } from '../state/annotation-store';
import { openBrowserFile, pickAndOpen } from '../state/document-actions';
import { services } from '../state/services';
import { rotateView, setZoomMode, zoomIn, zoomOut } from '../state/view-actions';
import { useViewer } from '../state/viewer-store';
import styles from './App.module.css';

/** Atajos de vista: solo actúan con un documento abierto. */
const VIEW_SHORTCUTS = {
  'zoom-in': () => { zoomIn(); },
  'zoom-out': () => { zoomOut(); },
  'fit-page': () => { setZoomMode({ kind: 'fit-page' }); },
  'actual-size': () => { setZoomMode({ kind: 'custom', zoom: 1 }); },
  'fit-width': () => { setZoomMode({ kind: 'fit-width' }); },
  'rotate-right': () => { rotateView(1); },
  'rotate-left': () => { rotateView(-1); },
} as const;

export function App() {
  const { platform } = services();
  const status = useViewer((s) => s.status);
  const numPages = useViewer((s) => s.pdf?.numPages ?? null);
  const tool = useAnnotations((s) => s.tool);

  // Escape solo se consume si hay una herramienta de anotación activa.
  useShortcuts({
    open: () => void pickAndOpen(),
    undo,
    redo,
    ...(tool === 'none' ? {} : { 'cancel-tool': () => { setTool('none'); } }),
    ...(status === 'ready' ? VIEW_SHORTCUTS : {}),
  });

  const onBrowserFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file !== undefined) openBrowserFile(file);
  };

  return (
    <div className={styles.app}>
      <MainToolbar />
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
