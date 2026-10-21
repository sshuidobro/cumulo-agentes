import { createLogger, UndoStack, type AppError, type Command } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import type { RectPt } from '../core/annotations/model';
import type { SourceInput } from '../core/doc-ops/client';
import type { PagePlan, RedactArea } from '../core/redact/apply';
import { concatSource } from '../core/pdf/concat-source';
import { selectionPageRects } from '../ui/viewer/selection-to-pages';
import { redactMsg } from '../ui/messages-redact';
import { nowIso } from './annotation-actions';
import { askChoice } from './choice';
import { currentPassword } from './document-actions';
import { runDocOp } from './doc-ops';
import { beginJob, endJob, jobOptions, useDocOpJob } from './extract-actions';
import { showNotice } from './notice';
import { openPrintSource, type PrintSource } from './print-source';
import { initialRedactState, useRedact, type RedactMark } from './redact-store';
import { useSearch } from './search-store';
import { isSwitchingTab, registerTabParticipant, type TabParticipant } from './tabs';
import {
  buildCurrentDelta,
  pendingChanges,
  registerPendingChanges,
  writeDocument,
  type PendingChanges,
  type SaveResult,
} from './save-actions';
import { useViewer } from './viewer-store';

const log = createLogger('redact-actions');

/** Imágenes que sustituyen a las originales al redactar: página entera (raster) y JPEG parcial. */
interface RedactReplacements {
  readonly rasterPages: Map<number, Uint8Array>;
  readonly imageReplacements: Map<string, Uint8Array>;
}

/** Máximo de coincidencias que se marcan de una vez (PDF-137). */
export const MAX_SEARCH_MARKS = 10_000;
/** Profundidad del historial de marcas. */
export const REDACT_UNDO_DEPTH = 100;

type Marks = readonly RedactMark[];

/** Historial de las marcas del documento abierto. Cada apertura empieza uno nuevo. */
let stack = newStack();
let nextId = 1;

function newStack(): UndoStack<Marks> {
  return new UndoStack<Marks>([], { maxDepth: REDACT_UNDO_DEPTH });
}

/** Comando que sustituye todas las marcas por `next`. Deshacerlo restaura las anteriores. */
function replaceMarks(next: Marks, label: string): Command<Marks> {
  return {
    label,
    apply: () => next,
    invert: (before) => replaceMarks(before, label),
  };
}

/** Documento listo para marcar: hay un fichero abierto y la vista ha terminado de cargar. */
function ready(): boolean {
  const { status, file } = useViewer.getState();
  return status === 'ready' && file !== null;
}

function newMark(pageIndex: number, rect: RectPt): RedactMark {
  const id = `redact-${nextId}`;
  nextId += 1;
  return { id, pageIndex, rect };
}

/** Publica las marcas y el historial, y mantiene el registro de cambios pendientes al día. */
function publish(marks: Marks): void {
  useRedact.setState({ marks, undo: stack.getState() });
  syncPending();
}

function commit(next: Marks, label: string): void {
  stack.execute(replaceMarks(next, label));
  publish(stack.doc);
}

/** Con marcas, Ctrl+S pregunta si aplicarlas (`save-actions`). Sin marcas, el registro se libera. */
function syncPending(): void {
  const current = pendingChanges();
  const dirty = useRedact.getState().marks.length > 0;
  if (dirty && current === null) registerPendingChanges(pendingHandle);
  else if (!dirty && current === pendingHandle) registerPendingChanges(null);
}

/** Quita todas las marcas sin preguntar y vacía el historial. */
function clearAll(): void {
  stack = newStack();
  publish([]);
}

const pendingHandle: PendingChanges = {
  isDirty: () => useRedact.getState().marks.length > 0,
  save: applyRedactions,
  discard: clearAll,
};

/** Añade una zona marcada en la página `pageIndex` (0-based), en puntos PDF. */
export function addMark(pageIndex: number, rect: RectPt): void {
  if (!ready()) return;
  commit([...useRedact.getState().marks, newMark(pageIndex, rect)], 'marcar zona');
}

/** Marca el texto seleccionado en el visor: una zona por fragmento de línea. */
export function markSelection(): void {
  const sel = document.getSelection();
  if (sel === null || sel.isCollapsed || !ready()) return;
  const added: RedactMark[] = [];
  for (const [pageIndex, rects] of selectionPageRects(sel)) {
    for (const rect of rects) added.push(newMark(pageIndex, rect));
  }
  if (added.length === 0) return;
  commit([...useRedact.getState().marks, ...added], 'marcar texto');
  showNotice(redactMsg.marked(added.length));
}

/**
 * Marca todas las coincidencias de la búsqueda actual (como mucho `MAX_SEARCH_MARKS`). Devuelve cuántas
 * coincidencias se han marcado; 0 sin búsqueda, o si el documento cambia mientras se calcula.
 */
export async function markSearchResults(): Promise<number> {
  const pdf = useViewer.getState().pdf;
  if (!ready() || pdf === null) return 0;
  const matches = [...useSearch.getState().matchesByPage.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, list]) => list)
    .slice(0, MAX_SEARCH_MARKS);
  if (matches.length === 0) return 0;

  const added: RedactMark[] = [];
  try {
    const { matchRects } = await import('../engine/match-rects');
    for (const match of matches) {
      for (const rect of await matchRects(pdf.doc, match)) added.push(newMark(match.pageIndex, rect));
    }
  } catch (error: unknown) {
    log.warn('markSearchResults', String(error));
    showNotice(redactMsg.failed);
    return 0;
  }
  if (useViewer.getState().pdf !== pdf) return 0;
  if (added.length > 0) commit([...useRedact.getState().marks, ...added], 'marcar resultados');
  showNotice(redactMsg.marked(added.length));
  return matches.length;
}

/** Quita una marca. Sin marca con ese id, no hace nada. */
export function removeMark(id: string): void {
  const marks = useRedact.getState().marks;
  if (!marks.some((mark) => mark.id === id)) return;
  commit(
    marks.filter((mark) => mark.id !== id),
    'quitar marca',
  );
}

export function redactUndo(): void {
  if (stack.undo()) publish(stack.doc);
}

export function redactRedo(): void {
  if (stack.redo()) publish(stack.doc);
}

/**
 * Aplica las marcas: confirma, planifica en el Worker, pide una segunda confirmación si hay páginas que se
 * convertirán en imagen, rasteriza lo necesario, reescribe el fichero y lo guarda. Un fallo deja el fichero sin tocar.
 */
export async function applyRedactions(): Promise<SaveResult | 'cancelled'> {
  if (useRedact.getState().marks.length === 0) return 'nothing';
  const { status, file } = useViewer.getState();
  if (status !== 'ready' || file === null) return 'failed';
  if (useDocOpJob.getState().label !== null) {
    showNotice(redactMsg.notReady);
    return 'failed';
  }

  const answer = await askChoice<'apply' | 'cancel'>({
    title: redactMsg.confirmTitle,
    message: redactMsg.confirmMessage,
    options: [
      { label: redactMsg.confirmApply, value: 'apply' },
      { label: redactMsg.cancel, value: 'cancel' },
    ],
    cancel: 'cancel',
  });
  if (answer === 'cancel') return 'cancelled';

  const marks = useRedact.getState().marks;
  const areas: readonly RedactArea[] = marks.map((mark) => ({ pageIndex: mark.pageIndex, rect: mark.rect }));
  const planned = await planRedactions(file, areas);
  if (typeof planned === 'string') return planned;

  const rasterCount = planned.pages.filter((page) => page.raster).length;
  if (rasterCount > 0) {
    const second = await askChoice<'apply' | 'cancel'>({
      title: redactMsg.rasterTitle,
      message: redactMsg.rasterWarning(rasterCount),
      options: [
        { label: redactMsg.confirmApply, value: 'apply' },
        { label: redactMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (second === 'cancel') return 'cancelled';
  }
  return writeRedacted(file, planned.source, planned.pages, areas, marks);
}

interface Planned {
  /** Documento con los cambios sin guardar ya incluidos: sobre él se planifica y se redacta. */
  readonly source: SourceInput;
  readonly pages: readonly PagePlan[];
}

/** Operación `redact-plan` con su propio trabajo en curso. `'cancelled'` o `'failed'` ya tienen su aviso. */
async function planRedactions(file: OpenedFile, areas: readonly RedactArea[]): Promise<Planned | 'cancelled' | 'failed'> {
  const controller = beginJob(redactMsg.confirmTitle);
  if (controller === null) return 'failed';
  try {
    const built = await buildCurrentDelta(file);
    if (!built.ok) {
      fail(built.error);
      return 'failed';
    }
    const source = concatSource(file.source, built.value ?? new Uint8Array(0));
    const planned = await runDocOp<readonly PagePlan[]>(
      'redact-plan',
      { password: currentPassword(), areas },
      [source],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return 'cancelled';
    if (!planned.ok) {
      fail(planned.error);
      return 'failed';
    }
    return { source, pages: planned.value };
  } catch (error: unknown) {
    if (controller.signal.aborted) return 'cancelled';
    log.warn('planRedactions', String(error));
    showNotice(redactMsg.failed);
    return 'failed';
  } finally {
    endJob(controller);
  }
}

/** Rasteriza y pinta lo necesario, ejecuta `redact` y guarda el resultado. */
async function writeRedacted(
  file: OpenedFile,
  source: SourceInput,
  pages: readonly PagePlan[],
  areas: readonly RedactArea[],
  marks: Marks,
): Promise<SaveResult | 'cancelled'> {
  const controller = beginJob(redactMsg.confirmTitle, redactMsg.progress);
  if (controller === null) return 'failed';
  try {
    const replacements = await buildReplacements(pages, areas, controller.signal);
    if (replacements === 'cancelled') return 'cancelled';
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      'redact',
      {
        password: currentPassword(),
        areas,
        rasterPages: [...replacements.rasterPages.entries()],
        imageReplacements: [...replacements.imageReplacements.entries()],
        now: nowIso(),
      },
      [source],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return 'cancelled';
    if (!result.ok) return fail(result.error);

    // Antes de abrir el guardado, la operación deja de estar «en curso».
    endJob(controller);
    const saved = await writeDocument({ kind: 'replace', bytes: result.value.bytes, password: currentPassword() });
    if (saved === 'saved' || saved === 'downloaded') {
      clearAll();
      showNotice(redactMsg.done(new Set(marks.map((mark) => mark.pageIndex)).size));
    }
    return saved;
  } catch (error: unknown) {
    if (controller.signal.aborted) return 'cancelled';
    log.warn('writeRedacted', String(error));
    showNotice(redactMsg.failed);
    return 'failed';
  } finally {
    endJob(controller);
  }
}

/**
 * Páginas que se rasterizan (JPEG de la página entera) e imágenes JPEG parcialmente cubiertas (pintadas de negro).
 * Se dibuja sobre el mismo documento que se ha planificado (con los cambios sin guardar).
 */
async function buildReplacements(
  pages: readonly PagePlan[],
  areas: readonly RedactArea[],
  signal: AbortSignal,
): Promise<RedactReplacements | 'cancelled'> {
  const rasterPages = new Map<number, Uint8Array>();
  const imageReplacements = new Map<string, Uint8Array>();
  const rasterIndices = pages.filter((page) => page.raster).map((page) => page.pageIndex);
  const jpegs = pages.flatMap((page) =>
    page.raster
      ? []
      : page.partialImages.flatMap((image) =>
          image.kind === 'jpeg' && image.jpeg !== undefined
            ? [{ pageIndex: page.pageIndex, name: image.name, jpeg: image.jpeg, pixelRects: image.pixelRects }]
            : [],
        ),
  );
  if (rasterIndices.length === 0 && jpegs.length === 0) return { rasterPages, imageReplacements };

  const { renderRedactedPage, paintJpeg } = await import('../engine/redact-render');
  const total = rasterIndices.length + jpegs.length;
  const printed = await openPrintSource();
  if (printed === null || !printed.unsavedIncluded) {
    if (printed !== null) disposeSource(printed);
    throw new Error('no se han podido incluir los cambios sin guardar en la redacción');
  }
  try {
    let done = 0;
    for (const pageIndex of rasterIndices) {
      useDocOpJob.setState({ done, total });
      const rects = areas.filter((area) => area.pageIndex === pageIndex).map((area) => area.rect);
      const bytes = await renderRedactedPage(printed.doc, pageIndex, rects, signal);
      if (bytes === 'cancelled') return 'cancelled';
      rasterPages.set(pageIndex, bytes);
      done += 1;
    }
    for (const image of jpegs) {
      useDocOpJob.setState({ done, total });
      const bytes = await paintJpeg(image.jpeg, image.pixelRects);
      imageReplacements.set(`${image.pageIndex}:${image.name}`, bytes);
      done += 1;
    }
  } finally {
    disposeSource(printed);
  }
  return { rasterPages, imageReplacements };
}

/** Libera el temporal de la fuente de impresión. Nunca lanza. */
function disposeSource(source: PrintSource): void {
  source.dispose().catch((error: unknown) => {
    log.warn('dispose', String(error));
  });
}

function fail(error: AppError): SaveResult {
  log.warn('redact', error.code);
  showNotice(error.message);
  return 'failed';
}

/** Estado que se guarda al suspender la pestaña: el historial va con él. */
interface RedactSnapshot {
  readonly marks: Marks;
  readonly stack: UndoStack<Marks>;
}

const redactParticipant: TabParticipant<RedactSnapshot> = {
  id: 'redact',
  order: 41,
  suspend(): RedactSnapshot {
    const snapshot: RedactSnapshot = { marks: useRedact.getState().marks, stack };
    stack = newStack();
    useRedact.setState(initialRedactState);
    syncPending();
    return snapshot;
  },
  resume(snapshot: RedactSnapshot): void {
    stack = snapshot.stack;
    publish(snapshot.marks);
  },
  dispose: () => Promise.resolve(),
};

/** Da de alta las marcas en el registro de pestañas y vacía las del documento si cambia. Llamar una vez al arrancar. */
export function registerRedactParticipant(): void {
  registerTabParticipant(redactParticipant);
  useViewer.subscribe((next, prev) => {
    if (next.file !== prev.file && !isSwitchingTab() && useRedact.getState().marks.length > 0) clearAll();
  });
}
