import { createLogger, UndoStack, type Command } from '@suite/shared';
import type { ByteSource, KeyValueStore } from '@suite/platform';
import {
  addAnnotationCommand,
  deleteAnnotationCommand,
  setEntryCommand,
  updateAnnotationCommand,
} from '../core/annotations/commands';
import { setFieldCommand } from '../core/forms/commands';
import { annotationsOfPage, effectiveAnnotations } from '../core/annotations/effective';
import type { ForeignAnnotation, ImportedPage } from '../core/annotations/import';
import {
  EMPTY_EDITS,
  rectFromPaths,
  type Annotation,
  type AnnotationEdits,
  type FreeTextAnnotation,
  type InkAnnotation,
  type RectPt,
  type Rgb,
  type SignatureArt,
} from '../core/annotations/model';
import { fitFreeTextRect, isBlankText, newFreeTextAnnotation } from '../core/annotations/freetext';
import { keyboardNoteRect, newNoteAnnotation } from '../core/annotations/note';
import {
  keyboardSignatureCenter,
  newSignatureAnnotation,
  signatureRectAt,
} from '../core/signature/signature';
import {
  DEFAULT_AUTHOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_INK_WIDTH,
  DEFAULT_TOOL_COLORS,
  FONT_SIZES,
  INK_WIDTHS,
  MAX_AUTHOR_LENGTH,
} from '../core/annotations/palette';
import { windowTitle } from '../core/title';
import { openForSave } from '../core/pdf/incremental';
import type { ObjectReader } from '../core/pdf/object-reader';
import { readPageAnnotations, scanAnnotations, type LoadedPdf } from '../engine';
import { setFileAnnotationHidden } from '../engine/annotation-visibility';
import {
  initialAnnotationState,
  useAnnotations,
  type FreeTextEditing,
  type AnnotationState,
  type AnnotationTool,
  type ColorTool,
} from './annotation-store';
import { services } from './services';
import { showNotice } from './notice';
import { useViewer } from './viewer-store';
import { currentScanSignal } from './document-actions';
import { registerTabParticipant, type TabParticipant } from './tabs';
import { securityMsg } from '../ui/messages-security';

const log = createLogger('annotation-actions');

/** Por encima de este número de páginas las anotaciones se importan por páginas visitadas. */
const SCAN_PAGE_LIMIT = 20_000;
/** Profundidad del historial de deshacer (ADR-0005). */
const MAX_UNDO_DEPTH = 100;
/** Páginas por lote de fusión y entre dos cesiones del hilo durante el escaneo completo desde el panel (PDF-036). */
const SCAN_ALL_BATCH = 50;

interface IndexedPage {
  readonly index: number;
  readonly page: ImportedPage;
}

const COLOR_TOOLS: readonly ColorTool[] = ['highlight', 'underline', 'strikeout', 'note', 'freetext', 'ink'];

/** Clave de cada preferencia (el almacén ya antepone el prefijo de la app). */
const PREF = {
  author: 'annotationAuthor',
  colors: 'annotationColors',
  inkWidth: 'inkWidth',
  fontSize: 'fontSize',
  commentBarOpen: 'commentBarOpen',
} as const;

/** Sesión de un documento: se descarta entera al cerrarlo. */
interface Session {
  readonly pdf: LoadedPdf;
  /** Aborta el escaneo y las importaciones por página de esta sesión. */
  readonly stop: AbortController;
  /** Importaciones en curso, por índice de página, para no importar dos veces la misma. */
  readonly pending: Map<number, Promise<void>>;
  /** Lector del fichero para leer el `/Name` de los sellos ajenos (PDF-104). `null` si no hay fuente o falla al abrir. */
  readonly reader: Promise<ObjectReader | null>;
  /** Páginas ya importadas por el escaneo de la sesión (0-based: la siguiente a importar). Lo usa `resume` (PDF-101). */
  imported: number;
}

let session: Session | null = null;
/** Escaneo completo de un documento 'lazy' lanzado desde el panel (PDF-036). Solo uno a la vez. */
let fullScan: AbortController | null = null;
let stack = createStack();
let memo: { readonly baseline: AnnotationState['baseline']; readonly edits: AnnotationEdits; readonly result: ReadonlyMap<string, Annotation> } | null = null;
/** Anotaciones de cada página ya calculadas, con la versión de la página con que se calcularon. */
const pageMemo = new Map<number, { readonly version: number; readonly items: readonly Annotation[] }>();

/** Aviso tras publicar un cambio de la pila (antes y después). Lo usan los formularios (ADR-0019). */
export type EditsListener = (before: AnnotationEdits, after: AnnotationEdits) => void;
/** Aviso tras fusionar páginas importadas (escaneo, importación perezosa). */
export type PagesListener = (pages: readonly ImportedPage[]) => void;

const editsListeners = new Set<EditsListener>();
const pagesListeners = new Set<PagesListener>();

/** Se llama al final de cada `publish()`. Devuelve la función que da de baja el aviso. */
export function onEditsPublished(listener: EditsListener): () => void {
  editsListeners.add(listener);
  return () => {
    editsListeners.delete(listener);
  };
}

/** Se llama tras fusionar páginas importadas. Devuelve la función que da de baja el aviso. */
export function onPagesImported(listener: PagesListener): () => void {
  pagesListeners.add(listener);
  return () => {
    pagesListeners.delete(listener);
  };
}

function createStack(): UndoStack<AnnotationEdits> {
  return new UndoStack<AnnotationEdits>(EMPTY_EDITS, { maxDepth: MAX_UNDO_DEPTH });
}

/** Título de la ventana: marca «• » mientras haya cambios sin guardar. */
useAnnotations.subscribe((next, prev) => {
  if (next.undo.isDirty === prev.undo.isDirty) return;
  const file = useViewer.getState().file;
  if (file === null) return;
  services().platform.setTitle(windowTitle(file.name, next.undo.isDirty));
});

/** Lee las preferencias de anotación de la app. Lo que no sea válido toma su valor por defecto. */
function preferenceState(prefs: KeyValueStore): Pick<AnnotationState, 'author' | 'colors' | 'inkWidth' | 'fontSize' | 'commentBarOpen'> {
  const author = prefs.get(PREF.author, isString);
  const colors = prefs.get(PREF.colors, isColorRecord);
  const inkWidth = prefs.get(PREF.inkWidth, oneOf(INK_WIDTHS));
  const fontSize = prefs.get(PREF.fontSize, oneOf(FONT_SIZES));
  const commentBarOpen = prefs.get(PREF.commentBarOpen, isBoolean);
  return {
    author: author === null ? DEFAULT_AUTHOR : normalizeAuthor(author),
    colors: colors ?? { ...DEFAULT_TOOL_COLORS },
    inkWidth: inkWidth ?? DEFAULT_INK_WIDTH,
    fontSize: fontSize ?? DEFAULT_FONT_SIZE,
    commentBarOpen: commentBarOpen ?? false,
  };
}

function prefs(): KeyValueStore {
  return services().platform.prefs;
}

/**
 * Arranca la sesión de anotaciones de un documento recién abierto. Reinicia estado y pila.
 * Hasta 20 000 páginas se importan todas en segundo plano; más, se importa cada página al verla
 * (`ensurePageAnnotations`). `signal` aborta la sesión (cierre del documento). `source` (el fichero abierto) permite
 * leer el nombre de los sellos ajenos («Firma» frente a «Sello»); sin él, o si falla, sale «Sello».
 */
export function startAnnotationSession(pdf: LoadedPdf, signal: AbortSignal, source?: ByteSource): void {
  endAnnotationSession();
  restrictedNoticeShown = false;
  const stop = linkedController(signal);
  const reader: Promise<ObjectReader | null> = source === undefined
    ? Promise.resolve(null)
    : openForSave(source).then((r) => (r.ok ? r.value : null), () => null);
  const current: Session = { pdf, stop, pending: new Map(), reader, imported: 0 };
  session = current;
  stack = createStack();
  memo = null;
  pageMemo.clear();

  const lazy = pdf.numPages > SCAN_PAGE_LIMIT;
  useAnnotations.setState({
    ...initialAnnotationState(),
    ...preferenceState(prefs()),
    scan: lazy ? 'lazy' : 'scanning',
  });
  if (lazy) return;
  scanFrom(current, 0);
}

/** Controlador que se aborta cuando lo hace `signal` (si lo hay), o que ya nace abortado si `signal` ya lo está. */
function linkedController(signal: AbortSignal | null): AbortController {
  const controller = new AbortController();
  if (signal === null) return controller;
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', () => { controller.abort(); }, { once: true });
  }
  return controller;
}

/**
 * Importa las páginas de la sesión desde `from` (0-based) en orden. Cada lote se fusiona en `imported`, que avanza con
 * él. Al terminar sin cancelar, `scan` pasa a 'done'.
 */
function scanFrom(current: Session, from: number): void {
  current.reader
    .then((opened) => {
      // Una sesión suspendida (cambio de pestaña) mientras se abría el lector no empieza a escanear.
      if (current.stop.signal.aborted) return 'cancelled';
      return scanAnnotations(current.pdf.doc, {
        from,
        signal: current.stop.signal,
        fallbackDate: nowIso(),
        reader: opened,
        onBatch: (pages) => {
          if (session !== current || current.stop.signal.aborted) return;
          mergePages(current.imported, pages);
          current.imported += pages.length;
        },
      });
    })
    .then((outcome) => {
      if (session !== current || outcome !== 'done') return;
      useAnnotations.setState({ scan: 'done' });
    })
    .catch((cause: unknown) => {
      log.warn('scanAnnotations', cause);
      if (session === current) useAnnotations.setState({ scan: 'done' });
    });
}

/** Cierra la sesión: aborta el escaneo, descarta la pila y vuelve al estado inicial (conserva las preferencias). */
export function endAnnotationSession(): void {
  const current = session;
  session = null;
  current?.stop.abort();
  fullScan?.abort();
  fullScan = null;
  stack = createStack();
  memo = null;
  pageMemo.clear();
  const prev = useAnnotations.getState();
  useAnnotations.setState({
    ...initialAnnotationState(),
    colors: prev.colors,
    inkWidth: prev.inkWidth,
    fontSize: prev.fontSize,
    author: prev.author,
    commentBarOpen: prev.commentBarOpen,
  });
}

/** Estado del store sin las preferencias (globales: no cambian entre pestañas). */
function sessionStateOf(s: AnnotationState): AnnotationsSnapshot['state'] {
  return {
    baseline: s.baseline,
    foreign: s.foreign,
    importedPages: s.importedPages,
    scan: s.scan,
    scanProgress: s.scanProgress,
    scanCancelable: s.scanCancelable,
    edits: s.edits,
    undo: s.undo,
    selectedId: s.selectedId,
    openPopupId: s.openPopupId,
    tool: s.tool,
    pendingSignature: s.pendingSignature,
    editing: s.editing,
    pageVersion: s.pageVersion,
  };
}

/** Lo que hace falta para volver a mostrar un documento suspendido con sus anotaciones (PDF-101). */
interface AnnotationsSnapshot {
  /** Sesión del documento; `pending` vacío y `stop` ya abortado. `null` sin documento. */
  readonly session: Session | null;
  readonly stack: UndoStack<AnnotationEdits>;
  readonly memo: { readonly baseline: AnnotationState['baseline']; readonly edits: AnnotationEdits; readonly result: ReadonlyMap<string, Annotation> } | null;
  readonly pageMemo: ReadonlyMap<number, { readonly version: number; readonly items: readonly Annotation[] }>;
  /** Estado del store sin las preferencias (estas son globales y no se guardan aquí). */
  readonly state: Omit<AnnotationState, 'author' | 'colors' | 'inkWidth' | 'fontSize' | 'commentBarOpen'>;
  /** Páginas ya importadas por el escaneo de la sesión. */
  readonly importedPages: number;
  /** Había un escaneo completo desde el panel (PDF-036) en curso. */
  readonly fullScanRunning: boolean;
  /** Ya se avisó de que el PDF restringe los cambios (PDF-048). */
  readonly permissionNoticeShown: boolean;
}

/**
 * Participante de pestañas de las anotaciones (orden 10). Suspender aborta el escaneo y deja el módulo como
 * `endAnnotationSession()`, guardando antes la pila, los cachés y el estado. Reanudar restaura todo y relanza el
 * escaneo desde la última página importada. Las preferencias no cambian entre pestañas.
 */
const annotationsParticipant: TabParticipant<AnnotationsSnapshot> = {
  id: 'annotations',
  order: 10,
  suspend(): AnnotationsSnapshot {
    const current = session;
    const fullScanRunning = fullScan !== null;
    const state = sessionStateOf(useAnnotations.getState());
    const snapshot: AnnotationsSnapshot = {
      session: current === null ? null : { ...current, pending: new Map() },
      stack,
      memo,
      pageMemo: new Map(pageMemo),
      // Un escaneo completo cancelado vuelve a 'lazy' con las páginas ya importadas (como en `runScanAll`).
      state: fullScanRunning ? { ...state, scan: 'lazy', scanCancelable: false } : state,
      importedPages: current?.imported ?? 0,
      fullScanRunning,
      permissionNoticeShown: restrictedNoticeShown,
    };
    pendingPopup?.();
    pendingPopup = null;
    endAnnotationSession();
    restrictedNoticeShown = false;
    return snapshot;
  },
  resume(snapshot: AnnotationsSnapshot): void {
    stack = snapshot.stack;
    memo = snapshot.memo;
    pageMemo.clear();
    for (const [index, entry] of snapshot.pageMemo) pageMemo.set(index, entry);
    restrictedNoticeShown = snapshot.permissionNoticeShown;
    const live = useAnnotations.getState();
    useAnnotations.setState({
      ...snapshot.state,
      author: live.author,
      colors: live.colors,
      inkWidth: live.inkWidth,
      fontSize: live.fontSize,
      commentBarOpen: live.commentBarOpen,
    });
    const saved = snapshot.session;
    if (saved === null) {
      session = null;
      return;
    }
    const current: Session = {
      ...saved,
      stop: linkedController(currentScanSignal()),
      pending: new Map(),
      imported: snapshot.importedPages,
    };
    session = current;
    if (snapshot.fullScanRunning) {
      scanAllAnnotations();
    } else if (useAnnotations.getState().scan === 'scanning') {
      scanFrom(current, snapshot.importedPages);
    }
    const file = useViewer.getState().file;
    if (file !== null) services().platform.setTitle(windowTitle(file.name, useAnnotations.getState().undo.isDirty));
  },
  dispose: () => Promise.resolve(),
};

/** Da de alta el participante de anotaciones en el registro de pestañas. Llamar una vez al arrancar. */
export function registerAnnotationParticipant(): void {
  registerTabParticipant(annotationsParticipant);
}

/**
 * Modo 'lazy': importa las anotaciones de una página si aún no están. Pensado para llamarla al hacerse
 * visible una página. Una segunda llamada (o una concurrente) no vuelve a importarla.
 */
export async function ensurePageAnnotations(pageIndex: number): Promise<void> {
  const current = session;
  if (current === null) return;
  const state = useAnnotations.getState();
  if (state.scan !== 'lazy' || state.importedPages.has(pageIndex)) return;
  if (pageIndex < 0 || pageIndex >= current.pdf.numPages) return;
  const inFlight = current.pending.get(pageIndex);
  if (inFlight !== undefined) return inFlight;
  const job = importLazyPage(current, pageIndex).finally(() => {
    current.pending.delete(pageIndex);
  });
  current.pending.set(pageIndex, job);
  return job;
}

async function importLazyPage(current: Session, pageIndex: number): Promise<void> {
  const imported = await readLazyPage(current, pageIndex);
  if (imported !== null) mergeIndexed([{ index: pageIndex, page: imported }]);
}

/** Lee las anotaciones de una página de la sesión. `null` si la sesión ya no es la misma, se aborta o falla la lectura. */
async function readLazyPage(current: Session, pageIndex: number): Promise<ImportedPage | null> {
  try {
    const page = await current.pdf.doc.getPage(pageIndex + 1);
    const imported = await readPageAnnotations(page, nowIso(), await current.reader);
    if (session !== current || current.stop.signal.aborted) return null;
    return imported;
  } catch (cause) {
    log.warn('ensurePageAnnotations', cause);
    return null;
  }
}

/**
 * Importa las anotaciones de todas las páginas de un documento 'lazy' (PDF-036, botón «Buscar en todo el documento»).
 * El progreso va en `scanProgress`. Se cancela con `cancelScanAll()` o al cerrar el documento: entonces `scan` vuelve a
 * 'lazy' y las páginas ya importadas se quedan. Al terminar, `scan` pasa a 'done'.
 */
export function scanAllAnnotations(): void {
  const current = session;
  if (current === null || fullScan !== null) return;
  if (useAnnotations.getState().scan !== 'lazy') return;
  const controller = new AbortController();
  fullScan = controller;
  useAnnotations.setState({
    scan: 'scanning',
    scanCancelable: true,
    scanProgress: useAnnotations.getState().importedPages.size,
  });
  void runScanAll(current, controller);
}

/** Cancela el escaneo completo en curso (no hace nada si no hay ninguno). */
export function cancelScanAll(): void {
  fullScan?.abort();
}

async function runScanAll(current: Session, controller: AbortController): Promise<void> {
  // Las páginas se fusionan por lotes: cada fusión copia el estado, así que hacerlo por página sería cuadrático.
  let batch: IndexedPage[] = [];
  const flush = (): void => {
    if (batch.length > 0 && session === current) mergeIndexed(batch);
    batch = [];
  };
  try {
    for (let index = 0; index < current.pdf.numPages; index++) {
      if (controller.signal.aborted || session !== current) break;
      if (!useAnnotations.getState().importedPages.has(index)) {
        const imported = await readLazyPage(current, index);
        if (imported !== null) batch.push({ index, page: imported });
      }
      if (batch.length >= SCAN_ALL_BATCH) {
        flush();
        await yieldNow();
      }
    }
  } finally {
    flush();
    if (fullScan === controller) fullScan = null;
  }
  if (session !== current) return;
  const finished = !controller.signal.aborted && importedAll(current.pdf.numPages);
  useAnnotations.setState({ scan: finished ? 'done' : 'lazy', scanCancelable: false });
}

function importedAll(numPages: number): boolean {
  const { importedPages } = useAnnotations.getState();
  for (let index = 0; index < numPages; index++) {
    if (!importedPages.has(index)) return false;
  }
  return true;
}

function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Fusiona páginas importadas (desde `from`, en orden) en la línea base y sube la versión de las que tienen anotaciones. */
function mergePages(from: number, pages: readonly ImportedPage[]): void {
  mergeIndexed(pages.map((page, i) => ({ index: from + i, page })));
}

/** Fusiona páginas con su índice (en un único cambio de estado). */
function mergeIndexed(entries: readonly IndexedPage[]): void {
  mergeIndexedState(entries);
  if (entries.length > 0) {
    const pages = entries.map((e) => e.page);
    for (const listener of pagesListeners) listener(pages);
  }
}

function mergeIndexedState(entries: readonly IndexedPage[]): void {
  useAnnotations.setState((s) => {
    const baseline = new Map(s.baseline);
    const foreign = new Map<string, ForeignAnnotation>(s.foreign);
    const importedPages = new Set(s.importedPages);
    const pageVersion = new Map(s.pageVersion);
    for (const { index, page } of entries) {
      importedPages.add(index);
      for (const a of page.supported) baseline.set(a.id, a);
      for (const f of page.foreign) foreign.set(f.id, f);
      if (page.supported.length > 0 || page.foreign.length > 0) {
        pageVersion.set(index, (pageVersion.get(index) ?? 0) + 1);
      }
    }
    return { baseline, foreign, importedPages, pageVersion, scanProgress: importedPages.size };
  });
}

export function newAnnotationId(): string {
  return `suite-${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Ejecuta un cambio sobre la pila y publica el resultado en el store. `kind`: qué permiso exige el cambio (PDF-048). */
function apply(change: () => void, kind: ChangeKind = 'annotate'): void {
  const before = stack.doc;
  change();
  publish(before);
  if (stack.doc !== before) warnIfRestricted(kind);
}

/** Qué hace un cambio: anotar (comentarios, marcas, dibujos) o rellenar un campo de formulario. */
type ChangeKind = 'annotate' | 'fill';

/** Si ya se ha avisado de que el PDF no permite el cambio en este documento (PDF-048). */
let restrictedNoticeShown = false;

/**
 * Aviso una sola vez por documento cuando el PDF no permite comentar (o rellenar). No bloquea nada: el cambio
 * se hace y se guardará en la copia.
 */
function warnIfRestricted(kind: ChangeKind): void {
  if (restrictedNoticeShown) return;
  const permissions = useViewer.getState().permissions;
  const allowed = kind === 'annotate' ? permissions.annotate : permissions.fillForms;
  if (allowed) return;
  restrictedNoticeShown = true;
  showNotice(securityMsg.annotateAnyway);
}

/** Publica en el store el documento de la pila y sube la versión de las páginas que han cambiado. */
function publish(before: AnnotationEdits): void {
  const after = stack.doc;
  const { baseline } = useAnnotations.getState();
  const ids = changedIds(before, after);
  const pages = changedPages(baseline, before, after, ids);
  syncFileVisibility(baseline, after, ids);
  useAnnotations.setState((s) => {
    const pageVersion = new Map(s.pageVersion);
    for (const index of pages) pageVersion.set(index, (pageVersion.get(index) ?? 0) + 1);
    return { edits: after, undo: stack.getState(), pageVersion };
  });
  // Si la ventana de comentario era de una anotación que ya no existe (borrada o deshecha), se cierra.
  const open = useAnnotations.getState().openPopupId;
  if (open !== null && !getEffective().has(open)) {
    useAnnotations.setState({ openPopupId: null });
  }
  for (const listener of editsListeners) listener(before, after);
}

/** Sube en uno la versión de cada página indicada (para redibujarla). */
export function bumpPageVersions(pages: Iterable<number>): void {
  const list = [...pages];
  if (list.length === 0) return;
  useAnnotations.setState((s) => {
    const pageVersion = new Map(s.pageVersion);
    for (const index of list) pageVersion.set(index, (pageVersion.get(index) ?? 0) + 1);
    return { pageVersion };
  });
}

/** Ejecuta un comando sobre la pila de deshacer común (valores de formulario, etc.). */
export function executeEdit(cmd: Command<AnnotationEdits>): void {
  apply(() => {
    stack.execute(cmd);
  }, 'fill');
}

/** Ids cuya entrada en `edits` (cambio o borrado) es distinta entre dos estados. */
function changedIds(before: AnnotationEdits, after: AnnotationEdits): Set<string> {
  const ids = new Set<string>([...before.upserts.keys(), ...after.upserts.keys(), ...before.removed, ...after.removed]);
  for (const id of [...ids]) {
    const unchanged = before.upserts.get(id) === after.upserts.get(id) && before.removed.has(id) === after.removed.has(id);
    if (unchanged) ids.delete(id);
  }
  return ids;
}

/** Páginas donde cambia alguna anotación entre dos estados (antes y después, por si se mueve de página). */
function changedPages(
  baseline: AnnotationState['baseline'],
  before: AnnotationEdits,
  after: AnnotationEdits,
  ids: ReadonlySet<string>,
): number[] {
  const pages = new Set<number>();
  for (const id of ids) {
    addPage(pages, pageOfEntry(baseline, before, id));
    addPage(pages, pageOfEntry(baseline, after, id));
  }
  return [...pages];
}

/**
 * Una anotación del fichero editada o borrada se oculta en el lienzo (la dibuja la capa de anotaciones);
 * al deshacer el cambio vuelve a mostrarse. Sus popups siguen el mismo estado.
 */
function syncFileVisibility(baseline: AnnotationState['baseline'], after: AnnotationEdits, ids: ReadonlySet<string>): void {
  const current = session;
  if (current === null) return;
  for (const id of ids) {
    const origin = baseline.get(id)?.origin;
    if (origin === undefined || origin.kind !== 'file') continue;
    const hidden = after.upserts.has(id) || after.removed.has(id);
    setFileAnnotationHidden(current.pdf.doc, origin.ref, hidden);
    if (origin.popupRef !== null) setFileAnnotationHidden(current.pdf.doc, origin.popupRef, hidden);
  }
}

function pageOfEntry(baseline: AnnotationState['baseline'], edits: AnnotationEdits, id: string): number | undefined {
  return (edits.upserts.get(id) ?? baseline.get(id))?.pageIndex;
}

function addPage(pages: Set<number>, index: number | undefined): void {
  if (index !== undefined) pages.add(index);
}

export function addAnnotation(a: Annotation): void {
  apply(() => {
    stack.execute(addAnnotationCommand(a));
  });
}

/** Añade varias anotaciones con una única entrada de deshacer. */
export function addAnnotations(label: string, list: readonly Annotation[]): void {
  if (list.length === 0) return;
  apply(() => {
    stack.group(label, () => {
      for (const a of list) stack.execute(setEntryCommand(label, a.id, a, false));
    });
  });
}

export function updateAnnotation(next: Annotation, label?: string, mergeKey?: string): void {
  apply(() => {
    stack.execute(updateAnnotationCommand(next, label, mergeKey));
  });
}

export function deleteAnnotation(id: string): void {
  const current = getEffective().get(id);
  if (current === undefined) return;
  apply(() => {
    stack.execute(deleteAnnotationCommand(current));
  });
  if (useAnnotations.getState().selectedId === id) {
    useAnnotations.setState({ selectedId: null });
  }
}

/**
 * Abre el editor en el sitio de un cuadro de texto libre nuevo (PDF-034). El cuadro todavía no es una anotación: se
 * crea al confirmar, si tiene texto. `floor` es el borde inferior de la página (puntos PDF).
 */
export function beginFreeText(pageIndex: number, rect: RectPt, floor: number): void {
  const { colors, author, fontSize } = useAnnotations.getState();
  stack.closeGroup();
  const base = newFreeTextAnnotation({
    id: newAnnotationId(),
    pageIndex,
    rect,
    fontSize,
    color: colors.freetext,
    textColor: colors.freetext,
    author,
    now: nowIso(),
  });
  useAnnotations.setState({ editing: { base, inStore: false, floor }, selectedId: null });
}

/** Abre el editor en el sitio de un texto libre existente (doble clic o Intro, PDF-034). */
export function beginEditFreeText(id: string, floor: number): void {
  const current = getEffective().get(id);
  if (current?.type !== 'freetext') return;
  stack.closeGroup();
  // Un texto del fichero lo pinta pdf.js: se oculta mientras se edita, para no ver el texto dos veces.
  if (current.origin.kind === 'file' && session !== null) {
    setFileAnnotationHidden(session.pdf.doc, current.origin.ref, true);
  }
  useAnnotations.setState({ editing: { base: current, inStore: true, floor }, selectedId: id });
}

/**
 * Confirma la edición de un texto libre (PDF-034). Nuevo con texto → se añade; nuevo sin texto → no pasa nada.
 * Existente que cambia → «editar texto»; existente que queda vacío → se borra. Idempotente: sin edición activa no hace nada.
 */
export function commitFreeText(text: string): void {
  const editing: FreeTextEditing | null = useAnnotations.getState().editing;
  if (editing === null) return;
  useAnnotations.setState({ editing: null });
  const { base, inStore, floor } = editing;
  if (!inStore) {
    if (isBlankText(text)) return;
    const created: FreeTextAnnotation = {
      ...base,
      contents: text,
      rect: fitFreeTextRect(base.rect, text, base.fontSize, floor),
    };
    addAnnotation(created);
    select(created.id);
    return;
  }
  const current = getEffective().get(base.id);
  if (current?.type !== 'freetext') return;
  if (isBlankText(text)) {
    deleteAnnotation(current.id);
    return;
  }
  if (text !== current.contents) {
    updateAnnotation(
      {
        ...current,
        contents: text,
        rect: fitFreeTextRect(current.rect, text, current.fontSize, floor),
        modified: nowIso(),
      },
      'editar texto',
    );
  }
  // Vuelve a mostrar el texto del fichero si no quedó editado (si lo está, la pila ya lo oculta).
  syncFileVisibility(useAnnotations.getState().baseline, stack.doc, new Set([base.id]));
}

/**
 * Cambia el cuadro de un texto libre (tirador o Mayús+flechas, PDF-034). `mergeKey` agrupa una ráfaga de flechas en
 * una sola entrada de deshacer. Sin cambio real no crea entrada.
 */
export function resizeFreeText(id: string, rect: RectPt, mergeKey?: string): void {
  const current = getEffective().get(id);
  if (current?.type !== 'freetext') return;
  const same = current.rect.every((v, i) => v === rect[i]);
  if (same) return;
  updateAnnotation({ ...current, rect }, 'cambiar tamaño', mergeKey);
}

/**
 * Tamaño de letra de la barra «Comentar» (PDF-034): fija el de la herramienta «Texto» y, si hay un texto libre
 * seleccionado, también el suyo.
 */
export function setFreeTextFontSize(size: AnnotationState['fontSize']): void {
  setFontSize(size);
  const current = selectedFreeText();
  if (current === undefined || current.fontSize === size) return;
  updateAnnotation({ ...current, fontSize: size }, 'cambiar tamaño de letra');
}

/**
 * Color de la barra «Comentar» (PDF-034): fija el de la herramienta «Texto» y, si hay un texto libre seleccionado,
 * el color de su texto. El borde del cuadro no cambia.
 */
export function setFreeTextColor(rgb: Rgb): void {
  setToolColor('freetext', rgb);
  const current = selectedFreeText();
  if (current === undefined || current.textColor.every((v, i) => v === rgb[i])) return;
  updateAnnotation({ ...current, textColor: rgb }, 'cambiar color del texto');
}

/** Texto libre seleccionado y visible, o `undefined`. */
export function selectedFreeText(): FreeTextAnnotation | undefined {
  const id = useAnnotations.getState().selectedId;
  if (id === null) return undefined;
  const current = getEffective().get(id);
  return current?.type === 'freetext' ? current : undefined;
}

/** Etiqueta de la entrada de deshacer que aplica un borrador recuperado (PDF-038). */
const RECOVER_LABEL = 'recuperar cambios';

/** Aplica los cambios de un borrador recuperado como una única entrada de deshacer. */
export function recoverEdits(recovered: AnnotationEdits): void {
  const ids = new Set([...recovered.upserts.keys(), ...recovered.removed]);
  if (ids.size === 0 && recovered.fields.size === 0) return;
  apply(() => {
    stack.group(RECOVER_LABEL, () => {
      for (const id of ids) {
        stack.execute(setEntryCommand(RECOVER_LABEL, id, recovered.upserts.get(id), recovered.removed.has(id)));
      }
      for (const [name, value] of recovered.fields) {
        stack.execute(setFieldCommand(name, value, RECOVER_LABEL));
      }
    });
  });
}

export function undo(): void {
  apply(() => {
    stack.undo();
  });
}

export function redo(): void {
  apply(() => {
    stack.redo();
  });
}

export function closeUndoGroup(): void {
  stack.closeGroup();
}

/** Cambiar de selección corta la agrupación de deshacer. */
export function select(id: string | null): void {
  stack.closeGroup();
  useAnnotations.setState({ selectedId: id });
}

/** Abre la ventana de comentario de una anotación (PDF-033). Cambiar de ventana corta la agrupación de deshacer. */
export function openPopup(id: string): void {
  stack.closeGroup();
  useAnnotations.setState({ openPopupId: id });
}

/** Apertura de ventana pendiente de que su página sea la actual (ver `openPopupWhenPageCurrent`). */
let pendingPopup: (() => void) | null = null;

/**
 * Abre la ventana de comentario de `id` cuando la página `pageIndex` ya es la actual del visor (PDF-036). El salto a una
 * página es asíncrono: una ventana abierta antes se cerraría al no estar la página visible (PDF-033). Una nueva llamada
 * anula la pendiente.
 */
export function openPopupWhenPageCurrent(id: string, pageIndex: number): void {
  pendingPopup?.();
  pendingPopup = null;
  if (useViewer.getState().currentPage === pageIndex) {
    openPopup(id);
    return;
  }
  const unsubscribe = useViewer.subscribe((state) => {
    if (state.currentPage !== pageIndex) return;
    unsubscribe();
    pendingPopup = null;
    openPopup(id);
  });
  pendingPopup = unsubscribe;
}

/** Cierra la ventana de comentario y corta la agrupación de deshacer (la escritura queda como una entrada). */
export function closePopup(): void {
  stack.closeGroup();
  useAnnotations.setState({ openPopupId: null });
}

/** Cambiar a «ninguna» descarta la firma pendiente de colocar. */
export function setTool(tool: AnnotationTool): void {
  useAnnotations.setState(tool === 'none' ? { tool, pendingSignature: null } : { tool });
}

/** Firma elegida en «Firmar» (PDF-043): la herramienta pasa a `signature` y la siguiente colocación la usa. */
export function chooseSignature(art: SignatureArt): void {
  useAnnotations.setState({ pendingSignature: art, tool: 'signature' });
}

/**
 * Coloca la firma pendiente centrada en `center` (puntos PDF) de la página `pageIndex`, dentro de `pageBox`. La
 * selecciona y devuelve la herramienta a «ninguna», como con una nota. Devuelve su id, o `null` si no hay firma pendiente.
 */
export function placeSignature(pageIndex: number, center: readonly [number, number], pageBox: RectPt): string | null {
  const { pendingSignature, author } = useAnnotations.getState();
  if (pendingSignature === null) return null;
  const signature = newSignatureAnnotation({
    id: newAnnotationId(),
    pageIndex,
    rect: signatureRectAt(pendingSignature, center, pageBox),
    art: pendingSignature,
    author,
    now: nowIso(),
  });
  addAnnotation(signature);
  setTool('none');
  select(signature.id);
  return signature.id;
}

/**
 * Coloca la firma pendiente con teclado (PDF-043): en la página actual, centrada horizontalmente y a un tercio de lo
 * visible desde arriba. `visibleFraction` es la parte de la página que cabe en pantalla (0..1). Devuelve su id, o `null`.
 */
export function placeSignatureFromKeyboard(visibleFraction: number): string | null {
  const { dims, currentPage, currentYFraction, rotation } = useViewer.getState();
  if (dims === null || currentPage >= dims.count) return null;
  const i = currentPage;
  const width = dims.width(i);
  const height = dims.height(i);
  const center = keyboardSignatureCenter(width, height, (dims.rotation(i) + rotation) % 360, currentYFraction, visibleFraction);
  return placeSignature(i, center, [0, 0, width, height]);
}

/**
 * Crea una nota sin ratón (PDF-072): en la página actual, arriba a la izquierda de lo visible. La selecciona, abre su
 * ventana de comentario y devuelve la herramienta a «ninguna». Una sola entrada de deshacer. Devuelve su id, o `null`
 * si no hay documento o no hay página actual.
 */
export function addNoteFromKeyboard(): string | null {
  const { dims, currentPage, currentYFraction, rotation } = useViewer.getState();
  if (dims === null || currentPage >= dims.count) return null;
  const i = currentPage;
  const rect = keyboardNoteRect(dims.width(i), dims.height(i), (dims.rotation(i) + rotation) % 360, currentYFraction);
  const { colors, author } = useAnnotations.getState();
  const note = newNoteAnnotation({
    id: newAnnotationId(),
    pageIndex: i,
    rect,
    color: colors.note,
    author,
    now: nowIso(),
  });
  addAnnotation(note);
  setTool('none');
  select(note.id);
  openPopupWhenPageCurrent(note.id, i);
  return note.id;
}

export function setToolColor(tool: ColorTool, color: Rgb): void {
  const colors = { ...useAnnotations.getState().colors, [tool]: color };
  prefs().set(PREF.colors, colors);
  useAnnotations.setState({ colors });
}

/**
 * Grosor de la barra «Comentar» (PDF-035): fija el de la herramienta «Dibujar» y, si hay un dibujo seleccionado, también
 * el suyo. La caja se recalcula para que siga conteniendo el trazo.
 */
export function setInkWidth(width: AnnotationState['inkWidth']): void {
  prefs().set(PREF.inkWidth, width);
  useAnnotations.setState({ inkWidth: width });
  const current = selectedInk();
  if (current === undefined || current.width === width) return;
  updateAnnotation({ ...current, width, rect: rectFromPaths(current.paths, width / 2 + 1) }, 'cambiar grosor');
}

/**
 * Color de la barra «Comentar» para «Dibujar» (PDF-035): fija el de la herramienta y, si hay un dibujo seleccionado,
 * el color de su trazo.
 */
export function setInkColor(rgb: Rgb): void {
  setToolColor('ink', rgb);
  const current = selectedInk();
  if (current === undefined || current.color.every((v, i) => v === rgb[i])) return;
  updateAnnotation({ ...current, color: rgb }, 'cambiar color');
}

/** Dibujo a mano seleccionado y visible, o `undefined`. */
export function selectedInk(): InkAnnotation | undefined {
  const id = useAnnotations.getState().selectedId;
  if (id === null) return undefined;
  const current = getEffective().get(id);
  return current?.type === 'ink' ? current : undefined;
}

export function setFontSize(size: AnnotationState['fontSize']): void {
  prefs().set(PREF.fontSize, size);
  useAnnotations.setState({ fontSize: size });
}

/** Recorta el nombre; vacío (o solo espacios) → «Usuario». */
export function setAuthor(name: string): void {
  const author = normalizeAuthor(name);
  prefs().set(PREF.author, author);
  useAnnotations.setState({ author });
}

export function setCommentBarOpen(open: boolean): void {
  prefs().set(PREF.commentBarOpen, open);
  useAnnotations.setState({ commentBarOpen: open });
}

/** Marca el estado actual como guardado: deja de estar «sucio» (la pila no se vacía). */
export function markAnnotationsSaved(): void {
  stack.markSaved();
  publish(stack.doc);
}

/**
 * Anotaciones de una página (línea base ⊕ cambios), cacheadas hasta que cambie su versión (`pageVersion`).
 * `version` es la versión de la página en la misma lectura del store que llama a esta función.
 */
export function pageAnnotations(pageIndex: number, version: number): readonly Annotation[] {
  const hit = pageMemo.get(pageIndex);
  if (hit !== undefined && hit.version === version) return hit.items;
  const items = annotationsOfPage(getEffective(), pageIndex);
  pageMemo.set(pageIndex, { version, items });
  return items;
}

/** Lo que se ve: línea base ⊕ cambios. Memoizado por las referencias de línea base y cambios. */
export function getEffective(): ReadonlyMap<string, Annotation> {
  const { baseline, edits } = useAnnotations.getState();
  if (memo !== null && memo.baseline === baseline && memo.edits === edits) return memo.result;
  const result = effectiveAnnotations(baseline, edits);
  memo = { baseline, edits, result };
  return result;
}

function normalizeAuthor(name: string): string {
  const trimmed = Array.from(name.trim()).slice(0, MAX_AUTHOR_LENGTH).join('');
  return trimmed === '' ? DEFAULT_AUTHOR : trimmed;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function oneOf<T extends number>(allowed: readonly T[]): (v: unknown) => v is T {
  const list: readonly unknown[] = allowed;
  return (v: unknown): v is T => list.includes(v);
}

function isRgb(v: unknown): v is Rgb {
  return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && c >= 0 && c <= 1);
}

/** Un color por herramienta de color; si falta alguno, la preferencia entera no vale. */
function isColorRecord(v: unknown): v is Record<ColorTool, Rgb> {
  if (!isRecord(v)) return false;
  return COLOR_TOOLS.every((tool) => isRgb(v[tool]));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
