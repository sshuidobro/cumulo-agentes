import { lazy, Suspense, useEffect, type ChangeEvent } from 'react';
import { msg } from './messages';
import { useShortcuts } from './use-shortcuts';
import { useTheme } from './use-theme';
import { MainToolbar } from './toolbar/MainToolbar';
import { TabBar, TAB_PANEL_ID } from './tabs/TabBar';
import { DropOverlay } from './open/DropOverlay';
import { EmptyState } from './open/EmptyState';
import { ErrorState } from './open/ErrorState';
import { IoErrorBanner } from './open/IoErrorBanner';
import { LoadingState } from './open/LoadingState';
import { Viewer } from './viewer/Viewer';
import { SelectionActions } from './viewer/SelectionActions';
import { PrintContainer } from './print/PrintContainer';
import { PrintProgress } from './print/PrintProgress';
import { ExportProgress } from './export/ExportProgress';
import './print/print.css';
import { Notice } from './kit/Notice';
import { ChoiceDialog } from './kit/ChoiceDialog';
import { PasswordDialog } from './security/PasswordDialog';
import { SearchBar, focusSearchField } from './search/SearchBar';
import { ReadAloudBar } from './read-aloud/ReadAloudBar';
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
import { exitFullscreen, toggleFullscreen, useFullscreen, watchSystemFullscreen } from '../state/fullscreen-actions';
import { openProperties, usePropertiesDialog } from '../state/properties-store';
import { openPrintDialog, usePrintDialog } from '../state/print-actions';
import { useCompare } from '../state/compare-actions';
import { startReading, stopReading, togglePause, useReadAloud } from '../state/read-aloud-actions';
import { useExportDialog } from '../state/export-actions';
import { useOrganize } from '../state/organize-store';
import { organizeRedo, organizeUndo } from '../state/organize-actions';
import { useViewer } from '../state/viewer-store';
import { useTabs } from '../state/tabs';
import { closeActiveTab, stepTab } from '../state/tab-actions';
import { focusPageField } from './toolbar/PageNavigator';
import { selectPageText } from './viewer/text-selection';
import styles from './App.module.css';

// Diálogos diferidos (ADR-0027): su código no entra en el arranque y se carga al abrirlos.
const PropertiesDialog = lazy(() => import('./properties/PropertiesDialog').then((m) => ({ default: m.PropertiesDialog })));
const PrintDialog = lazy(() => import('./print/PrintDialog').then((m) => ({ default: m.PrintDialog })));
const ExportDialog = lazy(() => import('./export/ExportDialog').then((m) => ({ default: m.ExportDialog })));
// Barra de comentarios y panel lateral (PDF-140): no se muestran al arrancar, se cargan al abrirlos.
const CommentToolbar = lazy(() => import('./toolbar/CommentToolbar').then((m) => ({ default: m.CommentToolbar })));
const Sidebar = lazy(() => import('./sidebar/Sidebar').then((m) => ({ default: m.Sidebar })));
// Comparación de dos PDFs (PDF-112): la vista solo se carga al comparar.
const CompareView = lazy(() => import('./compare/CompareView').then((m) => ({ default: m.CompareView })));
// Organizar páginas (PDF-125): sustituye al visor mientras está abierta; se carga al abrirla.
const OrganizeView = lazy(() => import('./organize/OrganizeView').then((m) => ({ default: m.OrganizeView })));

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
  fullscreen: () => { toggleFullscreen(); },
  // Leer en voz alta (PDF-114). Pausa solo si hay lectura: si no, el atajo no se consume.
  'read-page': () => { void startReading('page'); },
  'read-to-end': () => { void startReading('document'); },
  'read-pause': () => {
    if (useReadAloud.getState().status === 'idle') return false;
    togglePause();
  },
  'read-stop': () => { stopReading(); },
} as const;

/** Atajos con la pantalla completa activa (PDF-097). Escape sale antes que «cancelar herramienta». */
const FULLSCREEN_SHORTCUTS = {
  'cancel-tool': () => { exitFullscreen(); },
  'fullscreen-next': () => { nextPage(); },
  'fullscreen-prev': () => { prevPage(); },
} as const;

/** Atajos de pestañas (PDF-095). Con una sola pestaña, Ctrl+W cierra el documento. Sin pestañas no se consumen. */
const TAB_SHORTCUTS = {
  'next-tab': () => { stepTab(1); },
  'prev-tab': () => { stepTab(-1); },
  'close-tab': () => {
    if (useTabs.getState().activeId === null) return false;
    void closeActiveTab();
  },
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
  const propertiesOpen = usePropertiesDialog((s) => s.open);
  const printOpen = usePrintDialog((s) => s.open);
  const exportOpen = useExportDialog((s) => s.open);
  const fullscreen = useFullscreen((s) => s.on);
  const compareStatus = useCompare((s) => s.status);
  const organizeOpen = useOrganize((s) => s.open);

  // Con «Organizar páginas» abierta, deshacer/rehacer son los de la vista y los atajos del visor no actúan
  // (la vista atiende sus propios atajos, PDF-125).
  // Escape solo se consume si hay una herramienta de anotación activa (o si estamos en pantalla completa).
  useShortcuts({
    open: () => void pickAndOpen(),
    ...(organizeOpen ? { undo: organizeUndo, redo: organizeRedo } : { undo, redo }),
    ...(fullscreen ? FULLSCREEN_SHORTCUTS : tool === 'none' ? {} : { 'cancel-tool': () => { setTool('none'); } }),
    ...(status === 'ready' && !organizeOpen ? VIEW_SHORTCUTS : {}),
    ...TAB_SHORTCUTS,
  });

  // Si el sistema sale de la pantalla completa (F11, SO), la vista vuelve a su estado anterior.
  useEffect(() => watchSystemFullscreen(), []);

  const onBrowserFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file !== undefined) openBrowserFile(file);
  };

  // En pantalla completa no se muestran barras ni panel: solo el visor (PDF-097).
  const chrome = !fullscreen;
  return (
    <div className={fullscreen ? `${styles.app} ${styles.appFullscreen}` : styles.app}>
      {chrome && <TabBar />}
      {chrome && <MainToolbar />}
      {chrome && status === 'ready' && commentBarOpen && (
        <Suspense fallback={null}>
          <CommentToolbar />
        </Suspense>
      )}
      <IoErrorBanner />
      <main id={TAB_PANEL_ID} className={status === 'ready' ? styles.mainReady : styles.main}>
        {status === 'empty' && <EmptyState />}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState />}
        {status === 'ready' && numPages !== null && (
          <>
            <div className={styles.srOnly} data-testid="document-ready">
              {msg.pageCount(numPages)}
            </div>
            {organizeOpen ? (
              <Suspense fallback={null}>
                <OrganizeView />
              </Suspense>
            ) : (
              <div className={styles.body}>
                {chrome && sidebar !== 'none' && (
                  <Suspense fallback={null}>
                    <Sidebar />
                  </Suspense>
                )}
                <Viewer />
              </div>
            )}
            <SelectionActions />
            <SearchBar />
            <ReadAloudBar />
          </>
        )}
      </main>
      <Notice notice={notice} onExpire={dismissNotice} />
      {compareStatus !== 'idle' && (
        <Suspense fallback={null}>
          <CompareView />
        </Suspense>
      )}
      <ChoiceDialog />
      <PasswordDialog />
      {propertiesOpen && (
        <Suspense fallback={null}>
          <PropertiesDialog />
        </Suspense>
      )}
      {printOpen && (
        <Suspense fallback={null}>
          <PrintDialog />
        </Suspense>
      )}
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
      <PrintProgress />
      <ExportProgress />
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
