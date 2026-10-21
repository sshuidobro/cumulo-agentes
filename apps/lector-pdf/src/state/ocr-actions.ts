import { create } from 'zustand';
import { createLogger, type AppError } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import type { OcrPage } from '../core/ocr/text-layer';
import { concatSource } from '../core/pdf/concat-source';
import { pageIndicesFor } from './print-actions';
import { nowIso } from './annotation-actions';
import { askChoice } from './choice';
import { currentPassword } from './document-actions';
import { runDocOp } from './doc-ops';
import { beginJob, cancelDocOp, endJob, jobOptions, useDocOpJob } from './extract-actions';
import { showNotice } from './notice';
import { openPrintSource, type PrintSource } from './print-source';
import { buildCurrentDelta, writeDocument, type SaveResult } from './save-actions';
import { services } from './services';
import { useViewer } from './viewer-store';
import type { OcrEngine, OcrLanguage } from '../engine/ocr';
import type { PDFDocumentProxy } from '../engine/pdfjs';
import { ocrMsg } from '../ui/messages-ocr';
import { printMsg } from '../ui/messages-print';

const log = createLogger('ocr-actions');

/** A partir de este número de páginas a reconocer se pide confirmación. */
export const MANY_OCR_PAGES = 50;

/** Clave de preferencia: idioma y «omitir páginas con texto» (no las páginas ni el rango). */
export const OCR_OPTIONS_PREF = 'ocr-options';

export interface OcrForm {
  readonly pages: 'all' | 'current' | 'range';
  readonly range: string;
  readonly lang: OcrLanguage;
  readonly skipText: boolean;
}

type RememberedOcr = Pick<OcrForm, 'lang' | 'skipText'>;

const DEFAULT_FORM: OcrForm = { pages: 'all', range: '', lang: 'spa', skipText: true };

/** Diálogo «Reconocer texto» (lo pinta `ui/ocr/OcrDialog`). */
export const useOcrDialog = create<{ readonly open: boolean; readonly form: OcrForm }>()(() => ({
  open: false,
  form: DEFAULT_FORM,
}));

/** Abre el diálogo con las preferencias recordadas. No hace nada sin documento o con otra operación en curso. */
export function openOcrDialog(): void {
  const { status, pdf } = useViewer.getState();
  if (status !== 'ready' || pdf === null) return;
  if (useOcrDialog.getState().open || useDocOpJob.getState().label !== null) return;
  const saved = services().platform.prefs.get(OCR_OPTIONS_PREF, isRememberedOcr);
  useOcrDialog.setState({ open: true, form: { ...DEFAULT_FORM, ...(saved ?? {}), pages: 'all', range: '' } });
}

export function closeOcrDialog(): void {
  useOcrDialog.setState({ open: false });
}

export function setOcrForm(patch: Partial<OcrForm>): void {
  useOcrDialog.setState((state) => ({ form: { ...state.form, ...patch } }));
}

function isRememberedOcr(value: unknown): value is RememberedOcr {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.lang === 'spa' || v.lang === 'eng' || v.lang === 'spa+eng') && typeof v.skipText === 'boolean';
}

/** Cancela el reconocimiento en curso: no se guarda nada. */
export function cancelOcr(): void {
  cancelDocOp();
}

/**
 * Reconoce las páginas elegidas y escribe la capa de texto invisible en el documento abierto (PDF-061).
 * Devuelve el resultado; nunca lanza.
 */
export async function runOcr(form: OcrForm): Promise<SaveResult> {
  const { status, file, pdf, currentPage } = useViewer.getState();
  if (status !== 'ready' || file === null || pdf === null) return 'failed';
  if (useDocOpJob.getState().label !== null) return 'failed';

  const indices = pageIndicesFor(form, pdf.numPages, currentPage);
  if (indices === null || indices.length === 0) {
    showNotice(printMsg.invalidRange(pdf.numPages));
    return 'failed';
  }
  rememberOptions(form);

  let targets: readonly number[];
  try {
    targets = form.skipText ? await withoutText(pdf.doc, indices) : indices;
  } catch (error: unknown) {
    log.warn('runOcr', String(error));
    showNotice(ocrMsg.failed);
    return 'failed';
  }
  if (targets.length === 0) {
    showNotice(ocrMsg.allHaveText);
    return 'nothing';
  }

  if (targets.length > MANY_OCR_PAGES) {
    const answer = await askChoice<'run' | 'cancel'>({
      title: ocrMsg.manyTitle,
      message: ocrMsg.many(targets.length),
      options: [
        { label: ocrMsg.run, value: 'run' },
        { label: ocrMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (answer === 'cancel') return 'cancelled';
  }

  const controller = beginJob(ocrMsg.title, ocrMsg.progress);
  if (controller === null) return 'failed';
  try {
    return await recognizeAndWrite(file, targets, form.lang, controller);
  } catch (error: unknown) {
    if (controller.signal.aborted) return 'cancelled';
    log.warn('runOcr', String(error));
    showNotice(ocrMsg.failed);
    return 'failed';
  } finally {
    endJob(controller);
  }
}

/** Páginas de `indices` que no tienen ningún carácter en su capa de texto. */
async function withoutText(doc: PDFDocumentProxy, indices: readonly number[]): Promise<readonly number[]> {
  const { pageHasText } = await import('../engine/ocr-page');
  const found: number[] = [];
  for (const index of indices) {
    if (!(await pageHasText(doc, index))) found.push(index);
  }
  return found;
}

async function recognizeAndWrite(
  file: OpenedFile,
  targets: readonly number[],
  lang: OcrLanguage,
  controller: AbortController,
): Promise<SaveResult> {
  const { signal } = controller;
  // Dibujo de las páginas con los cambios sin guardar. Si no se pueden incluir, la capa no casaría con la imagen.
  const source = await openPrintSource();
  if (source === null || !source.unsavedIncluded) {
    if (source !== null) disposeSource(source);
    showNotice(ocrMsg.failed);
    return 'failed';
  }
  try {
    const { createOcrEngine } = await import('../engine/ocr');
    // Los recursos del OCR van en la raíz de la app (`ocr/`), no en la carpeta de pdf.js (`assetBaseUrl`).
    const engine = await createOcrEngine(lang, new URL('./', document.baseURI).href);
    let pages: readonly OcrPage[] | 'cancelled';
    try {
      pages = await recognizeAll(source, targets, engine, controller);
    } finally {
      await terminate(engine);
    }
    if (pages === 'cancelled' || signal.aborted) return 'cancelled';
    if (pages.length === 0) {
      showNotice(ocrMsg.nothing);
      return 'nothing';
    }

    // Los cambios sin guardar van delante: la capa se escribe sobre el mismo documento que se ha reconocido.
    const built = await buildCurrentDelta(file);
    if (!built.ok) return fail(built.error);
    const prefix = built.value ?? new Uint8Array(0);

    const result = await runDocOp<{ readonly delta: Uint8Array }>(
      'ocr-layer',
      { password: currentPassword(), pages, now: nowIso() },
      [concatSource(file.source, prefix)],
      jobOptions(controller),
    );
    if (signal.aborted) return 'cancelled';
    if (!result.ok) return fail(result.error);

    // Antes de abrir el guardado, la operación deja de estar «en curso».
    endJob(controller);
    const saved = await writeDocument({ kind: 'append', delta: concatBytes(prefix, result.value.delta) });
    if (saved === 'saved' || saved === 'downloaded') showNotice(ocrMsg.done(pages.length));
    return saved;
  } finally {
    disposeSource(source);
  }
}

/** Reconoce cada página en orden. Las que no tienen palabras no se incluyen en el resultado. */
async function recognizeAll(
  source: PrintSource,
  targets: readonly number[],
  engine: OcrEngine,
  controller: AbortController,
): Promise<readonly OcrPage[] | 'cancelled'> {
  const { recognizePage } = await import('../engine/ocr-page');
  const { signal } = controller;
  const pages: OcrPage[] = [];
  for (const [k, index] of targets.entries()) {
    if (signal.aborted) return 'cancelled';
    useDocOpJob.setState({ done: k, total: targets.length });
    const page = await recognizePage(source.doc, index, engine, signal);
    if (page === 'cancelled' || signal.aborted) return 'cancelled';
    if (page.words.length > 0) pages.push(page);
    await nextTask();
  }
  return pages;
}

function fail(error: AppError): SaveResult {
  log.warn('ocr', error.code);
  showNotice(error.message);
  return 'failed';
}

function rememberOptions(form: OcrForm): void {
  const remembered: RememberedOcr = { lang: form.lang, skipText: form.skipText };
  services().platform.prefs.set(OCR_OPTIONS_PREF, remembered);
}

function disposeSource(source: PrintSource): void {
  source.dispose().catch((error: unknown) => {
    log.warn('dispose', String(error));
  });
}

async function terminate(engine: OcrEngine): Promise<void> {
  try {
    await engine.terminate();
  } catch (error: unknown) {
    log.warn('terminate', String(error));
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Cede el hilo para que la interfaz pinte entre páginas. */
function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
