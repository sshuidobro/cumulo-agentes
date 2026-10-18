import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, type KeyValueStore, type Platform } from '@suite/platform';
import type { LoadedPdf } from '../../src/engine';
import { lookupPosition, isPositionsState, type PositionsState } from '../../src/core/reading-positions';
import { PageDimsTable } from '../../src/core/page-dims';
import { flushPosition, POSITIONS_PREF_KEY, startPositionSync } from '../../src/state/position-sync';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

// Store real, preferencias en memoria y temporizadores falsos: el guardado es determinista.
let prefs: KeyValueStore;
let writes: { key: string; value: unknown }[];
let stop: () => void;

/** Documento listo con `count` páginas y huella `fingerprint`, sin cargar ningún PDF real. */
function readyDoc(fingerprint: string, count: number): Partial<typeof initialViewerState> {
  return {
    status: 'ready',
    pdf: { fingerprint } as unknown as LoadedPdf,
    dims: PageDimsTable.uniform(count, 612, 792, 0),
    dimsVersion: 1,
  };
}

function storedPositions(): PositionsState {
  const raw = prefs.get(POSITIONS_PREF_KEY, isPositionsState);
  if (raw === null) throw new Error('No hay posiciones guardadas');
  return raw;
}

/** Abre un documento por la transición real: primero «cargando», luego «listo». */
function open(fingerprint: string, count: number): void {
  useViewer.setState({ ...initialViewerState, status: 'loading' });
  useViewer.setState(readyDoc(fingerprint, count));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  useViewer.setState(initialViewerState);
  prefs = createStorageStore(null, 'test.');
  writes = [];
  // Cada escritura queda registrada además de guardarse en memoria.
  const counted: KeyValueStore = {
    get: prefs.get,
    remove: prefs.remove,
    set: (key, value) => {
      writes.push({ key, value });
      prefs.set(key, value);
    },
  };
  const platform: Platform = createFakePlatform({ prefs: counted });
  initServices({ platform, assetBaseUrl: 'http://test/pdfjs/' });
  stop = startPositionSync();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('guardado de la posición', () => {
  it('cambiar de página 5 veces en 500 ms produce una sola escritura tras 1 s', () => {
    open('fp-sync', 50);
    for (let page = 1; page <= 5; page++) {
      useViewer.setState({ currentPage: page });
      vi.advanceTimersByTime(100);
    }
    expect(writes).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
    expect(lookupPosition(storedPositions(), 'fp-sync')?.page).toBe(5);
  });

  it('flushPosition escribe al momento, con la página, la fracción, el zoom y la rotación actuales', () => {
    open('fp-flush', 50);
    useViewer.setState({ currentPage: 7, currentYFraction: 0.4, zoomMode: { kind: 'custom', zoom: 1.5 }, rotation: 270 });

    flushPosition();

    expect(writes).toHaveLength(1);
    expect(lookupPosition(storedPositions(), 'fp-flush')).toMatchObject({
      page: 7,
      yFraction: 0.4,
      zoomMode: { kind: 'custom', zoom: 1.5 },
      rotation: 270,
    });
  });

  it('el cambio pendiente se cancela al hacer flush: no hay escritura duplicada', () => {
    open('fp-once', 50);
    useViewer.setState({ currentPage: 3 });
    flushPosition();
    vi.advanceTimersByTime(2000);
    expect(writes).toHaveLength(1);
  });

  it('pagehide guarda al instante', () => {
    open('fp-hide', 50);
    useViewer.setState({ currentPage: 9 });
    window.dispatchEvent(new Event('pagehide'));
    expect(lookupPosition(storedPositions(), 'fp-hide')?.page).toBe(9);
  });

  it('sin documento listo no escribe nada', () => {
    flushPosition();
    expect(writes).toHaveLength(0);
  });

  it('un valor corrupto en las preferencias se trata como vacío y se sustituye al guardar', () => {
    prefs.set(POSITIONS_PREF_KEY, { version: 2, entries: 'roto' });
    open('fp-corrupt', 50);
    useViewer.setState({ currentPage: 2 });
    flushPosition();

    const state = storedPositions();
    expect(state.entries).toHaveLength(1);
    expect(lookupPosition(state, 'fp-corrupt')?.page).toBe(2);
  });
});

describe('restauración al abrir', () => {
  it('con posición guardada en la página 42 (índice 41), zoom fit-page y rotación 90 → va a esa página y ajusta', () => {
    prefs.set(POSITIONS_PREF_KEY, {
      version: 1,
      entries: [
        [
          'fp-restore',
          { page: 41, yFraction: 0.25, zoomMode: { kind: 'fit-page' }, rotation: 90, updatedAt: 1 },
        ],
      ],
    });

    open('fp-restore', 50);

    const state = useViewer.getState();
    expect(state.zoomMode).toEqual({ kind: 'fit-page' });
    expect(state.rotation).toBe(90);
    expect(state.navRequest).toMatchObject({ page: 41, yFraction: 0.25, xFraction: null });
  });

  it('una posición con página 900 en un documento de 10 páginas se ignora', () => {
    prefs.set(POSITIONS_PREF_KEY, {
      version: 1,
      entries: [
        ['fp-far', { page: 900, yFraction: 0, zoomMode: { kind: 'fit-width' }, rotation: 180, updatedAt: 1 }],
      ],
    });

    open('fp-far', 10);

    const state = useViewer.getState();
    expect(state.navRequest).toBeNull();
    expect(state.zoomMode).toEqual(initialViewerState.zoomMode);
    expect(state.rotation).toBe(0);
  });

  it('un documento sin posición guardada empieza en la página 1 con el modo por defecto', () => {
    open('fp-new', 5);
    expect(useViewer.getState().navRequest).toBeNull();
    expect(useViewer.getState().zoomMode).toEqual(initialViewerState.zoomMode);
  });

  it('al cambiar de documento, el anterior se guarda antes de sustituirlo (el llamante hace flush primero)', () => {
    open('fp-a', 50);
    useViewer.setState({ currentPage: 12 });
    // Mismo orden que `openDocument`: flush mientras el documento anterior sigue en el store.
    flushPosition();
    useViewer.setState({ ...initialViewerState, status: 'loading' });
    expect(lookupPosition(storedPositions(), 'fp-a')?.page).toBe(12);
    // Después de sustituirlo ya no hay nada que guardar.
    flushPosition();
    expect(writes).toHaveLength(1);
  });
});
