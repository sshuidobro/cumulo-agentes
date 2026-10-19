import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore, OpenedFile } from '@suite/platform';
import type { ResolvedDest } from '../../src/engine/dest';
import type * as DestModule from '../../src/engine/dest';
import { closeDocument, openRequested, registerDocumentParticipant } from '../../src/state/document-actions';
import { goBack, navigateToDest, registerHistoryParticipant, canGoBack } from '../../src/state/history';
import { goToPage } from '../../src/state/navigation';
import { POSITIONS_PREF_KEY } from '../../src/state/position-sync';
import { initServices } from '../../src/state/services';
import { registerSearchParticipant, openSearch, setQuery, setSearchBackend, toggleOption } from '../../src/state/search-actions';
import { initialSearchState, useSearch, type SearchState } from '../../src/state/search-store';
import { registerSidebarParticipant, showSidebarTab, toggleSidebar } from '../../src/state/sidebar-actions';
import { activateTab, closeTab, resetTabsForTests, useTabs } from '../../src/state/tabs';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { registerViewParticipant, setZoomMode, zoomWithWheel } from '../../src/state/view-actions';
import { PageTextCache } from '../../src/core/search/session';
import { lookupPosition, type PositionsState } from '../../src/core/reading-positions';
import { createPageTextSource } from '../../src/engine/search-source';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Destinos internos falsos de los enlaces: «uno» lleva a la página 4 y «dos» a la 5 (índices 3 y 4).
const destTargets = vi.hoisted(() => new Map<string, ResolvedDest>());

vi.mock('../../src/engine/dest', async (importOriginal) => {
  const actual = await importOriginal<typeof DestModule>();
  return {
    ...actual,
    resolveDest: async (doc: unknown, dest: unknown) =>
      typeof dest === 'string' ? (destTargets.get(dest) ?? null) : null,
  };
});

const assetBaseUrl = nodeAssetBase();

/** Fichero con ruta (como en Tauri), para que las pestañas puedan reconocerlo. */
function fileAt(name: string): OpenedFile {
  return { ...openedFile(name, fixtureSource(name)), path: `/docs/${name}` };
}

function activeId(): string {
  return useTabs.getState().activeId ?? '';
}

function fingerprintOf(title: string): string {
  const fingerprint = useTabs.getState().tabs.find((t) => t.title === title)?.fingerprint ?? null;
  if (fingerprint === null) throw new Error(`«${title}» no está listo`);
  return fingerprint;
}

/** Espera a que se cumpla `condition` (sondeo breve, sin depender de la hora del sistema). */
async function waitUntil(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Tiempo agotado esperando una condición');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

/** Deja correr unas cuantas tareas pendientes (sin depender del reloj). */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/** Almacén de preferencias en memoria que cuenta las escrituras por clave. */
function memoryPrefs(): { readonly prefs: KeyValueStore; readonly data: Map<string, unknown>; readonly writes: string[] } {
  const data = new Map<string, unknown>();
  const writes: string[] = [];
  const prefs: KeyValueStore = {
    get<T>(key: string, guard: (v: unknown) => v is T): T | null {
      const value: unknown = data.get(key);
      return guard(value) ? value : null;
    },
    set(key: string, value: unknown): void {
      writes.push(key);
      data.set(key, value);
    },
    remove(key: string): void {
      data.delete(key);
    },
  };
  return { prefs, data, writes };
}

let store: ReturnType<typeof memoryPrefs>;

beforeEach(() => {
  store = memoryPrefs();
  initServices({ platform: createFakePlatform({ prefs: store.prefs }), assetBaseUrl });
  resetTabsForTests();
  registerDocumentParticipant();
  registerHistoryParticipant();
  registerSearchParticipant();
  registerSidebarParticipant();
  registerViewParticipant();
  useViewer.setState({ ...initialViewerState });
  useSearch.setState({ ...initialSearchState });
  destTargets.clear();
  destTargets.set('uno', { pageIndex: 3, yFraction: 0.1, xFraction: null, zoom: null });
  destTargets.set('dos', { pageIndex: 4, yFraction: 0.2, xFraction: null, zoom: null });
  store.writes.length = 0;
});

afterEach(async () => {
  setSearchBackend(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const tab of [...useTabs.getState().tabs]) await closeTab(tab.id);
  await closeDocument();
  resetTabsForTests();
});

describe('pestañas · historial atrás/adelante', () => {
  it('el historial de A sobrevive a cambiar de pestaña y vuelve con A', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const docA = activeId();
    useViewer.setState({ currentPage: 0, currentYFraction: 0 });

    await navigateToDest('uno');
    useViewer.setState({ currentPage: 3, currentYFraction: 0.1 });
    await navigateToDest('dos');
    useViewer.setState({ currentPage: 4, currentYFraction: 0.2 });
    expect(canGoBack()).toBe(true);

    await openRequested(fileAt('links.pdf'));
    expect(canGoBack()).toBe(false);

    activateTab(docA);
    expect(useViewer.getState().file?.name).toBe('basic-5.pdf');
    expect(canGoBack()).toBe(true);

    goBack();
    expect(useViewer.getState().navRequest?.page).toBe(3);
    expect(useViewer.getState().navRequest?.yFraction).toBe(0.1);
  });
});

describe('pestañas · búsqueda', () => {
  it('la barra, la consulta y las opciones de A se recuperan al volver; el contador es el mismo', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const docA = activeId();
    openSearch();
    toggleOption('matchCase');
    setQuery('marcador');
    await waitUntil(() => useSearch.getState().status === 'done');
    const totalBefore = useSearch.getState().total;
    expect(totalBefore).toBe(5);

    await openRequested(fileAt('links.pdf'));
    expect(useSearch.getState().open).toBe(false);
    expect(useSearch.getState().query).toBe('');

    activateTab(docA);
    expect(useSearch.getState().open).toBe(true);
    expect(useSearch.getState().query).toBe('marcador');
    expect(useSearch.getState().options.matchCase).toBe(true);
    await waitUntil(() => useSearch.getState().status === 'done');
    expect(useSearch.getState().total).toBe(totalBefore);
  });

  it('una búsqueda en curso de A se aborta al cambiar a B y ningún resultado de A llega al store', async () => {
    const signals: AbortSignal[] = [];
    // Documento de 200 páginas: la búsqueda de A se queda parada en la página 2 hasta que se cancele.
    await openRequested(fileAt('images-200.pdf'));
    setSearchBackend(() => {
      const pdf = useViewer.getState().pdf;
      if (pdf === null) return null;
      const real = createPageTextSource(pdf.doc);
      return {
        numPages: pdf.numPages,
        cache: new PageTextCache(),
        source: {
          getPageItems(pageIndex, signal) {
            signals.push(signal);
            if (pageIndex < 2) return real.getPageItems(pageIndex, signal);
            return new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => {
                reject(new DOMException('cancelada', 'AbortError'));
              });
            });
          },
        },
      };
    });
    openSearch();
    setQuery('Página');
    await waitUntil(() => signals.length > 0);

    const spy = vi.spyOn(useSearch, 'setState');
    await openRequested(fileAt('links.pdf'));
    expect(signals.at(0)?.aborted).toBe(true);
    spy.mockClear();
    await drain();

    // Mientras B está activa, el store no recibe nada de la búsqueda de A.
    for (const [patch] of spy.mock.calls) {
      const partial = patch as Partial<SearchState>;
      expect(partial.total ?? 0).toBe(0);
      expect(partial.pagesWithMatches ?? []).toEqual([]);
    }
    expect(useSearch.getState().total).toBe(0);
    expect(useSearch.getState().status).toBe('idle');
    expect(useViewer.getState().file?.name).toBe('links.pdf');
  });
});

describe('pestañas · posición', () => {
  it('diez cambios de pestaña escriben la posición como mucho una vez por cambio y cada documento conserva la suya', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const docA = activeId();
    goToPage(2, { yFraction: 0.5 });
    useViewer.setState({ currentPage: 2, currentYFraction: 0.5 });

    await openRequested(fileAt('links.pdf'));
    const docB = activeId();
    goToPage(4, { yFraction: 0.3 });
    useViewer.setState({ currentPage: 4, currentYFraction: 0.3 });

    store.writes.length = 0;
    for (let i = 0; i < 10; i++) {
      activateTab(i % 2 === 0 ? docA : docB);
    }

    const positionWrites = store.writes.filter((key) => key === POSITIONS_PREF_KEY).length;
    expect(positionWrites).toBeLessThanOrEqual(10);

    const saved = store.data.get(POSITIONS_PREF_KEY) as PositionsState;
    expect(lookupPosition(saved, fingerprintOf('basic-5.pdf'))?.page).toBe(2);
    expect(lookupPosition(saved, fingerprintOf('links.pdf'))?.page).toBe(4);
    expect(useViewer.getState().currentPage).toBe(4);
  });
});

describe('pestañas · panel lateral', () => {
  it('cada documento conserva su pestaña del panel y F4 reabre la última de cada uno', async () => {
    await openRequested(fileAt('basic-5.pdf'));
    const docA = activeId();
    showSidebarTab('outline');
    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('none');

    await openRequested(fileAt('links.pdf'));
    const docB = activeId();
    showSidebarTab('thumbnails');
    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('none');

    activateTab(docA);
    expect(useViewer.getState().sidebar).toBe('none');
    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('outline');

    activateTab(docB);
    toggleSidebar();
    expect(useViewer.getState().sidebar).toBe('thumbnails');
  });
});

describe('pestañas · rueda pendiente', () => {
  it('al cambiar de pestaña se cancela el fotograma de la rueda pendiente', async () => {
    const frames: Array<() => void> = [];
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);

    await openRequested(fileAt('basic-5.pdf'));
    const docA = activeId();
    setZoomMode({ kind: 'custom', zoom: 1 });
    zoomWithWheel(-100, 0, 10);
    await openRequested(fileAt('links.pdf'));

    expect(cancel).toHaveBeenCalledWith(1);
    activateTab(docA);
    expect(useViewer.getState().file?.name).toBe('basic-5.pdf');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1 });
  });
});
