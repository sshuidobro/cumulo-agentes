import { createLogger, UndoStack } from '@suite/shared';
import type { KeyValueStore } from '@suite/platform';
import {
  addAnnotationCommand,
  deleteAnnotationCommand,
  setEntryCommand,
  updateAnnotationCommand,
} from '../core/annotations/commands';
import { effectiveAnnotations } from '../core/annotations/effective';
import type { ForeignAnnotation, ImportedPage } from '../core/annotations/import';
import {
  EMPTY_EDITS,
  type Annotation,
  type AnnotationEdits,
  type Rgb,
} from '../core/annotations/model';
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
import { readPageAnnotations, scanAnnotations, type LoadedPdf } from '../engine';
import {
  initialAnnotationState,
  useAnnotations,
  type AnnotationState,
  type AnnotationTool,
  type ColorTool,
} from './annotation-store';
import { services } from './services';
import { useViewer } from './viewer-store';

const log = createLogger('annotation-actions');

/** Por encima de este número de páginas las anotaciones se importan por páginas visitadas. */
const SCAN_PAGE_LIMIT = 20_000;
/** Profundidad del historial de deshacer (ADR-0005). */
const MAX_UNDO_DEPTH = 100;

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
}

let session: Session | null = null;
let stack = createStack();
let memo: { readonly baseline: AnnotationState['baseline']; readonly edits: AnnotationEdits; readonly result: ReadonlyMap<string, Annotation> } | null = null;

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
 * (`ensurePageAnnotations`). `signal` aborta la sesión (cierre del documento).
 */
export function startAnnotationSession(pdf: LoadedPdf, signal: AbortSignal): void {
  endAnnotationSession();
  const stop = new AbortController();
  if (signal.aborted) {
    stop.abort();
  } else {
    signal.addEventListener('abort', () => { stop.abort(); }, { once: true });
  }
  const current: Session = { pdf, stop, pending: new Map() };
  session = current;
  stack = createStack();
  memo = null;

  const lazy = pdf.numPages > SCAN_PAGE_LIMIT;
  useAnnotations.setState({
    ...initialAnnotationState(),
    ...preferenceState(prefs()),
    scan: lazy ? 'lazy' : 'scanning',
  });
  if (lazy) return;

  let nextPage = 0;
  scanAnnotations(pdf.doc, {
    signal: stop.signal,
    fallbackDate: nowIso(),
    onBatch: (pages) => {
      if (session !== current || stop.signal.aborted) return;
      mergePages(nextPage, pages);
      nextPage += pages.length;
    },
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
  stack = createStack();
  memo = null;
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
  try {
    const page = await current.pdf.doc.getPage(pageIndex + 1);
    const imported = await readPageAnnotations(page, nowIso());
    if (session !== current || current.stop.signal.aborted) return;
    mergePages(pageIndex, [imported]);
  } catch (cause) {
    log.warn('ensurePageAnnotations', cause);
  }
}

/** Fusiona páginas importadas (desde `from`, en orden) en la línea base y sube la versión de las que tienen anotaciones. */
function mergePages(from: number, pages: readonly ImportedPage[]): void {
  useAnnotations.setState((s) => {
    const baseline = new Map(s.baseline);
    const foreign = new Map<string, ForeignAnnotation>(s.foreign);
    const importedPages = new Set(s.importedPages);
    const pageVersion = new Map(s.pageVersion);
    pages.forEach((page, i) => {
      const index = from + i;
      importedPages.add(index);
      for (const a of page.supported) baseline.set(a.id, a);
      for (const f of page.foreign) foreign.set(f.id, f);
      if (page.supported.length > 0 || page.foreign.length > 0) {
        pageVersion.set(index, (pageVersion.get(index) ?? 0) + 1);
      }
    });
    return { baseline, foreign, importedPages, pageVersion, scanProgress: importedPages.size };
  });
}

export function newAnnotationId(): string {
  return `suite-${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Ejecuta un cambio sobre la pila y publica el resultado en el store. */
function apply(change: () => void): void {
  const before = stack.doc;
  change();
  publish(before);
}

/** Publica en el store el documento de la pila y sube la versión de las páginas que han cambiado. */
function publish(before: AnnotationEdits): void {
  const after = stack.doc;
  const { baseline } = useAnnotations.getState();
  const pages = changedPages(baseline, before, after);
  useAnnotations.setState((s) => {
    const pageVersion = new Map(s.pageVersion);
    for (const index of pages) pageVersion.set(index, (pageVersion.get(index) ?? 0) + 1);
    return { edits: after, undo: stack.getState(), pageVersion };
  });
}

/** Páginas donde cambia alguna anotación entre dos estados (antes y después, por si se mueve de página). */
function changedPages(baseline: AnnotationState['baseline'], before: AnnotationEdits, after: AnnotationEdits): number[] {
  const ids = new Set<string>([...before.upserts.keys(), ...after.upserts.keys(), ...before.removed, ...after.removed]);
  const pages = new Set<number>();
  for (const id of ids) {
    const unchanged = before.upserts.get(id) === after.upserts.get(id) && before.removed.has(id) === after.removed.has(id);
    if (unchanged) continue;
    addPage(pages, pageOfEntry(baseline, before, id));
    addPage(pages, pageOfEntry(baseline, after, id));
  }
  return [...pages];
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

export function setTool(tool: AnnotationTool): void {
  useAnnotations.setState({ tool });
}

export function setToolColor(tool: ColorTool, color: Rgb): void {
  const colors = { ...useAnnotations.getState().colors, [tool]: color };
  prefs().set(PREF.colors, colors);
  useAnnotations.setState({ colors });
}

export function setInkWidth(width: AnnotationState['inkWidth']): void {
  prefs().set(PREF.inkWidth, width);
  useAnnotations.setState({ inkWidth: width });
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
