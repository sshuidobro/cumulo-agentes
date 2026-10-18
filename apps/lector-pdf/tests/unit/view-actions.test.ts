import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ZOOM, wheelZoom } from '../../src/core/zoom';
import { rotateView, setZoomMode, zoomIn, zoomOut, zoomWithWheel } from '../../src/state/view-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';

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
