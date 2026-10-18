// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import { renderPageForPrint } from '../../src/engine/print-render';
import { openPrintSource, type PrintSource } from '../../src/state/print-source';
import {
  openPrintDialog,
  PRINT_OPTIONS_PREF,
  usePrintDialog,
  usePrintJob,
} from '../../src/state/print-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { PrintContainer } from '../../src/ui/print/PrintContainer';
import { PrintDialog } from '../../src/ui/print/PrintDialog';
import { PrintProgress } from '../../src/ui/print/PrintProgress';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/engine/print-render', () => ({ renderPageForPrint: vi.fn() }));
vi.mock('../../src/state/print-source', () => ({ openPrintSource: vi.fn() }));

const PORTRAIT = { widthPt: 595, heightPt: 842 };
const LANDSCAPE = { widthPt: 842, heightPt: 595 };
/** Cinco páginas: la 2 es horizontal, para comprobar el giro de la hoja. */
const SIZES = [PORTRAIT, LANDSCAPE, PORTRAIT, PORTRAIT, PORTRAIT];

function fakeDoc(): PDFDocumentProxy {
  return {
    numPages: SIZES.length,
    getPage: (pageNumber: number) => {
      const size = SIZES[pageNumber - 1] ?? PORTRAIT;
      return Promise.resolve({
        getViewport: () => ({ width: size.widthPt, height: size.heightPt }),
        cleanup: () => true,
      });
    },
  } as unknown as PDFDocumentProxy;
}

let prefs: Map<string, unknown>;
let print: ReturnType<typeof vi.fn>;
let source: PrintSource;

beforeEach(() => {
  prefs = new Map();
  print = vi.fn(() => Promise.resolve({ ok: true, value: undefined }));
  const platform: Platform = createFakePlatform({
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

  const file: OpenedFile = {
    token: 'fake',
    name: 'informe.pdf',
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: false,
    source: memorySource(new Uint8Array(0)),
  };
  const pdf = { doc: fakeDoc(), numPages: SIZES.length, fingerprint: 'fake' } as unknown as LoadedPdf;
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf, currentPage: 0 });

  source = { doc: fakeDoc(), temporary: false, unsavedIncluded: true, dispose: vi.fn(() => Promise.resolve()) };
  vi.mocked(openPrintSource).mockResolvedValue(source);
  vi.mocked(renderPageForPrint).mockImplementation(() => Promise.resolve(new Blob(['png'], { type: 'image/png' })));

  let counter = 0;
  URL.createObjectURL = vi.fn(() => {
    counter += 1;
    return `blob:ui-${String(counter)}`;
  });
  URL.revokeObjectURL = vi.fn();
  usePrintJob.setState({ job: { status: 'idle' }, sheets: [], sheet: null, pageCss: null });
  usePrintDialog.setState({ open: false });
});

afterEach(() => {
  useViewer.setState(initialViewerState);
  usePrintJob.setState({ job: { status: 'idle' }, sheets: [], sheet: null, pageCss: null });
  usePrintDialog.setState({ open: false });
  vi.clearAllMocks();
});

/** Monta el diálogo, el progreso y el contenedor de impresión como lo hace la app. */
function renderPrinting(): void {
  render(
    <>
      <PrintDialog />
      <PrintProgress />
      <PrintContainer />
    </>,
  );
}

function dialogNamed(name: string): HTMLElement {
  return screen.getByRole('dialog', { name });
}

describe('diálogo Imprimir', () => {
  it('se abre con «Imprimir» enfocado, «Todas» marcada y el recuento de páginas', async () => {
    renderPrinting();
    act(() => { openPrintDialog(); });

    const dialog = dialogNamed('Imprimir');
    expect(within(dialog).getByRole('button', { name: 'Imprimir' })).toHaveFocus();
    expect(within(dialog).getByRole('radio', { name: 'Todas' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Página actual (1)' })).not.toBeChecked();
    expect(within(dialog).getByText('Se imprimirán 5 páginas.')).toBeInTheDocument();
  });

  it('un rango no válido muestra el mensaje, deshabilita Imprimir y Esc cierra el diálogo', async () => {
    const user = userEvent.setup();
    renderPrinting();
    act(() => { openPrintDialog(); });
    const dialog = dialogNamed('Imprimir');

    await user.type(within(dialog).getByRole('textbox', { name: 'Rango de páginas' }), '0');

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Escribe páginas entre 1 y 5, por ejemplo 1-3, 5');
    expect(within(dialog).getByRole('button', { name: 'Imprimir' })).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Imprimir' })).toBeNull();
    expect(print).not.toHaveBeenCalled();
  });

  it('un rango con 9999 páginas en un documento de 5 tampoco se acepta', async () => {
    const user = userEvent.setup();
    renderPrinting();
    act(() => { openPrintDialog(); });
    const dialog = dialogNamed('Imprimir');

    await user.type(within(dialog).getByRole('textbox', { name: 'Rango de páginas' }), '1-9999');

    expect(within(dialog).getByRole('button', { name: 'Imprimir' })).toBeDisabled();
    expect(within(dialog).queryByText(/Se imprimirán/)).toBeNull();
  });

  it('un rango válido actualiza el recuento y Intro imprime solo esas páginas', async () => {
    const user = userEvent.setup();
    renderPrinting();
    act(() => { openPrintDialog(); });
    const dialog = dialogNamed('Imprimir');

    await user.type(within(dialog).getByRole('textbox', { name: 'Rango de páginas' }), '2-4');
    expect(within(dialog).getByRole('radio', { name: 'Páginas' })).toBeChecked();
    expect(within(dialog).getByText('Se imprimirán 3 páginas.')).toBeInTheDocument();

    await user.keyboard('{Enter}');

    await waitFor(() => { expect(print).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(renderPageForPrint).mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
    expect(screen.queryByRole('dialog', { name: 'Imprimir' })).toBeNull();
  });

  it('desmarcar «Imprimir comentarios» llega a pdf.js y se recuerda para la próxima vez', async () => {
    const user = userEvent.setup();
    renderPrinting();
    act(() => { openPrintDialog(); });
    const dialog = dialogNamed('Imprimir');

    await user.click(within(dialog).getByRole('checkbox', { name: 'Imprimir comentarios' }));
    await user.click(within(dialog).getByRole('button', { name: 'Imprimir' }));

    await waitFor(() => { expect(print).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(renderPageForPrint).mock.calls[0]?.[2]).toMatchObject({ withComments: false });
    expect(prefs.get(PRINT_OPTIONS_PREF)).toMatchObject({ pages: 'all', withComments: false, autoRotate: true, highQuality: false });
  });

  it('la hoja de la página horizontal se gira en el contenedor de impresión', async () => {
    const user = userEvent.setup();
    renderPrinting();
    act(() => { openPrintDialog(); });
    let sheetImages: readonly { readonly dataset: DOMStringMap }[] = [];
    print.mockImplementationOnce(() => {
      sheetImages = Array.from(document.querySelectorAll<HTMLImageElement>('#print-container img'));
      return Promise.resolve({ ok: true, value: undefined });
    });

    await user.click(within(dialogNamed('Imprimir')).getByRole('button', { name: 'Imprimir' }));

    await waitFor(() => { expect(print).toHaveBeenCalledTimes(1); });
    expect(sheetImages.map((img) => img.dataset['rotate'])).toEqual(['0', '90', '0', '0', '0']);
  });

  it('al terminar, el contenedor de impresión queda vacío y las URL se liberan', async () => {
    const user = userEvent.setup();
    renderPrinting();
    act(() => { openPrintDialog(); });

    await user.click(within(dialogNamed('Imprimir')).getByRole('button', { name: 'Imprimir' }));

    await waitFor(() => { expect(print).toHaveBeenCalledTimes(1); });
    expect(document.getElementById('print-container')?.childElementCount).toBe(0);
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(SIZES.length);
  });
});

describe('progreso de la preparación', () => {
  it('muestra el avance y Cancelar lo detiene sin imprimir', async () => {
    const user = userEvent.setup();
    // Las páginas tardan hasta que se cancelan: así el progreso queda visible.
    vi.mocked(renderPageForPrint).mockImplementation(
      (_doc, _index, o) => new Promise((resolve) => {
        o.signal.addEventListener('abort', () => { resolve('cancelled'); }, { once: true });
      }),
    );
    renderPrinting();
    act(() => { openPrintDialog(); });
    await user.click(within(dialogNamed('Imprimir')).getByRole('button', { name: 'Imprimir' }));

    const progress = await waitFor(() => dialogNamed('Preparando la impresión'));
    expect(within(progress).getByRole('progressbar', { name: 'Progreso de la preparación' })).toBeInTheDocument();
    expect(within(progress).getByText('Preparando página 1 de 5…')).toBeInTheDocument();

    await user.click(within(progress).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Preparando la impresión' })).toBeNull(); });
    expect(usePrintJob.getState().job).toEqual({ status: 'idle' });
    expect(print).not.toHaveBeenCalled();
  });
});
