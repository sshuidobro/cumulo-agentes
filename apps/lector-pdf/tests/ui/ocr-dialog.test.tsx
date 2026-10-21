// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import { runOcr, useOcrDialog } from '../../src/state/ocr-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { OcrDialog } from '../../src/ui/ocr/OcrDialog';
import { ocrMsg } from '../../src/ui/messages-ocr';
import { printMsg } from '../../src/ui/messages-print';
import type * as OcrActions from '../../src/state/ocr-actions';

vi.mock('../../src/state/ocr-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof OcrActions>()),
  runOcr: vi.fn(() => Promise.resolve('saved')),
}));

const PAGES = 3;

beforeEach(() => {
  const pdf = { doc: {} as PDFDocumentProxy, numPages: PAGES, fingerprint: 'fake' } as unknown as LoadedPdf;
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf, currentPage: 0 });
  useOcrDialog.setState({ open: true, form: { pages: 'all', range: '', lang: 'spa', skipText: true } });
});

afterEach(() => {
  vi.clearAllMocks();
  useOcrDialog.setState({ open: false });
  useViewer.setState(initialViewerState);
});

describe('OcrDialog', () => {
  it('muestra idioma, páginas, omitir con texto y la nota de privacidad', () => {
    render(<OcrDialog />);

    expect(screen.getByRole('dialog', { name: ocrMsg.title })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: ocrMsg.language })).toHaveValue('spa');
    expect(screen.getByRole('radio', { name: printMsg.allPages })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: ocrMsg.skipText })).toBeChecked();
    expect(screen.getByText(ocrMsg.privacy)).toBeInTheDocument();
  });

  it('Reconocer lanza la operación con el idioma y la casilla elegidos', async () => {
    const user = userEvent.setup();
    render(<OcrDialog />);

    await user.selectOptions(screen.getByRole('combobox', { name: ocrMsg.language }), 'eng');
    await user.click(screen.getByRole('checkbox', { name: ocrMsg.skipText }));
    await user.click(screen.getByRole('button', { name: ocrMsg.run }));

    expect(runOcr).toHaveBeenCalledWith({ pages: 'all', range: '', lang: 'eng', skipText: false });
    expect(useOcrDialog.getState().open).toBe(false);
  });

  it('un rango no válido deshabilita Reconocer y explica el error', async () => {
    const user = userEvent.setup();
    render(<OcrDialog />);

    await user.click(screen.getByRole('radio', { name: printMsg.rangePages }));
    await user.type(screen.getByRole('textbox', { name: printMsg.rangeField }), '9');

    expect(screen.getByRole('button', { name: ocrMsg.run })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(printMsg.invalidRange(PAGES));
  });

  it('Cancelar cierra sin reconocer nada', async () => {
    const user = userEvent.setup();
    render(<OcrDialog />);

    await user.click(screen.getByRole('button', { name: ocrMsg.cancel }));

    expect(runOcr).not.toHaveBeenCalled();
    expect(useOcrDialog.getState().open).toBe(false);
  });
});
