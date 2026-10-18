import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageDimsTable } from '../../src/core/page-dims';
import { MAX_ZOOM, wheelZoom } from '../../src/core/zoom';
import { isViewMode } from '../../src/core/view-mode';
import { initServices } from '../../src/state/services';
import {
  loadViewMode,
  rotateView,
  setViewMode,
  setZoomMode,
  VIEW_MODE_PREF,
  zoomIn,
  zoomOut,
  zoomWithWheel,
} from '../../src/state/view-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Fotogramas simulados: `requestAnimationFrame` guarda los callbacks hasta que el test los ejecuta. */
let frames: Array<() => void> = [];

function runFrame(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback();
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  useViewer.setState({ ...initialViewerState, status: 'ready' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zoomIn / zoomOut', () => {
  it('con zoom efectivo 1, ampliar pasa a zoom personalizado 1.1 y reducir desde 1.1 vuelve a 1', () => {
    useViewer.setState({ zoom: 1 });
    zoomIn();
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.1 });

    useViewer.setState({ zoom: 1.1 });
    zoomOut();
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1 });
  });

  it('sin foco explícito el foco es el centro del visor; con foco, se guarda el punto', () => {
    useViewer.setState({ zoom: 1 });
    zoomIn();
    expect(useViewer.getState().zoomFocusY).toBe('center');

    zoomOut(120);
    expect(useViewer.getState().zoomFocusY).toBe(120);
  });

  it('en el máximo el zoom no cambia', () => {
    useViewer.setState({ zoom: MAX_ZOOM });
    zoomIn();
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: MAX_ZOOM });
  });
});

describe('setZoomMode', () => {
  it('guarda el modo tal cual y el foco', () => {
    setZoomMode({ kind: 'fit-page' });
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'fit-page' });
    expect(useViewer.getState().zoomFocusY).toBe('center');
  });
});

describe('rotateView', () => {
  it('desde 0, girar a la izquierda da 270; cuatro giros a la derecha vuelven a 0', () => {
    rotateView(-1);
    expect(useViewer.getState().rotation).toBe(270);

    useViewer.setState({ rotation: 0 });
    for (let i = 0; i < 4; i++) rotateView(1);
    expect(useViewer.getState().rotation).toBe(0);
  });

  it('el giro mantiene el centro del visor como foco', () => {
    rotateView(1);
    expect(useViewer.getState().zoomFocusY).toBe('center');
  });
});

describe('zoomWithWheel', () => {
  it('no cambia el zoom hasta el siguiente fotograma', () => {
    useViewer.setState({ zoom: 1 });
    zoomWithWheel(-100, 0, 300);
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'auto' });
    expect(frames).toHaveLength(1);

    runFrame();
    const expected = wheelZoom(1, -100, 0);
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: expected });
    expect(useViewer.getState().zoomFocusY).toBe(300);
  });

  it('varias ruedas en el mismo fotograma se acumulan en un único cambio con el último foco', () => {
    useViewer.setState({ zoom: 1 });
    zoomWithWheel(-40, 0, 100);
    zoomWithWheel(-40, 0, 150);
    zoomWithWheel(1, 1, 200);
    expect(frames).toHaveLength(1);

    runFrame();
    let expected = 1;
    expected = wheelZoom(expected, -40, 0);
    expected = wheelZoom(expected, -40, 0);
    expected = wheelZoom(expected, 1, 1);
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: expected });
    expect(useViewer.getState().zoomFocusY).toBe(200);
  });

  it('tras un fotograma, una rueda nueva pide otro fotograma', () => {
    zoomWithWheel(-10, 0, 0);
    runFrame();
    zoomWithWheel(-10, 0, 0);
    expect(frames).toHaveLength(1);
  });
});

describe('preferencia del modo de vista', () => {
  /** Almacén en memoria con la misma semántica que las preferencias reales: valores JSON y guardia al leer. */
  function useStore(raw: Map<string, string>): void {
    initServices({
      platform: createFakePlatform({
        prefs: {
          get: <T>(key: string, guard: (v: unknown) => v is T): T | null => {
            const text = raw.get(key);
            if (text === undefined) return null;
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              return null;
            }
            return guard(parsed) ? parsed : null;
          },
          set: (key: string, value: unknown) => {
            raw.set(key, JSON.stringify(value));
          },
          remove: (key: string) => {
            raw.delete(key);
          },
        },
      }),
      assetBaseUrl: '/',
    });
  }

  it('setViewMode escribe el modo en las preferencias y lo deja en el store', () => {
    const raw = new Map<string, string>();
    useStore(raw);
    setViewMode({ scroll: 'paged', spread: 'cover' });
    expect(JSON.parse(raw.get(VIEW_MODE_PREF) ?? 'null')).toEqual({ scroll: 'paged', spread: 'cover' });
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'paged', spread: 'cover' });
  });

  it('loadViewMode recupera el modo guardado', () => {
    const raw = new Map<string, string>([[VIEW_MODE_PREF, JSON.stringify({ scroll: 'paged', spread: 'pairs' })]]);
    useStore(raw);
    loadViewMode();
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'paged', spread: 'pairs' });
  });

  it('loadViewMode con un valor corrupto deja el modo por defecto sin lanzar', () => {
    const raw = new Map<string, string>([[VIEW_MODE_PREF, JSON.stringify({ scroll: 'x', spread: 'none' })]]);
    useStore(raw);
    useViewer.setState({ viewMode: { scroll: 'paged', spread: 'cover' } });
    expect(() => {
      loadViewMode();
    }).not.toThrow();
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'continuous', spread: 'none' });
    expect(isViewMode(useViewer.getState().viewMode)).toBe(true);
  });

  it('al cambiar las páginas por fila, el visor va a la primera página de la fila actual', () => {
    useStore(new Map());
    useViewer.setState({ dims: PageDimsTable.uniform(10, 612, 792, 0), dimsVersion: 1, currentPage: 3 });
    setViewMode({ scroll: 'continuous', spread: 'pairs' });
    expect(useViewer.getState().currentPage).toBe(2);
    expect(useViewer.getState().navRequest?.page).toBe(2);
  });

  it('cambiar solo el desplazamiento no mueve la página', () => {
    useStore(new Map());
    useViewer.setState({ dims: PageDimsTable.uniform(10, 612, 792, 0), dimsVersion: 1, currentPage: 3 });
    setViewMode({ scroll: 'paged', spread: 'none' });
    expect(useViewer.getState().currentPage).toBe(3);
    expect(useViewer.getState().navRequest).toBeNull();
  });
});
