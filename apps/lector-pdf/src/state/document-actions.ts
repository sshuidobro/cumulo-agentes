import { createLogger, type AppError, type Result } from '@suite/shared';
import { platformError, type FileFilter, type OpenedFile } from '@suite/platform';
import { initialExpanded } from '../core/outline';
import { getOutline } from '../engine/outline';
import { loadPdf, readPageDims, readPermissions, scanPageDims, type LoadedPdf, type PageDimsEntry } from '../engine';
import { permissionsFrom } from '../core/permissions';
import type { ReadingPosition } from '../core/reading-positions';
import { pdfError } from '../core/errors';
import { PageDimsTable } from '../core/page-dims';
import { normalizeRotation } from '../core/rotation';
import { windowTitle } from '../core/title';
import { tabsMsg } from '../ui/messages-tabs';
import { endAnnotationSession, startAnnotationSession } from './annotation-actions';
import { endFormSession, startFormSession } from './form-actions';
import { goToPage } from './navigation';
import { askPassword, cancelPassword } from './password-prompt';
import { expectRestore, flushPosition } from './position-sync';
import { showNotice } from './notice';
import { sidebarForOpenedDocument } from './sidebar-actions';
import { services } from './services';
import { activateTab, beginNewTab, closeTab, findTab, registerTabParticipant, useTabs, type TabParticipant } from './tabs';
import { initialViewerState, useViewer, type ViewerState } from './viewer-store';
import { hasUnsavedChanges } from './unsaved-guard';

const log = createLogger('document-actions');

/** Por encima de este número de páginas no se escanean las dimensiones en segundo plano. */
const SCAN_PAGE_LIMIT = 20_000;

export const PDF_FILTERS: readonly FileFilter[] = [{ name: 'Documentos PDF', extensions: ['pdf'] }];

/** Documento abierto y los recursos que dependen de él. */
interface Session {
  readonly file: OpenedFile;
  readonly pdf: LoadedPdf;
  readonly stopListening: () => void;
  readonly scan: AbortController;
  /** Contraseña con la que se abrió (solo en memoria). Null si el documento no la necesita. */
  readonly password: string | null;
}

let session: Session | null = null;
/** Número de la última apertura: solo la más reciente puede tocar el store al terminar. */
let openSeq = 0;
/** Cancelación de la apertura más reciente. */
let opening: AbortController | null = null;

/** Saca la sesión actual del estado del módulo; el llamante es responsable de liberarla. */
function takeSession(): Session | null {
  const current = session;
  session = null;
  return current;
}

async function closeOpened(file: OpenedFile): Promise<void> {
  try {
    await services().platform.closeFile(file);
  } catch (cause) {
    log.warn('closeFile', cause);
  }
}

/** Detiene el escaneo, se da de baja de los avisos, libera el documento y cierra el fichero. */
async function releaseDocument(current: Session | null): Promise<void> {
  if (current === null) return;
  current.scan.abort();
  current.stopListening();
  await current.pdf.destroy();
  await closeOpened(current.file);
}

/** Libera lo que depende de un documento que se cierra o reemplaza: anotaciones, formularios y el documento. */
async function releaseSession(current: Session | null): Promise<void> {
  endAnnotationSession();
  endFormSession();
  await releaseDocument(current);
}

/** Invalida las aperturas en curso y devuelve la sesión que hay que liberar. */
function beginReplacement(): Session | null {
  flushPosition();
  openSeq += 1;
  opening?.abort();
  opening = null;
  cancelPassword();
  return takeSession();
}

/** Señal de aborto del escaneo del documento activo, o null sin documento (las anotaciones la usan al reanudar, PDF-101). */
export function currentScanSignal(): AbortSignal | null {
  return session?.scan.signal ?? null;
}

/** Contraseña con la que se abrió el documento actual, o null. Solo vive en memoria mientras está abierto. */
export function currentPassword(): string | null {
  return session?.password ?? null;
}

function isPasswordError(code: string): boolean {
  return code === 'password-required' || code === 'password-incorrect';
}

function showError(error: AppError, name: string | null): void {
  useViewer.setState({ ...initialViewerState, viewMode: useViewer.getState().viewMode, status: 'error', error, loadingName: name });
  services().platform.setTitle(windowTitle(null, false));
}

/** Escanea en segundo plano las dimensiones de las páginas desde la 1. Por encima del límite no escanea. */
function startPageScan(loaded: LoadedPdf, scan: AbortController): void {
  if (loaded.numPages > SCAN_PAGE_LIMIT) return;
  scanPageDims(loaded.doc, {
    from: 1,
    signal: scan.signal,
    onBatch: (entries) => {
      if (scan.signal.aborted) return;
      for (const entry of entries) reportPageDims(entry);
    },
  }).catch((cause: unknown) => {
    log.warn('scanPageDims', cause);
  });
}

/** Lo que hace falta para volver a mostrar un documento suspendido: su sesión y el estado del visor. */
interface DocumentSnapshot {
  readonly session: Session | null;
  readonly viewer: ViewerState;
}

/**
 * Participante de pestañas del documento (orden 0). Suspender cancela la apertura en curso o detiene el escaneo y
 * libera la caché del documento; reanudar restaura el visor y vuelve a escanear desde la página 1.
 */
const documentParticipant: TabParticipant<DocumentSnapshot> = {
  id: 'document',
  order: 0,
  suspend(): DocumentSnapshot {
    flushPosition();
    const viewer = useViewer.getState();
    const loading = opening !== null;
    openSeq += 1;
    opening?.abort();
    opening = null;
    cancelPassword();
    const current = takeSession();
    if (current !== null) {
      current.scan.abort();
      current.pdf.doc.cleanup().catch((cause: unknown) => {
        log.warn('cleanup', cause);
      });
    }
    useViewer.setState({ ...initialViewerState, viewMode: viewer.viewMode, dimsVersion: viewer.dimsVersion });
    return { session: current, viewer: loading ? initialViewerState : viewer };
  },
  resume(snapshot: DocumentSnapshot): void {
    const current = useViewer.getState();
    if (snapshot.session !== null) session = { ...snapshot.session, scan: new AbortController() };
    // El modo de vista es una preferencia global: se conserva el actual, no el de la instantánea.
    useViewer.setState({ ...snapshot.viewer, viewMode: current.viewMode, dimsVersion: current.dimsVersion + 1 });
    const active = session;
    if (active === null) return;
    services().platform.setTitle(windowTitle(active.file.name, hasUnsavedChanges()));
    startPageScan(active.pdf, active.scan);
    goToPage(snapshot.viewer.currentPage, { yFraction: snapshot.viewer.currentYFraction });
  },
  async dispose(snapshot: DocumentSnapshot): Promise<void> {
    await releaseDocument(snapshot.session);
  },
};

/** Da de alta el participante del documento en el registro de pestañas. Llamar una vez al arrancar. */
export function registerDocumentParticipant(): void {
  registerTabParticipant(documentParticipant);
}

/**
 * Abre un documento. Si ya hay otro abierto, lo cierra; si llega otra apertura antes de terminar, esta se descarta.
 * `restore`: posición a aplicar en lugar de la recordada (PDF-037, tras guardar).
 * `password`: contraseña que se prueba primero (tras guardar). Si falta o no sirve, se pide con un diálogo (PDF-046).
 */
export function openDocument(file: OpenedFile, opts?: { readonly restore?: ReadingPosition; readonly password?: string }): Promise<void> {
  return runOpen(file, opts, false);
}

/**
 * Carga el fichero en la pestaña activa. `dedupe`: tras cargar, si otra pestaña tiene el mismo documento (mismo
 * `fingerprint`; el tamaño no está en `TabInfo`), esa pestaña se activa y la carga se descarta. La pestaña de la carga
 * queda en estado `loading`, así que `activateTab` la elimina al salir (también si se reutilizó una vacía o con error).
 */
async function runOpen(
  file: OpenedFile,
  opts: { readonly restore?: ReadingPosition; readonly password?: string } | undefined,
  dedupe: boolean,
): Promise<void> {
  const { assetBaseUrl, platform } = services();
  flushPosition();
  const seq = ++openSeq;
  const controller = new AbortController();
  opening = controller;
  void releaseSession(takeSession());
  // Si había una apertura esperando la contraseña, esta la reemplaza: su bucle ve que ya no es la más reciente.
  cancelPassword();

  useViewer.setState({ ...initialViewerState, viewMode: useViewer.getState().viewMode, status: 'loading', loadingName: file.name, dimsVersion: useViewer.getState().dimsVersion });

  const onProgress = (loaded: number, total: number): void => {
    if (seq !== openSeq) return;
    useViewer.setState({ loadProgress: total > 0 ? Math.min(1, loaded / total) : null });
  };
  let password: string | undefined = opts?.password;
  let result = await loadPdf(file.source, {
    assetBaseUrl,
    signal: controller.signal,
    onProgress,
    ...(password === undefined ? {} : { password }),
  });

  while (!result.ok && isPasswordError(result.error.code)) {
    const entered = await askPassword(file.name, result.error.code === 'password-incorrect');
    if (seq !== openSeq) {
      // Otra apertura o cierre ha tomado el relevo mientras se pedía la contraseña.
      await closeOpened(file);
      return;
    }
    if (entered === null) {
      // Cancelado por el usuario: estado vacío, sin mensaje de error (igual que cancelar una apertura).
      if (opening === controller) opening = null;
      useViewer.setState({ ...initialViewerState, viewMode: useViewer.getState().viewMode, dimsVersion: useViewer.getState().dimsVersion });
      await closeOpened(file);
      return;
    }
    password = entered;
    result = await loadPdf(file.source, { assetBaseUrl, signal: controller.signal, onProgress, password });
  }

  if (seq !== openSeq) {
    // Una apertura posterior ha tomado el relevo: este resultado se descarta sin tocar el store.
    if (result.ok) await result.value.destroy();
    await closeOpened(file);
    return;
  }
  if (opening === controller) opening = null;

  if (!result.ok) {
    if (result.error.code === 'cancelled') {
      useViewer.setState({ ...initialViewerState, viewMode: useViewer.getState().viewMode, dimsVersion: useViewer.getState().dimsVersion });
    } else {
      showError(result.error, file.name);
    }
    await closeOpened(file);
    return;
  }

  const loaded = result.value;
  // Tabla supuesta: todas las páginas con el tamaño de la primera; el escaneo corrige las diferentes.
  let dims: PageDimsTable | null = null;
  let firstError: unknown = null;
  try {
    const first = await readPageDims(await loaded.doc.getPage(1));
    const rotation = normalizeRotation(first.rotation);
    dims = PageDimsTable.uniform(loaded.numPages, first.width, first.height, rotation);
    dims.set(0, first.width, first.height, rotation);
  } catch (cause) {
    firstError = cause;
  }

  const pageMode = await readPageMode(loaded);
  const permissions = permissionsFrom(await readPermissions(loaded.doc));

  if (seq !== openSeq) {
    await loaded.destroy();
    await closeOpened(file);
    return;
  }
  if (dims === null) {
    await loaded.destroy();
    showError(pdfError('corrupt', firstError), file.name);
    await closeOpened(file);
    return;
  }

  if (dedupe) {
    const { tabs, activeId } = useTabs.getState();
    const twin = tabs.find((t) => t.id !== activeId && t.fingerprint === loaded.fingerprint) ?? null;
    if (twin !== null) {
      // Ya está abierto en otra pestaña: se descarta esta carga y se muestra la existente.
      await loaded.destroy();
      await closeOpened(file);
      activateTab(twin.id);
      showNotice(tabsMsg.alreadyOpen(file.name));
      return;
    }
  }

  const scan = new AbortController();
  const stopListening = loaded.onIoError((error) => {
    if (session?.pdf === loaded) useViewer.setState({ ioError: error });
  });
  session = { file, pdf: loaded, stopListening, scan, password: password ?? null };

  expectRestore(opts?.restore ?? null);
  useViewer.setState({
    ...initialViewerState, viewMode: useViewer.getState().viewMode,
    status: 'ready',
    file,
    pdf: loaded,
    dims,
    dimsVersion: useViewer.getState().dimsVersion + 1,
    sidebar: sidebarForOpenedDocument(pageMode),
    permissions,
  });
  platform.setTitle(windowTitle(file.name, false));
  startAnnotationSession(loaded, scan.signal, file.source);
  startFormSession(loaded);
  loadPageLabels(loaded);
  loadOutline(loaded);
  startPageScan(loaded, scan);
}

/** Cancela la apertura en curso (si la hay). El store vuelve a estado vacío. */
export function cancelOpening(): void {
  cancelPassword();
  opening?.abort();
}

/** Cierra el documento abierto (y cancela una apertura en curso). */
export async function closeDocument(): Promise<void> {
  const current = beginReplacement();
  useViewer.setState({ ...initialViewerState, viewMode: useViewer.getState().viewMode, dimsVersion: useViewer.getState().dimsVersion });
  services().platform.setTitle(windowTitle(null, false));
  await releaseSession(current);
}

/**
 * Abre un fichero que pide el usuario («Abrir», arrastrar, «Abrir con»). Si ya está abierto en una pestaña, se muestra
 * esa. Si la pestaña activa está vacía o en error, se abre en ella; si no, en una pestaña nueva. Los cambios sin
 * guardar del documento anterior se quedan en su pestaña: no se pregunta.
 */
export async function openRequested(file: OpenedFile): Promise<void> {
  if (file.path !== null) {
    const existing = findTab({ path: file.path });
    if (existing !== null) {
      activateTab(existing.id);
      await closeOpened(file);
      showNotice(tabsMsg.alreadyOpen(file.name));
      return;
    }
  }

  const previous = useTabs.getState().activeId;
  const { status } = useViewer.getState();
  const reuse = previous !== null && (status === 'empty' || status === 'error');
  if (!reuse && !beginNewTab(file.name, file.path)) {
    await closeOpened(file);
    return;
  }
  const tabId = useTabs.getState().activeId;

  await runOpen(file, undefined, true);

  // Apertura cancelada (también la contraseña) en una pestaña nueva: la pestaña se cierra y se vuelve a la anterior.
  const cancelled = useViewer.getState().status === 'empty';
  if (!reuse && cancelled && tabId !== null && useTabs.getState().activeId === tabId) {
    if (previous !== null) activateTab(previous);
    await closeTab(tabId);
  }
}

/** Muestra el selector de ficheros del SO y abre el elegido. */
export async function pickAndOpen(): Promise<void> {
  const result = await services().platform.openFile(PDF_FILTERS);
  if (!result.ok) {
    await failReplacing(result.error);
    return;
  }
  if (result.value === null) return;
  await openRequested(result.value);
}

/** Abre el primer fichero soltado sobre la ventana (web). */
export async function openDropped(dt: DataTransfer): Promise<void> {
  let result: Result<OpenedFile | null>;
  try {
    result = await services().platform.openDropped(dt);
  } catch (cause) {
    // Una excepción de la plataforma no debe quedar como promesa rechazada sin tratar: se muestra como error.
    log.warn('openDropped', cause);
    await failReplacing(platformError('io', cause));
    return;
  }
  if (!result.ok) {
    await failReplacing(result.error);
    return;
  }
  if (result.value === null) return;
  await openRequested(result.value);
}

/** Abre un `File` de un `<input type=file>` (web). */
export function openBrowserFile(file: File): void {
  const result = services().platform.openBrowserFile(file);
  if (!result.ok) {
    void failReplacing(result.error);
    return;
  }
  void openRequested(result.value);
}

/** Lee las etiquetas de página en segundo plano: no bloquea la apertura. Si falla o no hay, quedan en null. */
function loadPageLabels(loaded: LoadedPdf): void {
  void readPageLabels(loaded).then((labels) => {
    if (useViewer.getState().pdf === loaded) useViewer.setState({ pageLabels: labels });
  });
}

/** Lee el índice (marcadores) en segundo plano (PDF-016): no bloquea la apertura. Nunca lanza. */
function loadOutline(loaded: LoadedPdf): void {
  void getOutline(loaded.doc).then((nodes) => {
    if (useViewer.getState().pdf !== loaded) return;
    useViewer.setState({ outline: nodes, outlineExpanded: initialExpanded(nodes) });
  });
}

/** Modo de página del PDF (`/PageMode`, p. ej. «UseThumbs»), o null si no tiene o no se puede leer. Nunca lanza. */
async function readPageMode(loaded: LoadedPdf): Promise<string | null> {
  try {
    const mode: unknown = await loaded.doc.getPageMode();
    return typeof mode === 'string' ? mode : null;
  } catch (cause) {
    log.warn('getPageMode', cause);
    return null;
  }
}

async function readPageLabels(loaded: LoadedPdf): Promise<readonly string[] | null> {
  try {
    return (await loaded.doc.getPageLabels()) ?? null;
  } catch (cause) {
    log.warn('getPageLabels', cause);
    return null;
  }
}

/** Entrega dimensiones de una página al store: las guarda y, si cambian, sube `dimsVersion`. */
export function reportPageDims(entry: PageDimsEntry): void {
  const { dims } = useViewer.getState();
  if (dims === null) return;
  const changed = dims.set(entry.index, entry.width, entry.height, normalizeRotation(entry.rotation));
  if (changed) useViewer.setState({ dimsVersion: useViewer.getState().dimsVersion + 1 });
}

/** Un fallo al obtener el fichero sustituye al documento actual por el mensaje de error. */
async function failReplacing(error: AppError): Promise<void> {
  const current = beginReplacement();
  showError(error, null);
  await releaseSession(current);
}
