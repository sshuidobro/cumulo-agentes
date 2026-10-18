// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource, type KeyValueStore } from '@suite/platform';
import { NIGHT_PAGE_COLORS } from '../../src/core/night';
import type { LoadedPdf } from '../../src/engine';
import { renderPageToCanvas } from '../../src/engine/render';
import { PageDimsTable } from '../../src/core/page-dims';
import { loadAppearance, NIGHT_MODE_PREF, THEME_PREF, toggleNightMode } from '../../src/state/appearance-actions';
import { useAppearance } from '../../src/state/appearance-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { renderQueue } from '../../src/state/render-service';
import { MainToolbar } from '../../src/ui/toolbar/MainToolbar';
import { useTheme } from '../../src/ui/use-theme';
import { PageView, type PageViewProps } from '../../src/ui/viewer/PageView';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

// El dibujo real necesita pdf.js y canvas: aquí se simula y solo interesan los argumentos.
vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(() => Promise.resolve('done' as const)),
}));
vi.mock('../../src/engine/text', () => ({
  normalizeUnicode: (text: string) => text,
  createTextLayer: vi.fn(() => ({
    textDivs: [],
    items: [],
    render: () => Promise.resolve(),
    update: () => undefined,
    cancel: () => undefined,
  })),
}));
vi.mock('../../src/state/document-actions', () => ({ reportPageDims: vi.fn() }));

let prefs: KeyValueStore;

/** Barra principal y el efecto del tema, como en `App`. */
function Shell() {
  useTheme();
  return <MainToolbar />;
}

function renderShell(): void {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(20, 612, 792, 0),
    dimsVersion: 1,
  });
  render(<Shell />);
}

beforeEach(() => {
  prefs = createStorageStore(null, 'test.');
  initServices({ platform: createFakePlatform({ prefs }), assetBaseUrl: 'http://localhost/pdfjs/' });
  useAppearance.setState({ theme: 'system', nightMode: false });
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  renderQueue.cancelAll();
  document.documentElement.removeAttribute('data-theme');
});

function isText(v: unknown): v is string {
  return typeof v === 'string';
}

describe('Apariencia · tema', () => {
  it('«Tema: Oscuro» pone data-theme=dark y lo guarda; «Tema: Sistema» quita el atributo', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Apariencia' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Tema: Oscuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(prefs.get(THEME_PREF, isText)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Apariencia' }));
    expect(screen.getByRole('menuitemradio', { name: 'Tema: Oscuro' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Tema: Sistema' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe('light dark');
    expect(prefs.get(THEME_PREF, isText)).toBe('system');
  });

  it('«Tema: Claro» fuerza data-theme=light', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Apariencia' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Tema: Claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('al arrancar carga el tema y el modo noche guardados; un valor no válido cuenta como ausente', () => {
    prefs.set(THEME_PREF, 'verde');
    prefs.set(NIGHT_MODE_PREF, true);
    loadAppearance();
    expect(useAppearance.getState()).toEqual({ theme: 'system', nightMode: true });

    prefs.set(THEME_PREF, 'dark');
    prefs.set(NIGHT_MODE_PREF, 'sí');
    loadAppearance();
    expect(useAppearance.getState()).toEqual({ theme: 'dark', nightMode: false });
  });
});

describe('Apariencia · modo noche', () => {
  it('activar «Modo noche» se guarda y se marca en el menú', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Apariencia' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' }));
    expect(useAppearance.getState().nightMode).toBe(true);
    expect(prefs.get(NIGHT_MODE_PREF, (v): v is boolean => typeof v === 'boolean')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Apariencia' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('con el modo noche activo, la página pide un render nuevo con night (sin pageColors)', async () => {
    const doc = {
      getPage: (n: number) =>
        Promise.resolve({
          id: n,
          pageNumber: n,
          rotate: 0,
          getViewport: () => ({ width: 612, height: 792 }),
          cleanup: () => true,
        }),
    };
    useViewer.setState({ ...initialViewerState, status: 'ready', pdf: { doc } as unknown as LoadedPdf });
    const props: PageViewProps = {
      index: 0,
      numPages: 1,
      top: 0,
      left: 0,
      width: 612,
      height: 792,
      zoom: 1,
      rotation: 0,
      visible: true,
    };
    const draws = vi.mocked(renderPageToCanvas);
    draws.mockClear();
    render(<PageView {...props} />);
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(draws).toHaveBeenCalled();
    for (const call of draws.mock.calls) expect(call[2]).not.toHaveProperty('night');

    draws.mockClear();
    act(() => {
      toggleNightMode();
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(draws).toHaveBeenCalled();
    const last = draws.mock.calls.at(-1);
    expect(last?.[2]).toMatchObject({ night: NIGHT_PAGE_COLORS });
    for (const call of draws.mock.calls) expect(call[2]).not.toHaveProperty('pageColors');
  });
});
