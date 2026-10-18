// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SearchMatch } from '../../src/core/search/find';
import { PageDimsTable } from '../../src/core/page-dims';
import type { LoadedPdf } from '../../src/engine';
import { App } from '../../src/ui/App';
import { initServices } from '../../src/state/services';
import { initialSearchState, useSearch } from '../../src/state/search-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Coincidencia de prueba en la página `pageIndex` (0-based). */
function hit(pageIndex: number): SearchMatch {
  return { pageIndex, start: { item: 0, offset: 0 }, end: { item: 0, offset: 4 } };
}

/** Documento de 5 páginas listo, con la búsqueda abierta y tres coincidencias: p2#0, p4#0 y p4#1. */
function openSearchWithMatches(): void {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    // Documento sin páginas reales: las páginas nunca se cargan, pero la app lo considera abierto.
    pdf: { numPages: 5, doc: { getPage: () => new Promise<never>(() => undefined) } } as unknown as LoadedPdf,
    dims: PageDimsTable.uniform(5, 612, 792, 0),
    dimsVersion: 1,
    zoom: 1,
  });
  useSearch.setState({
    ...initialSearchState,
    open: true,
    query: 'busqueda',
    status: 'done',
    matchesByPage: new Map([
      [1, [hit(1)]],
      [3, [hit(3), hit(3)]],
    ]),
    pagesWithMatches: [1, 3],
    total: 3,
    current: { page: 1, index: 0 },
    revealSeq: 1,
  });
}

function searchField(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Buscar en el documento' }) as HTMLInputElement;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState(initialViewerState);
  useSearch.setState(initialSearchState);
});

describe('Barra de búsqueda', () => {
  it('Ctrl+F abre la barra y enfoca el campo', async () => {
    const user = userEvent.setup();
    openSearchWithMatches();
    useSearch.setState({ open: false, query: '', status: 'idle', matchesByPage: new Map(), pagesWithMatches: [], total: 0, current: null });
    render(<App />);
    expect(screen.queryByRole('searchbox', { name: 'Buscar en el documento' })).toBeNull();

    await user.keyboard('{Control>}f{/Control}');

    expect(useSearch.getState().open).toBe(true);
    expect(searchField()).toHaveFocus();
  });

  it('Intro va a la siguiente coincidencia y Mayús+Intro a la anterior', async () => {
    const user = userEvent.setup();
    openSearchWithMatches();
    render(<App />);
    expect(searchField()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(useSearch.getState().current).toEqual({ page: 3, index: 0 });

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(useSearch.getState().current).toEqual({ page: 1, index: 0 });
  });

  it('Esc cierra la barra y devuelve el foco al visor', async () => {
    const user = userEvent.setup();
    openSearchWithMatches();
    render(<App />);

    await user.keyboard('{Escape}');

    expect(useSearch.getState().open).toBe(false);
    expect(screen.queryByRole('searchbox', { name: 'Buscar en el documento' })).toBeNull();
    expect(screen.getByTestId('viewer')).toHaveFocus();
  });

  it('muestra la posición «2 de 3» de la coincidencia actual', () => {
    openSearchWithMatches();
    useSearch.setState({ current: { page: 3, index: 0 } });
    render(<App />);

    expect(screen.getByText('2 de 3')).toBeInTheDocument();
  });

  it('los botones de opción tienen aria-pressed y title, y se conmutan al pulsarlos', async () => {
    const user = userEvent.setup();
    openSearchWithMatches();
    render(<App />);

    const names = ['Coincidir mayúsculas', 'Palabras completas', 'Distinguir tildes'];
    for (const name of names) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveAttribute('title', name);
    }

    await user.click(screen.getByRole('button', { name: 'Palabras completas' }));

    expect(screen.getByRole('button', { name: 'Palabras completas' })).toHaveAttribute('aria-pressed', 'true');
    expect(useSearch.getState().options.wholeWord).toBe(true);
  });
});
