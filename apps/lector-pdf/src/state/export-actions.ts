import { create } from 'zustand';
import type { ExportOutcome, FileFilter } from '@suite/platform';
import { createLogger } from '@suite/shared';
import type { PDFDocumentProxy } from '../engine';
import { createPageTextSource } from '../engine/search-source';
import { renderPageImage } from '../engine/print-render';
import {
  buildTxt,
  buildZip,
  DEFAULT_EXPORT_DPI,
  estimateImagesBytes,
  EXPORT_DPIS,
  exportBaseName,
  imageFileName,
  MAX_ZIP_BYTES,
  pageTextForExport,
  txtFileName,
  zipFileName,
  type ExportFormat,
} from '../core/export/plan';
import { exportMsg } from '../ui/messages-export';
import { askChoice } from './choice';
import { showNotice } from './notice';
import { pageIndicesFor, type PrintPages } from './print-actions';
import { openPrintSource, type PrintSource } from './print-source';
import { services } from './services';
import { useViewer } from './viewer-store';

const log = createLogger('export-actions');

/** A partir de este número de páginas de imagen se pide confirmación antes de exportar. */
export const MANY_EXPORT_PAGES = 200;

/** Cada cuántas páginas de texto se cede el hilo a la interfaz. */
const TEXT_YIELD_EVERY = 50;

/** Clave de preferencia de las opciones de exportación (sin el rango, que no se recuerda). */
export const EXPORT_OPTIONS_PREF = 'export-options';

export interface ExportOptions {
  readonly format: ExportFormat;
  readonly dpi: (typeof EXPORT_DPIS)[number];
  readonly withComments: boolean;
  readonly pages: PrintPages;
  /** Solo se usa con `pages: 'range'`. Texto como «1-3, 5». */
  readonly range: string;
}

/** Resultado de `startExport`: lo que devuelve la plataforma, o `failed` si no se pudo exportar. */
export type ExportResult = ExportOutcome | 'failed';

export type ExportJobState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly done: number; readonly total: number };

const IDLE_JOB: ExportJobState = { status: 'idle' };

/** Estado de la exportación en curso. Lo lee el diálogo de progreso. */
export const useExportJob = create<{ readonly job: ExportJobState }>()(() => ({ job: IDLE_JOB }));

/** Opciones que se recuerdan entre exportaciones: todo menos el texto del rango. */
type RememberedOptions = Omit<ExportOptions, 'range'>;

const DEFAULT_OPTIONS: RememberedOptions = {
  format: 'png',
  dpi: DEFAULT_EXPORT_DPI,
  withComments: true,
  pages: 'all',
};

/** Diálogo «Exportar» (lo pinta `ui/export/ExportDialog`). */
export const useExportDialog = create<{ readonly open: boolean; readonly form: ExportOptions }>()(() => ({
  open: false,
  form: { ...DEFAULT_OPTIONS, range: '' },
}));

const PNG_FILTERS: readonly FileFilter[] = [{ name: exportMsg.png, extensions: ['png'] }];
const JPEG_FILTERS: readonly FileFilter[] = [{ name: exportMsg.jpeg, extensions: ['jpg'] }];
const ZIP_FILTERS: readonly FileFilter[] = [{ name: exportMsg.zipFilter, extensions: ['zip'] }];
const TXT_FILTERS: readonly FileFilter[] = [{ name: exportMsg.txt, extensions: ['txt'] }];

/** Abre el diálogo con las opciones recordadas. No hace nada sin documento o con una exportación en curso. */
export function openExportDialog(): void {
  const { status, permissions } = useViewer.getState();
  if (status !== 'ready') return;
  if (!permissions.copy) {
    showNotice(exportMsg.blocked);
    return;
  }
  if (useExportDialog.getState().open || useExportJob.getState().job.status !== 'idle') return;
  const saved = services().platform.prefs.get(EXPORT_OPTIONS_PREF, isRememberedOptions);
  useExportDialog.setState({ open: true, form: { ...(saved ?? DEFAULT_OPTIONS), range: '' } });
}

export function closeExportDialog(): void {
  useExportDialog.setState({ open: false });
}

export function setExportForm(patch: Partial<ExportOptions>): void {
  useExportDialog.setState((state) => ({ form: { ...state.form, ...patch } }));
}

function isRememberedOptions(value: unknown): value is RememberedOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.format === 'png' || v.format === 'jpeg' || v.format === 'txt') &&
    (typeof v.dpi === 'number' && (EXPORT_DPIS as readonly number[]).includes(v.dpi)) &&
    (v.pages === 'all' || v.pages === 'current' || v.pages === 'range') &&
    typeof v.withComments === 'boolean'
  );
}

/** Exportación en curso. Solo puede haber una. */
interface Run {
  readonly controller: AbortController;
  /** Documento temporal de las imágenes (con los cambios sin guardar): se libera al cerrar. */
  source: PrintSource | null;
  closed: boolean;
}

let activeRun: Run | null = null;

/**
 * Exporta las páginas elegidas. Imágenes: una página → un fichero; varias → un ZIP sin recomprimir.
 * Texto: el de cada página en un TXT. Devuelve el resultado; nunca lanza.
 */
export async function startExport(o: ExportOptions): Promise<ExportResult> {
  const { pdf, file, status, currentPage, permissions } = useViewer.getState();
  if (status !== 'ready' || pdf === null || file === null || activeRun !== null) return 'failed';
  if (!permissions.copy) {
    showNotice(exportMsg.blocked);
    return 'failed';
  }
  if (useExportJob.getState().job.status !== 'idle') return 'failed';

  const indices = pageIndicesFor(o, pdf.numPages, currentPage);
  if (indices === null || indices.length === 0) {
    showNotice(exportMsg.invalidRange(pdf.numPages));
    return 'failed';
  }
  rememberOptions(o);

  if (o.format !== 'txt' && indices.length > MANY_EXPORT_PAGES) {
    const answer = await askChoice<'export' | 'cancel'>({
      title: exportMsg.manyTitle,
      message: exportMsg.many(indices.length),
      options: [
        { label: exportMsg.export, value: 'export' },
        { label: exportMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (answer === 'cancel') return 'cancelled';
  }
  if (activeRun !== null) return 'failed';

  const run: Run = { controller: new AbortController(), source: null, closed: false };
  activeRun = run;
  useExportJob.setState({ job: { status: 'running', done: 0, total: indices.length } });
  try {
    const base = exportBaseName(file.name);
    if (o.format === 'txt') return await exportText(pdf.doc, indices, base, run);
    return await exportImages(o, o.format, indices, base, run);
  } catch (error: unknown) {
    if (run.controller.signal.aborted) return 'cancelled';
    log.warn('startExport', String(error));
    showNotice(exportMsg.failed);
    return 'failed';
  } finally {
    closeRun(run);
  }
}

/**
 * Cancela la exportación en curso: no se guarda nada. Con el diálogo de guardar abierto no hace nada
 * (en ese momento el estado ya está `idle`).
 */
export function cancelExport(): void {
  const run = activeRun;
  if (run === null || useExportJob.getState().job.status !== 'running') return;
  run.controller.abort();
  activeRun = null;
  useExportJob.setState({ job: IDLE_JOB });
}

async function exportImages(
  o: ExportOptions,
  format: 'png' | 'jpeg',
  indices: readonly number[],
  base: string,
  run: Run,
): Promise<ExportResult> {
  const { signal } = run.controller;
  const source = await openPrintSource();
  run.source = source;
  if (signal.aborted) return 'cancelled';
  if (source === null) {
    showNotice(exportMsg.failed);
    return 'failed';
  }
  if (!source.unsavedIncluded) showNotice(exportMsg.unsavedNotIncluded);

  const doc = source.doc;
  const sizes: { readonly widthPt: number; readonly heightPt: number }[] = [];
  for (const index of indices) sizes.push(await pageSize(doc, index));
  if (estimateImagesBytes(sizes, o.dpi) > MAX_ZIP_BYTES) {
    showNotice(exportMsg.tooBig);
    return 'failed';
  }

  const single = indices.length === 1;
  const total = doc.numPages;
  const entries: { readonly name: string; readonly bytes: Uint8Array }[] = [];
  let lowestDpi: number | null = null;
  for (const [k, index] of indices.entries()) {
    if (signal.aborted) return 'cancelled';
    const image = await renderPageImage(doc, index, {
      dpi: o.dpi,
      withComments: o.withComments,
      signal,
      type: format === 'png' ? 'image/png' : 'image/jpeg',
    });
    if (image === 'cancelled' || signal.aborted) return 'cancelled';
    if (image.dpi < o.dpi) lowestDpi = lowestDpi === null ? image.dpi : Math.min(lowestDpi, image.dpi);
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    entries.push({ name: imageFileName(base, index + 1, total, format, !single), bytes });
    useExportJob.setState({ job: { status: 'running', done: k + 1, total: indices.length } });
    await nextTask();
  }
  if (signal.aborted) return 'cancelled';

  // Antes de abrir el diálogo de guardar, la exportación deja de estar «en curso».
  useExportJob.setState({ job: IDLE_JOB });
  const notice = lowestDpi === null ? exportMsg.done : exportMsg.reduced(lowestDpi);
  const filters = format === 'png' ? PNG_FILTERS : JPEG_FILTERS;
  const first = entries[0];
  if (single && first !== undefined) return save(first.name, filters, first.bytes, notice);
  return save(zipFileName(base), ZIP_FILTERS, buildZip(entries), notice);
}

async function exportText(
  doc: PDFDocumentProxy,
  indices: readonly number[],
  base: string,
  run: Run,
): Promise<ExportResult> {
  const { signal } = run.controller;
  const textSource = createPageTextSource(doc);
  const pages: string[] = [];
  for (const [k, index] of indices.entries()) {
    if (signal.aborted) return 'cancelled';
    const items = await textSource.getPageItems(index, signal);
    pages.push(pageTextForExport(items));
    useExportJob.setState({ job: { status: 'running', done: k + 1, total: indices.length } });
    if ((k + 1) % TEXT_YIELD_EVERY === 0) await nextTask();
  }
  if (signal.aborted) return 'cancelled';

  useExportJob.setState({ job: IDLE_JOB });
  return save(txtFileName(base), TXT_FILTERS, buildTxt(pages), exportMsg.done);
}

/** Guarda con el diálogo del sistema. Solo muestra `notice` si se guardó. */
async function save(
  name: string,
  filters: readonly FileFilter[],
  bytes: Uint8Array,
  notice: string,
): Promise<ExportResult> {
  const saved = await services().platform.exportFile(name, filters, bytes);
  if (!saved.ok) {
    log.warn('exportFile', saved.error.code);
    showNotice(saved.error.message);
    return 'failed';
  }
  if (saved.value === 'cancelled') return 'cancelled';
  showNotice(notice);
  return saved.value;
}

/** Libera lo de una exportación una sola vez: el documento temporal y, si sigue activa, el estado. */
function closeRun(run: Run): void {
  if (run.closed) return;
  run.closed = true;
  if (activeRun === run) {
    activeRun = null;
    useExportJob.setState({ job: IDLE_JOB });
  }
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

function rememberOptions(o: ExportOptions): void {
  const remembered: RememberedOptions = {
    format: o.format,
    dpi: o.dpi,
    withComments: o.withComments,
    pages: o.pages,
  };
  services().platform.prefs.set(EXPORT_OPTIONS_PREF, remembered);
}

/** Cede el hilo para que la interfaz pinte entre páginas. */
function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
