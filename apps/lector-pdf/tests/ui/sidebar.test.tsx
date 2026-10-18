// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore } from '@suite/platform';
import type { LoadedPdf } from '../../src/engine';
import { App } from '../../src/ui/App';
import { Sidebar } from '../../src/ui/sidebar/Sidebar';
import { SIDEBAR_PREF } from '../../src/state/sidebar-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';
import type { Platform } from '@suite/platform';

vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(async () => 'done' as const),
}));

let platform: Platform;

/** Documento listo sin páginas dibujadas: basta para que la app muestre el visor, la barra y el panel. */
function openReadyDocument(sidebar: 'none' | 'thumbnails' = 'none'): void {
  const doc = { numPages: 3, getPage: vi.fn(), getPageMode: vi.fn(async () => null) };
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    pdf: { numPages: 3, doc } as unknown as LoadedPdf,
    sidebar,
  });
}

beforeEach(() => {
  platform = createFakePlatform({ prefs: createStorageStore(null, 'sidebar-ui-test.') });
  initServices({ platform, assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState(initialViewerState);
});

describe('Panel lateral · interfaz', () => {
  it('sin pestaña elegida, la pestaña «Miniaturas» aparece sin seleccionar y no hay panel', () => {
    render(<Sidebar />);
    const tablist = screen.getByRole('tablist', { name: 'Pestañas del panel lateral' });
    const tab = within(tablist).getByRole('tab', { name: 'Miniaturas' });
    expect(tab).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('con la pestaña elegida en el store, el panel enlaza con su pestaña y contiene la lista de miniaturas', () => {
    useViewer.setState({ sidebar: 'thumbnails' });
    render(<Sidebar />);
    const tab = screen.getByRole('tab', { name: 'Miniaturas' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByRole('listbox', { name: 'Miniaturas' })).toBeInTheDocument();
  });

  it('la pestaña Miniaturas se puede activar con el teclado (Intro sobre el botón)', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const tab = screen.getByRole('tab', { name: 'Miniaturas' });
    act(() => tab.focus());
    await user.keyboard('{Enter}');
    expect(useViewer.getState().sidebar).toBe('thumbnails');
    expect(screen.getByRole('tab', { name: 'Miniaturas' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Panel lateral · F4, barra y preferencias', () => {
  it('F4 abre y cierra el panel; la pestaña se guarda en prefs', () => {
    openReadyDocument();
    render(<App />);
    expect(screen.queryByRole('complementary', { name: 'Panel lateral' })).toBeNull();

    fireEvent.keyDown(window, { key: 'F4' });
    expect(useViewer.getState().sidebar).toBe('thumbnails');
    expect(screen.getByRole('complementary', { name: 'Panel lateral' })).toBeInTheDocument();
    expect(platform.prefs.get(SIDEBAR_PREF, (v): v is string => typeof v === 'string')).toBe('thumbnails');

    fireEvent.keyDown(window, { key: 'F4' });
    expect(useViewer.getState().sidebar).toBe('none');
    expect(screen.queryByRole('complementary', { name: 'Panel lateral' })).toBeNull();
    expect(platform.prefs.get(SIDEBAR_PREF, (v): v is string => typeof v === 'string')).toBe('none');
  });

  it('el botón «Panel lateral» de la barra refleja el estado con aria-pressed y lo alterna', async () => {
    const user = userEvent.setup();
    openReadyDocument();
    render(<App />);
    const toolbar = screen.getByRole('toolbar', { name: 'Barra de herramientas' });
    const button = within(toolbar).getByRole('button', { name: 'Panel lateral' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'Panel lateral (F4)');

    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: 'Panel lateral' })).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('sin documento abierto, F4 no hace nada', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'F4' });
    expect(useViewer.getState().sidebar).toBe('none');
  });
});
