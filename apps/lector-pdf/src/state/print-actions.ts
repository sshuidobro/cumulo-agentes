import { create } from 'zustand';
import type { PDFDocumentProxy } from '../engine';
import { createLogger } from '@suite/shared';
import { planPage, PRINT_DPI, sheetFor, type PagePrintPlan } from '../core/print/plan';
import { parsePageRange } from '../core/print/range';
import { renderPageForPrint } from '../engine/print-render';
import { printMsg } from '../ui/messages-print';
import { askChoice } from './choice';
import { showNotice } from './notice';
import { services } from './services';
import { openPrintSource, type PrintSource } from './print-source';
import { useViewer } from './viewer-store';

const log = createLogger('print-actions');

/** A partir de este número de páginas se pide confirmación antes de preparar la impresión (PDF-044). */
export const MANY_PAGES = 500;

/** Clave de preferencia de las opciones de impresión (sin el rango, que no se recuerda). */
export const PRINT_OPTIONS_PREF = 'printOptions';

export type PrintPages = 'all' | 'current' | 'range';

export interface PrintOptions {
  readonly pages: PrintPages;
  /** Solo se usa con `pages: 'range'`. Texto como «1-3, 5». */
  readonly range: string;
  readonly withComments: boolean;
  readonly autoRotate: boolean;
  readonly highQuality: boolean;
}

export type PrintJobState =
  | { readonly status: 'idle' }
  | { readonly status: 'preparing'; readonly done: number; readonly total: number }
  | { readonly status: 'ready' };

/** Hoja lista para imprimir: URL del PNG de la página y giro (90° si la orientación automática lo pide). */
export interface PrintSheet {
  readonly url: string;
  readonly rotate: 0 | 90;
}

/** Tamaño de la hoja en puntos (el de la primera página del rango). */
export interface SheetSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

/** Resultado de `startPrint`. */
export type PrintOutcome = 'printed' | 'cancelled' | 'failed';

interface PrintJobStore {
  readonly job: PrintJobState;
  readonly sheets: readonly PrintSheet[];
  /** Tamaño de todas las hojas; `null` fuera de una impresión. */
  readonly sheet: SheetSize | null;
  /** Regla `@page` del documento de impresión; `null` fuera de una impresión. */
  readonly pageCss: string | null;
}

const IDLE: PrintJobStore = { job: { status: 'idle' }, sheets: [], sheet: null, pageCss: null };

/** Estado de la impresión en curso. Lo leen el diálogo de progreso y el contenedor de impresión. */
export const usePrintJob = create<PrintJobStore>()(() => IDLE);

/** Opciones que se recuerdan entre impresiones: todo menos el texto del rango. */
type RememberedOptions = Omit<PrintOptions, 'range'>;

const DEFAULT_OPTIONS: RememberedOptions = { pages: 'all', withComments: true, autoRotate: true, highQuality: false };

/** Campos del formulario del diálogo: los mismos que las opciones de impresión. */
export type PrintDialogForm = PrintOptions;

/** Diálogo «Imprimir» (lo pinta `ui/print/PrintDialog`). */
export const usePrintDialog = create<{ readonly open: boolean; readonly form: PrintDialogForm }>()(() => ({
  open: false,
  form: { ...DEFAULT_OPTIONS, range: '' },
}));

/** Abre el diálogo con las opciones recordadas. No hace nada sin documento o con una impresión en curso. */
export function openPrintDialog(): void {
  if (useViewer.getState().status !== 'ready') return;
  if (usePrintDialog.getState().open || usePrintJob.getState().job.status !== 'idle') return;
  const saved = services().platform.prefs.get(PRINT_OPTIONS_PREF, isRememberedOptions);
  usePrintDialog.setState({ open: true, form: { ...(saved ?? DEFAULT_OPTIONS), range: '' } });
}

export function closePrintDialog(): void {
  usePrintDialog.setState({ open: false });
}

export function setPrintForm(patch: Partial<PrintDialogForm>): void {
  usePrintDialog.setState((state) => ({ form: { ...state.form, ...patch } }));
}

function isRememberedOptions(value: unknown): value is RememberedOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.pages === 'all' || v.pages === 'current' || v.pages === 'range') &&
    typeof v.withComments === 'boolean' &&
    typeof v.autoRotate === 'boolean' &&
    typeof v.highQuality === 'boolean'
  );
}

/**
 * Índices 0-based de las páginas que imprime `o`, ordenados y sin repetir; `null` si el rango no es válido.
 * `currentPage` también es 0-based.
 */
export function pageIndicesFor(
  o: Pick<PrintOptions, 'pages' | 'range'>,
  numPages: number,
  currentPage: number,
): readonly number[] | null {
  if (o.pages === 'all') return Array.from({ length: numPages }, (_, index) => index);
  if (o.pages === 'current') return currentPage >= 0 && currentPage < numPages ? [currentPage] : null;
  return parsePageRange(o.range, numPages);
}

/** Impresión en curso. Solo puede haber una. */
interface Run {
  readonly controller: AbortController;
  /** URL de blob de las hojas creadas: se revocan al cerrar la impresión. */
  readonly urls: string[];
  source: PrintSource | null;
  closed: boolean;
}

let activeRun: Run | null = null;

/**
 * Prepara las páginas y abre el diálogo de impresión del sistema. Imprime lo que se guardaría (con los
 * cambios sin guardar, si se puede). Con más de MANY_PAGES páginas pide confirmación antes.
 */
export async function startPrint(o: PrintOptions): Promise<PrintOutcome> {
  const { pdf, file, status, currentPage } = useViewer.getState();
  if (status !== 'ready' || pdf === null || file === null || activeRun !== null) return 'failed';
  if (usePrintJob.getState().job.status !== 'idle') return 'failed';

  const indices = pageIndicesFor(o, pdf.numPages, currentPage);
  if (indices === null || indices.length === 0) {
    showNotice(printMsg.invalidRange(pdf.numPages));
    return 'failed';
  }
  rememberOptions(o);

  if (indices.length > MANY_PAGES) {
    const answer = await askChoice<'print' | 'cancel'>({
      title: printMsg.manyTitle,
      message: printMsg.manyPages(indices.length),
      options: [
        { label: printMsg.print, value: 'print' },
        { label: printMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (answer === 'cancel') return 'cancelled';
  }
  if (activeRun !== null) return 'failed';

  const run: Run = { controller: new AbortController(), urls: [], source: null, closed: false };
  activeRun = run;
  usePrintJob.setState({ job: { status: 'preparing', done: 0, total: indices.length } });
  try {
    return await prepareAndPrint(o, indices, run);
  } catch (error: unknown) {
    log.warn('startPrint', String(error));
    showNotice(printMsg.failed);
    return 'failed';
  } finally {
    closeRun(run);
  }
}

/**
 * Cancela la preparación en curso: revoca lo creado cuando termina el bucle de render. Durante la
 * preparación el estado vuelve a `idle` de inmediato. Con el diálogo del sistema abierto no hace nada.
 */
export function cancelPrint(): void {
  const run = activeRun;
  if (run === null || usePrintJob.getState().job.status !== 'preparing') return;
  run.controller.abort();
  activeRun = null;
  usePrintJob.setState(IDLE);
}

async function prepareAndPrint(o: PrintOptions, indices: readonly number[], run: Run): Promise<PrintOutcome> {
  const { signal } = run.controller;
  const source = await openPrintSource();
  run.source = source;
  if (signal.aborted) return 'cancelled';
  if (source === null) {
    showNotice(printMsg.noDocument);
    return 'failed';
  }
  if (!source.unsavedIncluded) showNotice(printMsg.unsavedNotIncluded);

  const doc = source.doc;
  const first = indices[0];
  if (first === undefined) return 'failed';
  const sheet = sheetFor(await pageSize(doc, first));
  const pageRule = `@page { size: ${String(sheet.sheetWidthPt)}pt ${String(sheet.sheetHeightPt)}pt; margin: 0 }`;
  const dpi = o.highQuality ? PRINT_DPI.high : PRINT_DPI.normal;

  const sheets: PrintSheet[] = [];
  for (const [k, index] of indices.entries()) {
    if (signal.aborted) return 'cancelled';
    const plan: PagePrintPlan = planPage(await pageSize(doc, index), sheet, o.autoRotate);
    const blob = await renderPageForPrint(doc, index, { dpi, withComments: o.withComments, signal });
    if (blob === 'cancelled' || signal.aborted) return 'cancelled';
    const url = URL.createObjectURL(blob);
    run.urls.push(url);
    sheets.push({ url, rotate: plan.rotate });
    usePrintJob.setState({ job: { status: 'preparing', done: k + 1, total: indices.length } });
    await nextTask();
  }
  if (signal.aborted) return 'cancelled';

  const sheetSize: SheetSize = { widthPt: sheet.sheetWidthPt, heightPt: sheet.sheetHeightPt };
  usePrintJob.setState({ job: { status: 'ready' }, sheets, sheet: sheetSize, pageCss: pageRule });
  // Antes de abrir el diálogo, React tiene que haber pintado el contenedor y las imágenes deben estar listas.
  await nextTask();
  await decodeSheets();

  // Con el diálogo del sistema abierto, lo creado se libera al cerrarse (o al volver `print()`).
  const onAfterPrint = (): void => {
    closeRun(run);
  };
  window.addEventListener('afterprint', onAfterPrint, { once: true });
  try {
    const printed = await services().platform.print();
    if (!printed.ok) {
      log.warn('print', printed.error.code);
      showNotice(printMsg.failed);
      return 'failed';
    }
    return 'printed';
  } finally {
    window.removeEventListener('afterprint', onAfterPrint);
  }
}

/** Libera lo de una impresión una sola vez: URL de las hojas, documento temporal y, si sigue activa, el estado. */
function closeRun(run: Run): void {
  if (run.closed) return;
  run.closed = true;
  if (activeRun === run) {
    activeRun = null;
    usePrintJob.setState(IDLE);
  }
  for (const url of run.urls.splice(0)) URL.revokeObjectURL(url);
  const source = run.source;
  run.source = null;
  if (source !== null) {
    source.dispose().catch((error: unknown) => {
      log.warn('dispose', String(error));
    });
  }
}

/** Tamaño de la página `index` (0-based) ya girada según /Rotate, en puntos. */
async function pageSize(doc: PDFDocumentProxy, index: number): Promise<{ readonly widthPt: number; readonly heightPt: number }> {
  const page = await doc.getPage(index + 1);
  try {
    const viewport = page.getViewport({ scale: 1 });
    return { widthPt: viewport.width, heightPt: viewport.height };
  } finally {
    page.cleanup();
  }
}

function rememberOptions(o: PrintOptions): void {
  const remembered: RememberedOptions = {
    pages: o.pages,
    withComments: o.withComments,
    autoRotate: o.autoRotate,
    highQuality: o.highQuality,
  };
  services().platform.prefs.set(PRINT_OPTIONS_PREF, remembered);
}

/** Cede el hilo para que la interfaz pinte entre páginas. */
function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Espera a que las imágenes de las hojas estén decodificadas para que la impresión no salga en blanco. */
async function decodeSheets(): Promise<void> {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('#print-container img'));
  await Promise.all(images.map((image) => Promise.resolve().then(() => image.decode()).catch(() => undefined)));
}
