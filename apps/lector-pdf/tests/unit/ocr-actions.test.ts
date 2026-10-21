// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import { err, ok } from '@suite/shared';
import { pdfError } from '../../src/core/errors';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import type { OcrEngine, OcrWordPx } from '../../src/engine/ocr';
import { createOcrEngine } from '../../src/engine/ocr';
import { pageHasText, recognizePage } from '../../src/engine/ocr-page';
import type { OcrPage } from '../../src/core/ocr/text-layer';
import { runDocOp } from '../../src/state/doc-ops';
import { useChoice } from '../../src/state/choice';
import { OCR_OPTIONS_PREF, cancelOcr, openOcrDialog, runOcr, useOcrDialog, type OcrForm } from '../../src/state/ocr-actions';
import { openPrintSource, type PrintSource } from '../../src/state/print-source';
import { buildCurrentDelta, writeDocument } from '../../src/state/save-actions';
import { initServices } from '../../src/state/services';
import { useDocOpJob } from '../../src/state/extract-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ocrMsg } from '../../src/ui/messages-ocr';
import { printMsg } from '../../src/ui/messages-print';
import { createFakePlatform } from '../helpers/fake-platform';
import type * as SaveActions from '../../src/state/save-actions';

vi.mock('../../src/engine/ocr', () => ({ createOcrEngine: vi.fn() }));
vi.mock('../../src/engine/ocr-page', () => ({ recognizePage: vi.fn(), pageHasText: vi.fn() }));
vi.mock('../../src/state/print-source', () => ({ openPrintSource: vi.fn() }));
vi.mock('../../src/state/doc-ops', () => ({ runDocOp: vi.fn() }));
vi.mock('../../src/state/save-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveActions>()),
  buildCurrentDelta: vi.fn(),
  writeDocument: vi.fn(),
}));

const SPANISH: OcrForm = { pages: 'all', range: '', lang: 'spa', skipText: false };
const WORD: OcrWordPx = { text: 'Panadería', confidence: 90, bbox: { x0: 1, y0: 2, x1: 30, y1: 12 } };

let engine: OcrEngine & { readonly terminate: ReturnType<typeof vi.fn> };
let prefs: Map<string, unknown>;
let platform: Platform;
let printSource: PrintSource;

/** Documento de `numPages` páginas: solo se usa como identidad (las pruebas no dibujan). */
function setDocument(numPages: number, currentPage = 0): void {
  const pdf = { doc: {} as PDFDocumentProxy, numPages, fingerprint: 'fake' } as unknown as LoadedPdf;
  const file: OpenedFile = {
    token: 'fake',
    name: 'escaneado.pdf',
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: true,
    source: memorySource(new Uint8Array([1, 2, 3])),
  };
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf, currentPage });
}

function page(index: number, words: readonly OcrWordPx[] = [WORD]): OcrPage {
  return { pageIndex: index, rotate: 0, words: words.map((w) => ({ text: w.text, box: [0, 0, 1, 1] })) };
}

function noticeText(): string | undefined {
  return useViewer.getState().notice?.text;
}

beforeEach(() => {
  prefs = new Map();
  platform = createFakePlatform({
    prefs: {
      get: (key: string, guard: (value: unknown) => boolean) => {
        const value = prefs.get(key);
        return value !== undefined && guard(value) ? value : null;
      },
      set: (key: string, value: unknown) => { prefs.set(key, value); },
      remove: (key: string) => { prefs.delete(key); },
    } as Platform['prefs'],
  });
  initServices({ platform, assetBaseUrl: '/' });

  engine = {
    recognize: vi.fn(() => Promise.resolve([WORD])),
    terminate: vi.fn(() => Promise.resolve()),
  } as unknown as typeof engine;
  vi.mocked(createOcrEngine).mockResolvedValue(engine);
  vi.mocked(recognizePage).mockImplementation((_doc, index) => Promise.resolve(page(index)));
  vi.mocked(pageHasText).mockResolvedValue(false);

  printSource = {
    doc: {} as PDFDocumentProxy,
    temporary: false,
    unsavedIncluded: true,
    dispose: vi.fn(() => Promise.resolve()),
  };
  vi.mocked(openPrintSource).mockResolvedValue(printSource);
  vi.mocked(buildCurrentDelta).mockResolvedValue(ok(null));
  vi.mocked(writeDocument).mockResolvedValue('saved');
  vi.mocked(runDocOp).mockResolvedValue(ok({ delta: new Uint8Array([9, 9]) }));
  useOcrDialog.setState({ open: false });
  useDocOpJob.setState({ label: null, done: 0, total: 0, progressText: null });
});

afterEach(() => {
  vi.clearAllMocks();
  useViewer.setState(initialViewerState);
  useChoice.setState({ active: null });
});

describe('runOcr', () => {
  it('reconoce todas las páginas y escribe la capa como incremento', async () => {
    setDocument(3);
    vi.mocked(buildCurrentDelta).mockResolvedValue(ok(new Uint8Array([7])));

    const result = await runOcr(SPANISH);

    expect(result).toBe('saved');
    expect(createOcrEngine).toHaveBeenCalledWith('spa', new URL('./', document.baseURI).href);
    expect(recognizePage).toHaveBeenCalledTimes(3);
    expect(runDocOp).toHaveBeenCalledWith('ocr-layer', expect.objectContaining({ pages: [page(0), page(1), page(2)] }), expect.any(Array), expect.any(Object));
    // Cambios sin guardar primero, después la capa.
    const write = vi.mocked(writeDocument).mock.calls[0]?.[0];
    expect(write).toEqual({ kind: 'append', delta: new Uint8Array([7, 9, 9]) });
    expect(noticeText()).toBe(ocrMsg.done(3));
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(printSource.dispose).toHaveBeenCalledTimes(1);
    expect(useDocOpJob.getState().label).toBeNull();
  });

  it('con la página actual solo reconoce esa página', async () => {
    setDocument(4, 2);

    await runOcr({ ...SPANISH, pages: 'current' });

    expect(recognizePage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recognizePage).mock.calls[0]?.[1]).toBe(2);
  });

  it('con «Omitir páginas que ya tienen texto» no reconoce las que tienen texto', async () => {
    setDocument(3);
    vi.mocked(pageHasText).mockImplementation((_doc, index) => Promise.resolve(index === 1));

    await runOcr({ ...SPANISH, skipText: true });

    expect(vi.mocked(recognizePage).mock.calls.map((call) => call[1])).toEqual([0, 2]);
  });

  it('si todas las páginas elegidas ya tienen texto, avisa y no hace nada más', async () => {
    setDocument(2);
    vi.mocked(pageHasText).mockResolvedValue(true);

    const result = await runOcr({ ...SPANISH, skipText: true });

    expect(result).toBe('nothing');
    expect(noticeText()).toBe(ocrMsg.allHaveText);
    expect(createOcrEngine).not.toHaveBeenCalled();
    expect(writeDocument).not.toHaveBeenCalled();
  });

  it('sin ninguna palabra reconocida avisa y no escribe nada', async () => {
    setDocument(2);
    vi.mocked(recognizePage).mockImplementation((_doc, index) => Promise.resolve(page(index, [])));

    const result = await runOcr(SPANISH);

    expect(result).toBe('nothing');
    expect(noticeText()).toBe(ocrMsg.nothing);
    expect(writeDocument).not.toHaveBeenCalled();
    expect(runDocOp).not.toHaveBeenCalled();
  });

  it('un motor que falla muestra un aviso en español y no escribe nada', async () => {
    setDocument(2);
    vi.mocked(recognizePage).mockRejectedValue(new Error('worker caído'));

    const result = await runOcr(SPANISH);

    expect(result).toBe('failed');
    expect(noticeText()).toBe(ocrMsg.failed);
    expect(writeDocument).not.toHaveBeenCalled();
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(useDocOpJob.getState().label).toBeNull();
  });

  it('cancelar a mitad no guarda nada y libera el motor', async () => {
    setDocument(3);
    vi.mocked(recognizePage).mockImplementation((_doc, index, _engine, signal) => {
      if (index === 1) cancelOcr();
      return Promise.resolve(signal.aborted ? 'cancelled' : page(index));
    });

    const result = await runOcr(SPANISH);

    expect(result).toBe('cancelled');
    expect(recognizePage).toHaveBeenCalledTimes(2);
    expect(writeDocument).not.toHaveBeenCalled();
    expect(engine.terminate).toHaveBeenCalledTimes(1);
  });

  it('más de 50 páginas pide confirmación; cancelar no reconoce nada', async () => {
    setDocument(60);
    const running = runOcr(SPANISH);

    await vi.waitFor(() => { expect(useChoice.getState().active).not.toBeNull(); });
    expect(useChoice.getState().active?.message).toBe(ocrMsg.many(60));
    useChoice.getState().active?.dismiss();

    expect(await running).toBe('cancelled');
    expect(recognizePage).not.toHaveBeenCalled();
  });

  it('un rango no válido avisa con el texto de páginas y no empieza', async () => {
    setDocument(3);

    const result = await runOcr({ ...SPANISH, pages: 'range', range: '9' });

    expect(result).toBe('failed');
    expect(noticeText()).toBe(printMsg.invalidRange(3));
    expect(createOcrEngine).not.toHaveBeenCalled();
  });

  it('si el delta de la capa falla, muestra el motivo y no escribe', async () => {
    setDocument(1);
    vi.mocked(runDocOp).mockResolvedValue(err(pdfError('corrupt')));

    const result = await runOcr(SPANISH);

    expect(result).toBe('failed');
    expect(noticeText()).toBe(pdfError('corrupt').message);
    expect(writeDocument).not.toHaveBeenCalled();
  });
});

describe('openOcrDialog', () => {
  it('recuerda idioma y omitir, pero no las páginas', () => {
    setDocument(3);
    prefs.set(OCR_OPTIONS_PREF, { lang: 'eng', skipText: false });

    openOcrDialog();

    expect(useOcrDialog.getState()).toMatchObject({ open: true, form: { lang: 'eng', skipText: false, pages: 'all', range: '' } });
  });

  it('sin documento no abre nada', () => {
    openOcrDialog();

    expect(useOcrDialog.getState().open).toBe(false);
  });
});
