import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedDest } from '../../src/engine/dest';
import type { LoadedPdf } from '../../src/engine/load';
import { resolveDest } from '../../src/engine/dest';
import { goBack, goForward, MAX_HISTORY, navigateToDest, runNamedAction } from '../../src/state/history';
import { goToPage } from '../../src/state/navigation';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { PageDimsTable } from '../../src/core/page-dims';
import { msg } from '../../src/ui/messages';

vi.mock('../../src/engine/dest', () => ({ resolveDest: vi.fn() }));

const resolveMock = vi.mocked(resolveDest);

/** Destinos de prueba: cada nombre lleva a una página y una posición fijas. */
const TARGETS: Record<string, ResolvedDest> = {
  d1: { pageIndex: 3, yFraction: 0.1, xFraction: null, zoom: null },
  d2: { pageIndex: 5, yFraction: 0.2, xFraction: null, zoom: null },
  d3: { pageIndex: 7, yFraction: 0.3, xFraction: null, zoom: { kind: 'fit-width' } },
  d4: { pageIndex: 1, yFraction: 0.4, xFraction: null, zoom: null },
};

/** Lo que haría el visor al llegar a una posición: actualiza la página y la posición actuales. */
function viewerArrivesAt(page: number, yFraction: number): void {
  useViewer.setState({ currentPage: page, currentYFraction: yFraction });
}

/** Última petición de navegación del visor. */
function lastRequest() {
  const request = useViewer.getState().navRequest;
  if (request === null) throw new Error('no hay petición de navegación');
  return request;
}

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockImplementation(async (_doc, dest) => {
    const key = typeof dest === 'string' ? dest : '';
    return TARGETS[key] ?? null;
  });
  useViewer.setState(initialViewerState);
  useViewer.setState({
    ...initialViewerState,
    dims: PageDimsTable.uniform(10, 612, 792, 0),
    dimsVersion: 1,
    pdf: { doc: {} } as unknown as LoadedPdf,
    currentPage: 0,
    currentYFraction: 0,
  });
  goToPage(0);
});

describe('historial atrás/adelante', () => {
  it('tres destinos y dos «atrás» vuelven a la posición del primero; «adelante» va al segundo', async () => {
    viewerArrivesAt(0, 0);
    await navigateToDest('d1');
    viewerArrivesAt(3, 0.1);
    await navigateToDest('d2');
    viewerArrivesAt(5, 0.2);
    await navigateToDest('d3');
    viewerArrivesAt(7, 0.3);

    goBack();
    viewerArrivesAt(5, 0.2);
    goBack();
    expect(lastRequest()).toMatchObject({ page: 3, yFraction: 0.1 });
    viewerArrivesAt(3, 0.1);

    goForward();
    expect(lastRequest()).toMatchObject({ page: 5, yFraction: 0.2 });
  });

  it('un destino nuevo vacía «adelante»', async () => {
    viewerArrivesAt(0, 0);
    await navigateToDest('d1');
    viewerArrivesAt(3, 0.1);
    goBack();
    viewerArrivesAt(0, 0);
    expect(useViewer.getState().historyState.canForward).toBe(true);

    await navigateToDest('d4');
    expect(useViewer.getState().historyState).toEqual({ canBack: true, canForward: false });
    goForward();
    expect(lastRequest()).toMatchObject({ page: 1 });
  });

  it('canBack y canForward reflejan las pilas en el store', async () => {
    expect(useViewer.getState().historyState).toEqual({ canBack: false, canForward: false });
    viewerArrivesAt(0, 0);
    await navigateToDest('d1');
    expect(useViewer.getState().historyState).toEqual({ canBack: true, canForward: false });
    goBack();
    expect(useViewer.getState().historyState).toEqual({ canBack: false, canForward: true });
  });

  it('atrás sin historial no hace nada', () => {
    const before = useViewer.getState().navRequest;
    goBack();
    goForward();
    expect(useViewer.getState().navRequest).toBe(before);
  });

  it('la pila se limita a 50 posiciones', async () => {
    viewerArrivesAt(0, 0);
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      await navigateToDest('d1');
      viewerArrivesAt(3, 0.1);
    }
    let steps = 0;
    while (useViewer.getState().historyState.canBack) {
      goBack();
      steps += 1;
    }
    expect(steps).toBe(MAX_HISTORY);
  });

  it('un destino irresoluble muestra el aviso y no toca el historial', async () => {
    viewerArrivesAt(0, 0);
    await navigateToDest('d1');
    viewerArrivesAt(3, 0.1);
    await navigateToDest('roto');
    expect(useViewer.getState().notice?.text).toBe(msg.linkBroken);
    expect(useViewer.getState().historyState).toEqual({ canBack: true, canForward: false });
  });

  it('abrir otro documento vacía el historial', async () => {
    viewerArrivesAt(0, 0);
    await navigateToDest('d1');
    useViewer.setState({ pdf: { doc: {} } as unknown as LoadedPdf });
    expect(useViewer.getState().historyState).toEqual({ canBack: false, canForward: false });
  });

  it('un destino con zoom lo aplica antes de ir', async () => {
    viewerArrivesAt(0, 0);
    await navigateToDest('d3');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'fit-width' });
    expect(lastRequest()).toMatchObject({ page: 7, yFraction: 0.3 });
  });
});

describe('acciones con nombre', () => {
  it('next-page, prev-page, first-page y last-page mueven las páginas', () => {
    useViewer.setState({ currentPage: 4 });
    runNamedAction('next-page');
    expect(lastRequest().page).toBe(5);
    runNamedAction('prev-page');
    expect(lastRequest().page).toBe(3);
    runNamedAction('last-page');
    expect(lastRequest().page).toBe(9);
    runNamedAction('first-page');
    expect(lastRequest().page).toBe(0);
  });

  it('back y forward usan el historial', async () => {
    viewerArrivesAt(0, 0);
    await navigateToDest('d1');
    viewerArrivesAt(3, 0.1);
    runNamedAction('back');
    expect(lastRequest().page).toBe(0);
    runNamedAction('forward');
    expect(lastRequest().page).toBe(3);
  });
});
