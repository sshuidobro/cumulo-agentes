// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import { renderPageImage } from '../../src/engine/print-render';
import { openPrintSource, type PrintSource } from '../../src/state/print-source';
import { openExportDialog, useExportDialog, useExportJob } from '../../src/state/export-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ExportDialog } from '../../src/ui/export/ExportDialog';
import { ExportProgress } from '../../src/ui/export/ExportProgress';
import { exportMsg } from '../../src/ui/messages-export';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/engine/print-render', () => ({ renderPageImage: vi.fn() }));
vi.mock('../../src/state/print-source', () => ({ openPrintSource: vi.fn() }));

const PORTRAIT = { widthPt: 595, heightPt: 842 };
const PAGES = 5;

function fakeDoc(): PDFDocumentProxy {
  return {
    numPages: PAGES,
    getPage: () => Promise.resolve({ getViewport: () => ({ width: PORTRAIT.widthPt, height: PORTRAIT.heightPt }), cleanup: () => true }),
  } as unknown as PDFDocumentProxy;
}

let platform: Platform;

beforeEach(() => {
  platform = createFakePlatform();
  initServices({ platform, assetBaseUrl: '/' });
  const pdf = { doc: fakeDoc(), numPages: PAGES, fingerprint: 'fake' } as unknown as LoadedPdf;
  const file: OpenedFile = {
    token: 'fake',
    name: 'informe.pdf',
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: false,
    source: memorySource(new Uint8Array(0)),
  };
  useViewer.setState({ ...initialViewerState, status: 'ready', file, pdf, currentPage: 0 });
  const source: PrintSource = { doc: fakeDoc(), temporary: false, unsavedIncluded: true, dispose: vi.fn(() => Promise.resolve()) };
  vi.mocked(openPrintSource).mockResolvedValue(source);
  vi.mocked(renderPageImage).mockImplementation((_doc, _index, o) =>
    Promise.resolve({ blob: new Blob(['png']), width: 1, height: 1, dpi: o.dpi }),
  );
  useExportDialog.setState({ open: false });
  useExportJob.setState({ job: { status: 'idle' } });
});

afterEach(() => {
  vi.clearAllMocks();
  useViewer.setState(initialViewerState);
});

function renderDialog(): ReturnType<typeof render> {
  return render(
    <>
      <ExportDialog />
      <ExportProgress />
    </>,
  );
}

describe('ExportDialog', () => {
  it('se abre con el foco en el primer control del formato y Escape lo cierra', async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => { openExportDialog(); });

    const png = await screen.findByRole('radio', { name: exportMsg.png });
    await waitFor(() => { expect(png).toHaveFocus(); });

    await user.keyboard('{Escape}');
    expect(useExportDialog.getState().open).toBe(false);
  });

  it('para texto ocultan la resolución y los comentarios', async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => { openExportDialog(); });

    expect(await screen.findByRole('combobox', { name: exportMsg.resolution })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: exportMsg.withComments })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: exportMsg.txt }));

    expect(screen.queryByRole('combobox', { name: exportMsg.resolution })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: exportMsg.withComments })).not.toBeInTheDocument();
  });

  it('un rango no válido deshabilita Exportar y lo explica', async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => { openExportDialog(); });

    await user.click(await screen.findByRole('radio', { name: exportMsg.rangePages }));
    await user.type(screen.getByRole('textbox', { name: exportMsg.rangeField }), '9');

    expect(screen.getByRole('button', { name: exportMsg.export })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(exportMsg.invalidRange(PAGES));
  });

  it('Intro en el campo de rango exporta las páginas elegidas y cierra el diálogo', async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => { openExportDialog(); });

    await user.click(await screen.findByRole('radio', { name: exportMsg.rangePages }));
    await user.type(screen.getByRole('textbox', { name: exportMsg.rangeField }), '1-2{Enter}');

    await waitFor(() => { expect(platform.exportFile).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(platform.exportFile).mock.calls[0]?.[0]).toBe('informe-imagenes.zip');
    expect(useExportDialog.getState().open).toBe(false);
  });
});
