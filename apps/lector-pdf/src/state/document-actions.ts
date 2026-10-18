import { createLogger, type AppError, type Result } from '@suite/shared';
import { platformError, type FileFilter, type OpenedFile } from '@suite/platform';
import { initialExpanded } from '../core/outline';
import { getOutline } from '../engine/outline';
import { loadPdf, readPageDims, scanPageDims, type LoadedPdf, type PageDimsEntry } from '../engine';
import type { ReadingPosition } from '../core/reading-positions';
import { pdfError } from '../core/errors';
import { PageDimsTable } from '../core/page-dims';
import { normalizeRotation } from '../core/rotation';
import { windowTitle } from '../core/title';
import { endAnnotationSession, startAnnotationSession } from './annotation-actions';
import { endFormSession, startFormSession } from './form-actions';
import { expectRestore, flushPosition } from './position-sync';
import { sidebarForOpenedDocument } from './sidebar-actions';
import { services } from './services';
import { initialViewerState, useViewer } from './viewer-store';
import { confirmDiscardOrSave, hasUnsavedChanges } from './unsaved-guard';

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
async function releaseSession(current: Session | null): Promise<void> {
  endAnnotationSession();
  endFormSession();
  if (current === null) return;
  current.scan.abort();
  current.stopListening();
  await current.pdf.destroy();
  await closeOpened(current.file);
}

/** Invalida las aperturas en curso y devuelve la sesión que hay que liberar. */
function beginReplacement(): Session | null {
  flushPosition();
  openSeq += 1;
  opening?.abort();
  opening = null;
  return takeSession();
}

function showError(error: AppError, name: string | null): void {
  useViewer.setState({ ...initialViewerState, status: 'error', error, loadingName: name });
  services().platform.setTitle(windowTitle(null, false));
}

/**
 * Abre un documento. Si ya hay otro abierto, lo cierra; si llega otra apertura antes de terminar, esta se descarta.
 * `restore`: posición a aplicar en lugar de la recordada (PDF-037, tras guardar).
 */
export async function openDocument(file: OpenedFile, opts?: { readonly restore?: ReadingPosition }): Promise<void> {
  const { assetBaseUrl, platform } = services();
  flushPosition();
  const seq = ++openSeq;
  const controller = new AbortController();
  opening = controller;
  void releaseSession(takeSession());

  useViewer.setState({ ...initialViewerState, status: 'loading', loadingName: file.name, dimsVersion: useViewer.getState().dimsVersion });

  const result = await loadPdf(file.source, {
    assetBaseUrl,
    signal: controller.signal,
    onProgress: (loaded, total) => {
      if (seq !== openSeq) return;
      useViewer.setState({ loadProgress: total > 0 ? Math.min(1, loaded / total) : null });
    },
  });

  if (seq !== openSeq) {
    // Una apertura posterior ha tomado el relevo: este resultado se descarta sin tocar el store.
    if (result.ok) await result.value.destroy();
    await closeOpened(file);
    return;
  }
  if (opening === controller) opening = null;

  if (!result.ok) {
    if (result.error.code === 'cancelled') {
      useViewer.setState({ ...initialViewerState, dimsVersion: useViewer.getState().dimsVersion });
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

  const scan = new AbortController();
  const stopListening = loaded.onIoError((error) => {
    if (seq === openSeq) useViewer.setState({ ioError: error });
  });
  session = { file, pdf: loaded, stopListening, scan };

  expectRestore(opts?.restore ?? null);
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file,
    pdf: loaded,
    dims,
    dimsVersion: useViewer.getState().dimsVersion + 1,
    sidebar: sidebarForOpenedDocument(pageMode),
  });
  platform.setTitle(windowTitle(file.name, false));
  startAnnotationSession(loaded, scan.signal);
  startFormSession(loaded);
  loadPageLabels(loaded);
  loadOutline(loaded);

  if (loaded.numPages <= SCAN_PAGE_LIMIT) {
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
}

/** Cancela la apertura en curso (si la hay). El store vuelve a estado vacío. */
export function cancelOpening(): void {
  opening?.abort();
}

/** Cierra el documento abierto (y cancela una apertura en curso). */
export async function closeDocument(): Promise<void> {
  const current = beginReplacement();
  useViewer.setState({ ...initialViewerState, dimsVersion: useViewer.getState().dimsVersion });
  services().platform.setTitle(windowTitle(null, false));
  await releaseSession(current);
}

/**
 * Abre un fichero que pide el usuario («Abrir», arrastrar, «Abrir con»). Antes ofrece guardar los cambios sin guardar;
 * si el usuario cancela, el fichero no se abre (y se libera).
 */
export function openRequested(file: OpenedFile): Promise<void> {
  // Sin cambios, la apertura empieza en el mismo turno (sin esperar un aviso que no va a salir).
  if (!hasUnsavedChanges()) return openDocument(file);
  return confirmThenOpen(file);
}

async function confirmThenOpen(file: OpenedFile): Promise<void> {
  if ((await confirmDiscardOrSave()) === 'cancel') {
    await closeOpened(file);
    return;
  }
  await openDocument(file);
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
