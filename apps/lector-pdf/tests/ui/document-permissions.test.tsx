// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_PERMISSIONS, permissionsFrom, type DocPermissions } from '../../src/core/permissions';
import type { LoadedPdf } from '../../src/engine';
import { attachSelectionBehavior } from '../../src/ui/viewer/text-selection';
import { openPrintDialog, usePrintDialog } from '../../src/state/print-actions';
import { initServices } from '../../src/state/services';
import { useViewer, initialViewerState } from '../../src/state/viewer-store';
import { PrintDialog } from '../../src/ui/print/PrintDialog';
import { securityMsg } from '../../src/ui/messages-security';
import { printMsg } from '../../src/ui/messages-print';
import { createFakePlatform } from '../helpers/fake-platform';

const FILE: OpenedFile = {
  token: 'fake',
  name: 'restringido.pdf',
  path: null,
  size: 10,
  lastModified: null,
  canSaveInPlace: false,
  source: memorySource(new Uint8Array(0)),
};

/** Estado de un documento abierto con los permisos dados. */
function openWith(permissions: DocPermissions): void {
  const pdf = { doc: {}, numPages: 3, fingerprint: 'fake' } as unknown as LoadedPdf;
  useViewer.setState({ ...initialViewerState, status: 'ready', file: FILE, pdf, currentPage: 0, permissions });
}

beforeEach(() => {
  const platform: Platform = createFakePlatform({
    prefs: {
      get: () => null,
      set: vi.fn(),
      remove: vi.fn(),
    } as unknown as Platform['prefs'],
  });
  initServices({ platform, assetBaseUrl: '/' });
  usePrintDialog.setState({ open: false });
});

afterEach(() => {
  useViewer.setState(initialViewerState);
  usePrintDialog.setState({ open: false });
  vi.restoreAllMocks();
});

describe('impresión restringida (PDF-048)', () => {
  it('Ctrl+P con el permiso de impresión quitado muestra el aviso y no abre el diálogo', () => {
    openWith(permissionsFrom(new Set<number>()));

    openPrintDialog();

    expect(usePrintDialog.getState().open).toBe(false);
    expect(useViewer.getState().notice?.text).toBe(securityMsg.printBlocked);
  });

  it('con impresión permitida, abre el diálogo sin aviso', () => {
    openWith(ALL_PERMISSIONS);

    openPrintDialog();

    expect(usePrintDialog.getState().open).toBe(true);
    expect(useViewer.getState().notice).toBeNull();
  });

  it('sin alta calidad, la casilla queda deshabilitada con su explicación', () => {
    openWith(permissionsFrom(new Set([4])));
    openPrintDialog();

    render(<PrintDialog />);

    const highQuality = screen.getByRole('checkbox', { name: printMsg.highQuality });
    expect(highQuality).toBeDisabled();
    expect(highQuality).not.toBeChecked();
    expect(screen.getByText(securityMsg.highQualityBlocked)).toBeInTheDocument();
  });

  it('con alta calidad permitida, la casilla se puede marcar sin explicación', async () => {
    const user = userEvent.setup();
    openWith(ALL_PERMISSIONS);
    openPrintDialog();

    render(<PrintDialog />);

    const highQuality = screen.getByRole('checkbox', { name: printMsg.highQuality });
    expect(highQuality).toBeEnabled();
    await user.click(highQuality);
    expect(highQuality).toBeChecked();
    expect(screen.queryByText(securityMsg.highQualityBlocked)).toBeNull();
  });
});

describe('copia restringida (PDF-048)', () => {
  /** Capa de texto de prueba con su oyente de copia. Devuelve la capa y la función de desregistro. */
  function textLayer(): { readonly div: HTMLElement; readonly detach: () => void } {
    const div = document.createElement('div');
    document.body.append(div);
    const detach = attachSelectionBehavior(div);
    return { div, detach };
  }

  function copyEvent(): { readonly event: Event; readonly setData: ReturnType<typeof vi.fn> } {
    const setData = vi.fn();
    const event = new Event('copy', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    return { event, setData };
  }

  it('sin permiso de copia, no escribe en el portapapeles y avisa', () => {
    openWith(permissionsFrom(new Set([4])));
    const layer = textLayer();
    const { event, setData } = copyEvent();

    layer.div.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(setData).not.toHaveBeenCalled();
    expect(useViewer.getState().notice?.text).toBe(securityMsg.copyBlocked);
    layer.detach();
  });

  it('con permiso de copia, escribe el texto normal y no avisa', () => {
    openWith(ALL_PERMISSIONS);
    const layer = textLayer();
    const { event, setData } = copyEvent();

    layer.div.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith('text/plain', expect.any(String));
    expect(useViewer.getState().notice).toBeNull();
    layer.detach();
  });
});
