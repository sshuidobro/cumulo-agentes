import type { ChangeEvent } from 'react';
import { msg } from './messages';
import { useShortcuts } from './use-shortcuts';
import { useTheme } from './use-theme';
import { MainToolbar } from './toolbar/MainToolbar';
import { CommentToolbar } from './toolbar/CommentToolbar';
import { DropOverlay } from './open/DropOverlay';
import { EmptyState } from './open/EmptyState';
import { ErrorState } from './open/ErrorState';
import { IoErrorBanner } from './open/IoErrorBanner';
import { LoadingState } from './open/LoadingState';
import { Viewer } from './viewer/Viewer';
import { SelectionActions } from './viewer/SelectionActions';
import { Notice } from './kit/Notice';
import { ChoiceDialog } from './kit/ChoiceDialog';
import { PropertiesDialog } from './properties/PropertiesDialog';
import { PrintContainer } from './print/PrintContainer';
import { PrintDialog } from './print/PrintDialog';
import { PrintProgress } from './print/PrintProgress';
import './print/print.css';
import { Sidebar } from './sidebar/Sidebar';
import { SearchBar, focusSearchField } from './search/SearchBar';
import { toggleSidebar } from '../state/sidebar-actions';
import { nextMatch, openSearch, prevMatch } from '../state/search-actions';
import { useSearch } from '../state/search-store';
import { redo, setTool, undo } from '../state/annotation-actions';
import { save, saveAs } from '../state/save-actions';
import { useAnnotations } from '../state/annotation-store';
import { openBrowserFile, pickAndOpen } from '../state/document-actions';
import { services } from '../state/services';
import { firstPage, lastPage, nextPage, prevPage } from '../state/navigation';
import { goBack, goForward } from '../state/history';
import { dismissNotice } from '../state/notice';
import { rotateView, setViewTool, setZoomMode, zoomIn, zoomOut } from '../state/view-actions';
import { openProperties } from '../state/properties-store';
import { openPrintDialog } from '../state/print-actions';
import { useViewer } from '../state/viewer-store';
import { focusPageField } from './toolbar/PageNavigator';
import { selectPageText } from './viewer/text-selection';
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
  'tool-select': () => { setViewTool('select'); },
  'tool-hand': () => { setViewTool('hand'); },
  'select-all': () => { selectPageText(useViewer.getState().currentPage); },
  back: () => { goBack(); },
  forward: () => { goForward(); },
  'first-page': () => { firstPage(); },
  'last-page': () => { lastPage(); },
  'go-to-page': () => { focusPageField(); },
  // Las flechas izquierda/derecha solo pasan de página si no hay scroll horizontal; si lo hay, lo hace el navegador.
  'next-page': (event: globalThis.KeyboardEvent) => {
    if (event.key === 'ArrowRight' && useViewer.getState().hasHorizontalOverflow) return false;
    nextPage();
  },
  'prev-page': (event: globalThis.KeyboardEvent) => {
    if (event.key === 'ArrowLeft' && useViewer.getState().hasHorizontalOverflow) return false;
    prevPage();
  },
  'toggle-sidebar': () => { toggleSidebar(); },
  // Ctrl+F abre la barra, o enfoca su campo si ya está abierta. F3 y Mayús+F3 recorren las coincidencias.
  find: () => {
    if (useSearch.getState().open) focusSearchField();
    else openSearch();
  },
  'find-next': () => { nextMatch(); },
  'find-prev': () => { prevMatch(); },
  // Antes de guardar se confirma el editor activo (p. ej. una nota escrita), para que su texto entre en el guardado.
  save: () => { blurActiveElement(); void save(); },
  'save-as': () => { blurActiveElement(); void saveAs(); },
  properties: () => { openProperties(); },
  print: () => { openPrintDialog(); },
} as const;

function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export function App() {
  const { platform } = services();
  useTheme();
  const status = useViewer((s) => s.status);
  const numPages = useViewer((s) => s.pdf?.numPages ?? null);
  const tool = useAnnotations((s) => s.tool);
  const commentBarOpen = useAnnotations((s) => s.commentBarOpen);
  const notice = useViewer((s) => s.notice);
  const sidebar = useViewer((s) => s.sidebar);

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
      {status === 'ready' && commentBarOpen && <CommentToolbar />}
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
            <div className={styles.body}>
              {sidebar !== 'none' && <Sidebar />}
              <Viewer />
            </div>
            <SelectionActions />
            <SearchBar />
          </>
        )}
      </main>
      <Notice notice={notice} onExpire={dismissNotice} />
      <ChoiceDialog />
      <PropertiesDialog />
      <PrintDialog />
      <PrintProgress />
      <PrintContainer />
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
