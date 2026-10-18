import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTextCache, type PageTextSource } from '../../src/core/search/session';
import {
  cancelSearch,
  closeSearch,
  nextMatch,
  openSearch,
  prevMatch,
  setQuery,
  setSearchBackend,
  toggleOption,
} from '../../src/state/search-actions';
import { initialSearchState, useSearch } from '../../src/state/search-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';

/**
 * Textos de 5 páginas (0-based): «busqueda» aparece una vez en la página 2 (índice 1) y dos veces en la 4
 * (índice 3), como en el criterio de PDF-018.
 */
const PAGE_TEXTS: readonly string[] = [
  'sin nada que ver',
  'una busqueda aquí',
  'otra pagina',
  'busqueda y busqueda',
  'nada',
];

/** Fuente falsa: cuenta las lecturas para comprobar cuántas sesiones se han lanzado. */
function fakeSource(hangFrom?: number): { readonly source: PageTextSource; readonly reads: ReturnType<typeof vi.fn> } {
  const reads = vi.fn();
  const source: PageTextSource = {
    getPageItems(pageIndex, signal) {
      reads(pageIndex);
      if (hangFrom !== undefined && pageIndex >= hangFrom) {
        // Página que no llega: solo termina al cancelarse la búsqueda.
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('cancelada', 'AbortError'));
          });
        });
      }
      return Promise.resolve([{ str: PAGE_TEXTS[pageIndex] ?? '', hasEOL: false }]);
    },
  };
  return { source, reads };
}

/** Deja que terminen las promesas pendientes de las lecturas falsas. */
async function flush(): Promise<void> {
  // La sesión cede al bucle de eventos cada cierto trabajo (según la carga): se drena hasta que no quede nada.
  for (let i = 0; i < 50; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}

/** Avanza el reloj falso (debounce) y deja correr las lecturas. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

function useFake(hangFrom?: number): ReturnType<typeof fakeSource> {
  const fake = fakeSource(hangFrom);
  setSearchBackend(() => ({ numPages: PAGE_TEXTS.length, source: fake.source, cache: new PageTextCache() }));
  return fake;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useSearch.setState({ ...initialSearchState });
  useViewer.setState({ ...initialViewerState, currentPage: 0 });
});

afterEach(() => {
  closeSearch();
  setSearchBackend(null);
  vi.useRealTimers();
});

describe('acciones de búsqueda · sesiones y debounce', () => {
  it('tres cambios de consulta en 100 ms lanzan una sola sesión', async () => {
    const fake = useFake();
    openSearch();

    setQuery('b');
    await advance(30);
    setQuery('bu');
    await advance(30);
    setQuery('busqueda');
    await advance(40);
    expect(fake.reads).not.toHaveBeenCalled();

    await advance(250);
    expect(fake.reads).toHaveBeenCalledTimes(PAGE_TEXTS.length);
    expect(useSearch.getState().status).toBe('done');
    expect(useSearch.getState().total).toBe(3);
  });

  it('cambiar una opción cancela la búsqueda anterior y lanza otra con la opción nueva', async () => {
    const fake = useFake();
    openSearch();
    setQuery('Busqueda');
    await advance(250);
    expect(useSearch.getState().total).toBe(3);

    toggleOption('matchCase');
    await flush();

    expect(useSearch.getState().options.matchCase).toBe(true);
    expect(fake.reads).toHaveBeenCalledTimes(PAGE_TEXTS.length * 2);
    expect(useSearch.getState().total).toBe(0);
    expect(useSearch.getState().status).toBe('done');
  });

  it('closeSearch cancela, vacía las coincidencias y cierra la barra', async () => {
    useFake();
    openSearch();
    setQuery('busqueda');
    await advance(250);
    expect(useSearch.getState().total).toBe(3);

    closeSearch();

    const state = useSearch.getState();
    expect(state.open).toBe(false);
    expect(state.query).toBe('');
    expect(state.status).toBe('idle');
    expect(state.total).toBe(0);
    expect(state.matchesByPage.size).toBe(0);
    expect(state.pagesWithMatches).toEqual([]);
    expect(state.current).toBeNull();
  });

  it('closeSearch antes del debounce impide que se lance la sesión', async () => {
    const fake = useFake();
    openSearch();
    setQuery('busqueda');
    closeSearch();

    await advance(500);

    expect(fake.reads).not.toHaveBeenCalled();
  });

  it('cancelSearch conserva lo encontrado hasta ese momento', async () => {
    useFake(2);
    openSearch();
    setQuery('busqueda');
    await advance(250);
    expect(useSearch.getState().status).toBe('searching');
    expect(useSearch.getState().total).toBe(1);

    cancelSearch();
    await flush();

    const state = useSearch.getState();
    expect(state.status).toBe('done');
    expect(state.progress).toBeNull();
    expect(state.total).toBe(1);
    expect(state.current).toEqual({ page: 1, index: 0 });
  });
});

describe('acciones de búsqueda · recorrido de coincidencias', () => {
  it('siguiente recorre p2#0 → p4#0 → p4#1 → p2#0 y anterior desde p2#0 va a p4#1', async () => {
    useFake();
    openSearch();
    setQuery('busqueda');
    await advance(250);
    expect(useSearch.getState().current).toEqual({ page: 1, index: 0 });

    nextMatch();
    expect(useSearch.getState().current).toEqual({ page: 3, index: 0 });
    nextMatch();
    expect(useSearch.getState().current).toEqual({ page: 3, index: 1 });
    nextMatch();
    expect(useSearch.getState().current).toEqual({ page: 1, index: 0 });

    prevMatch();
    expect(useSearch.getState().current).toEqual({ page: 3, index: 1 });
  });

  it('cada salto incrementa revealSeq para que el visor muestre la coincidencia', async () => {
    useFake();
    openSearch();
    setQuery('busqueda');
    await advance(250);
    const before = useSearch.getState().revealSeq;

    nextMatch();

    expect(useSearch.getState().revealSeq).toBe(before + 1);
  });
});
