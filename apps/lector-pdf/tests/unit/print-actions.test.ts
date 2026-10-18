// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import { renderPageForPrint } from '../../src/engine/print-render';
import { useChoice } from '../../src/state/choice';
import {
  cancelPrint,
  closePrintDialog,
  openPrintDialog,
  pageIndicesFor,
  PRINT_OPTIONS_PREF,
  startPrint,
  usePrintDialog,
  usePrintJob,
  type PrintJobState,
  type PrintOptions,
} from '../../src/state/print-actions';
import { openPrintSource, type PrintSource } from '../../src/state/print-source';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/engine/print-render', () => ({ renderPageForPrint: vi.fn() }));
vi.mock('../../src/state/print-source', () => ({ openPrintSource: vi.fn() }));

/** Página de prueba: tamaño en puntos. */
interface PageSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

/** Documento de prueba: solo `numPages`, `getPage` (con su tamaño) y `cleanup`. */
function fakeDoc(sizes: readonly PageSize[]): PDFDocumentProxy {
  return {
    numPages: sizes.length,
    getPage: (pageNumber: number) => {
      const size = sizes[pageNumber - 1];
      if (size === undefined) return Promise.reject(new Error(`no hay página ${String(pageNumber)}`));
      return Promise.resolve({
        getViewport: () => ({ width: size.widthPt, height: size.heightPt }),
        cleanup: () => true,
      });
    },
  } as unknown as PDFDocumentProxy;
}

function setDocument(sizes: readonly PageSize[], currentPage = 0): void {
  const pdf = { doc: fakeDoc(sizes), numPages: sizes.length, fingerprint: 'fake' } as unknown as LoadedPdf;
  const file: OpenedFile = {
    token: 'fake',
    name: 'informe.pdf',
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: false,
    source: memorySource(new Uint8Array(0)),
  };
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf, currentPage });
  // El documento temporal de impresión (openPrintSource) tiene las mismas páginas que el abierto.
  source = { ...source, doc: fakeDoc(sizes) };
  vi.mocked(openPrintSource).mockResolvedValue(source);
}

const PORTRAIT: PageSize = { widthPt: 595, heightPt: 842 };
const LANDSCAPE: PageSize = { widthPt: 842, heightPt: 595 };

const OPTIONS: PrintOptions = { pages: 'all', range: '', withComments: true, autoRotate: true, highQuality: false };

let prefs: Map<string, unknown>;
let platform: Platform;
let print: ReturnType<typeof vi.fn>;
let source: PrintSource;
let urls: string[];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  prefs = new Map();
  urls = [];
  print = vi.fn(async () => ({ ok: true, value: undefined }));
  platform = createFakePlatform({
    prefs: {
      get: (key: string, guard: (value: unknown) => boolean) => {
        const value = prefs.get(key);
        return value !== undefined && guard(value) ? value : null;
      },
      set: (key: string, value: unknown) => { prefs.set(key, value); },
      remove: (key: string) => { prefs.delete(key); },
    } as Platform['prefs'],
    print: print as unknown as Platform['print'],
  });
  initServices({ platform, assetBaseUrl: '/' });
  let counter = 0;
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => {
    counter += 1;
    const url = `blob:print-${String(counter)}`;
    urls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    urls = urls.filter((u) => u !== url);
  });
  source = {
    doc: fakeDoc([PORTRAIT]),
    temporary: false,
    unsavedIncluded: true,
    dispose: vi.fn(() => Promise.resolve()),
  };
  vi.mocked(openPrintSource).mockResolvedValue(source);
  vi.mocked(renderPageForPrint).mockImplementation(() => Promise.resolve(new Blob(['png'], { type: 'image/png' })));
  usePrintJob.setState({ job: { status: 'idle' }, sheets: [], sheet: null, pageCss: null });
  usePrintDialog.setState({ open: false });
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.clearAllMocks();
  useViewer.setState(initialViewerState);
  useChoice.setState({ active: null });
  document.body.innerHTML = '';
});

describe('pageIndicesFor', () => {
  it('todas, la actual o un rango (índices 0-based)', () => {
    expect(pageIndicesFor({ pages: 'all', range: '' }, 3, 0)).toEqual([0, 1, 2]);
    expect(pageIndicesFor({ pages: 'current', range: '' }, 3, 2)).toEqual([2]);
    expect(pageIndicesFor({ pages: 'range', range: '2-3, 1' }, 5, 0)).toEqual([0, 1, 2]);
  });

  it('rango no válido o página actual fuera de rango dan null', () => {
    expect(pageIndicesFor({ pages: 'range', range: '0' }, 5, 0)).toBeNull();
    expect(pageIndicesFor({ pages: 'range', range: '1-9999' }, 5, 0)).toBeNull();
    expect(pageIndicesFor({ pages: 'current', range: '' }, 0, 0)).toBeNull();
  });
});

describe('startPrint', () => {
  it('imprime el rango: una hoja por página, el diálogo del sistema una vez y todo liberado al terminar', async () => {
    setDocument([PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT]);
    const jobs: PrintJobState[] = [];
    const unsubscribe = usePrintJob.subscribe((state) => { jobs.push(state.job); });

    const outcome = await startPrint({ ...OPTIONS, pages: 'range', range: '2-4' });
    unsubscribe();

    expect(outcome).toBe('printed');
    expect(vi.mocked(renderPageForPrint).mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
    expect(print).toHaveBeenCalledTimes(1);
    expect(jobs).toContainEqual({ status: 'preparing', done: 3, total: 3 });
    expect(jobs).toContainEqual({ status: 'ready' });
    expect(urls).toEqual([]);
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(source.dispose)).toHaveBeenCalledTimes(1);
    expect(usePrintJob.getState()).toMatchObject({ job: { status: 'idle' }, sheets: [], sheet: null, pageCss: null });
  });

  it('la regla @page usa el tamaño de la primera página del rango', async () => {
    setDocument([LANDSCAPE, PORTRAIT]);
    let cssDuringPrint: string | null = null;
    print.mockImplementationOnce(() => {
      cssDuringPrint = usePrintJob.getState().pageCss;
      return Promise.resolve({ ok: true, value: undefined });
    });

    await startPrint({ ...OPTIONS });

    expect(cssDuringPrint).toBe('@page { size: 842pt 595pt; margin: 0 }');
  });

  it('gira la hoja solo con orientación automática y con la orientación contraria a la de la hoja', async () => {
    setDocument([PORTRAIT, LANDSCAPE]);
    let sheetsDuringPrint: readonly { readonly rotate: number }[] = [];
    print.mockImplementationOnce(() => {
      sheetsDuringPrint = usePrintJob.getState().sheets;
      return Promise.resolve({ ok: true, value: undefined });
    });

    await startPrint({ ...OPTIONS, autoRotate: true });
    expect(sheetsDuringPrint.map((s) => s.rotate)).toEqual([0, 90]);

    setDocument([PORTRAIT, LANDSCAPE]);
    print.mockImplementationOnce(() => {
      sheetsDuringPrint = usePrintJob.getState().sheets;
      return Promise.resolve({ ok: true, value: undefined });
    });
    await startPrint({ ...OPTIONS, autoRotate: false });
    expect(sheetsDuringPrint.map((s) => s.rotate)).toEqual([0, 0]);
  });

  it('pasa a pdf.js las opciones de comentarios y calidad (300 ppp en alta calidad)', async () => {
    setDocument([PORTRAIT]);
    await startPrint({ ...OPTIONS, withComments: false, highQuality: true });
    const options = vi.mocked(renderPageForPrint).mock.calls[0]?.[2];
    expect(options).toMatchObject({ withComments: false, dpi: 300 });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('con «Página actual» imprime solo esa página (la 3, índice 2)', async () => {
    setDocument([PORTRAIT, PORTRAIT, PORTRAIT], 2);
    await startPrint({ ...OPTIONS, pages: 'current' });
    expect(vi.mocked(renderPageForPrint).mock.calls.map((call) => call[1])).toEqual([2]);
  });

  it('un rango no válido no prepara nada y avisa con el resultado «failed»', async () => {
    setDocument([PORTRAIT, PORTRAIT]);
    const outcome = await startPrint({ ...OPTIONS, pages: 'range', range: '1-9999' });
    expect(outcome).toBe('failed');
    expect(renderPageForPrint).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it('más de 500 páginas pide confirmación; «Cancelar» no imprime', async () => {
    const sizes = Array.from({ length: 501 }, () => PORTRAIT);
    setDocument(sizes);
    const started = startPrint({ ...OPTIONS });
    const choice = useChoice.getState().active;
    expect(choice?.message).toBe('Vas a imprimir 501 páginas. Prepararlas puede tardar varios minutos.');
    choice?.options[1]?.pick();

    await expect(started).resolves.toBe('cancelled');
    expect(renderPageForPrint).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it('más de 500 páginas con «Imprimir» en la confirmación sí prepara y imprime', async () => {
    setDocument(Array.from({ length: 501 }, () => PORTRAIT));
    const started = startPrint({ ...OPTIONS });
    useChoice.getState().active?.options[0]?.pick();

    await expect(started).resolves.toBe('printed');
    expect(renderPageForPrint).toHaveBeenCalledTimes(501);
  });

  it('cancelar a mitad de la preparación deja el estado en idle, revoca lo creado y no imprime', async () => {
    setDocument([PORTRAIT, PORTRAIT]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(renderPageForPrint)
      .mockImplementationOnce(() => Promise.resolve(new Blob(['a'], { type: 'image/png' })))
      .mockImplementationOnce(async (_doc, _index, o) => {
        await gate;
        return o.signal.aborted ? 'cancelled' : new Blob(['b'], { type: 'image/png' });
      });

    const started = startPrint({ ...OPTIONS });
    await vi.waitFor(() => { expect(renderPageForPrint).toHaveBeenCalledTimes(2); });
    cancelPrint();
    expect(usePrintJob.getState().job).toEqual({ status: 'idle' });

    release();
    await expect(started).resolves.toBe('cancelled');
    expect(print).not.toHaveBeenCalled();
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(source.dispose)).toHaveBeenCalledTimes(1);
    expect(usePrintJob.getState().job).toEqual({ status: 'idle' });
  });

  it('libera las URL y el documento al cerrarse el diálogo del sistema (afterprint)', async () => {
    setDocument([PORTRAIT]);
    let urlsDuringPrint = -1;
    print.mockImplementationOnce(() => {
      window.dispatchEvent(new Event('afterprint'));
      urlsDuringPrint = urls.length;
      return Promise.resolve({ ok: true, value: undefined });
    });

    await expect(startPrint({ ...OPTIONS })).resolves.toBe('printed');
    expect(urlsDuringPrint).toBe(0);
    expect(vi.mocked(source.dispose)).toHaveBeenCalledTimes(1);
  });

  it('un error de render se muestra como fallo y libera lo creado', async () => {
    setDocument([PORTRAIT, PORTRAIT]);
    vi.mocked(renderPageForPrint)
      .mockImplementationOnce(() => Promise.resolve(new Blob(['a'], { type: 'image/png' })))
      .mockImplementationOnce(() => Promise.reject(new Error('lienzo roto')));

    await expect(startPrint({ ...OPTIONS })).resolves.toBe('failed');
    expect(print).not.toHaveBeenCalled();
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(source.dispose)).toHaveBeenCalledTimes(1);
    expect(usePrintJob.getState().job).toEqual({ status: 'idle' });
  });

  it('si el sistema no abre el diálogo de impresión, el resultado es «failed»', async () => {
    setDocument([PORTRAIT]);
    print.mockResolvedValueOnce({ ok: false, error: { code: 'io', message: 'x' } });
    await expect(startPrint({ ...OPTIONS })).resolves.toBe('failed');
    expect(usePrintJob.getState().job).toEqual({ status: 'idle' });
  });

  it('sin documento abierto no hace nada', async () => {
    await expect(startPrint({ ...OPTIONS })).resolves.toBe('failed');
    expect(openPrintSource).not.toHaveBeenCalled();
  });

  it('recuerda las opciones salvo el rango', async () => {
    setDocument([PORTRAIT]);
    await startPrint({ pages: 'range', range: '1', withComments: false, autoRotate: false, highQuality: true });
    expect(prefs.get(PRINT_OPTIONS_PREF)).toEqual({ pages: 'range', withComments: false, autoRotate: false, highQuality: true });
  });
});

describe('openPrintDialog', () => {
  it('no abre nada sin documento listo', () => {
    openPrintDialog();
    expect(usePrintDialog.getState().open).toBe(false);
  });

  it('abre el diálogo con las opciones recordadas y sin rango', () => {
    setDocument([PORTRAIT, PORTRAIT]);
    prefs.set(PRINT_OPTIONS_PREF, { pages: 'current', withComments: false, autoRotate: true, highQuality: true });
    openPrintDialog();
    expect(usePrintDialog.getState()).toEqual({
      open: true,
      form: { pages: 'current', range: '', withComments: false, autoRotate: true, highQuality: true },
    });
    closePrintDialog();
    expect(usePrintDialog.getState().open).toBe(false);
  });

  it('con preferencias no válidas usa los valores por defecto', () => {
    setDocument([PORTRAIT]);
    prefs.set(PRINT_OPTIONS_PREF, { pages: 'otra-cosa' });
    openPrintDialog();
    expect(usePrintDialog.getState().form).toEqual({ pages: 'all', range: '', withComments: true, autoRotate: true, highQuality: false });
  });
});
