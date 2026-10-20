// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewer } from '../../src/ui/viewer/Viewer';
import { IDLE_CURSOR_MS } from '../../src/ui/viewer/use-idle-cursor';
import { PageDimsTable } from '../../src/core/page-dims';
import { useFullscreen } from '../../src/state/fullscreen-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { memorySource } from '@suite/platform';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';

/** Visor de prueba: 5 páginas, viewport 1000 × 800. */
function setup(): HTMLElement {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(5, 612, 792, 0),
    dimsVersion: 1,
    zoomMode: { kind: 'fit-page' },
    viewMode: { scroll: 'paged', spread: 'none' },
  });
  render(<Viewer />);
  const region = screen.getByRole('region', { name: 'Documento «pages.pdf»' });
  Object.defineProperty(region, 'clientWidth', { configurable: true, value: 1000 });
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: 800 });
  act(() => {
    FakeResizeObserver.triggerResize(region);
  });
  return region;
}

function frameOf(index: number): HTMLElement {
  const frame = document.querySelector<HTMLElement>(`[data-page-index="${String(index)}"]`);
  if (frame === null) throw new Error(`Marco ${String(index)} no montado`);
  return frame;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  FakeResizeObserver.instances = [];
  useViewer.setState(initialViewerState);
  useFullscreen.setState({ on: true });
});

afterEach(() => {
  vi.useRealTimers();
  useFullscreen.setState({ on: false });
});

describe('Viewer en pantalla completa (PDF-097)', () => {
  it('un clic izquierdo sobre una página pasa a la página siguiente', () => {
    const region = setup();
    expect(region).toHaveAttribute('data-current-page', '1');
    fireEvent.click(frameOf(0), { button: 0 });
    expect(region).toHaveAttribute('data-current-page', '2');
    expect(useViewer.getState().currentPage).toBe(1);
  });

  it('un clic derecho no cambia de página', () => {
    const region = setup();
    fireEvent.click(frameOf(0), { button: 2 });
    expect(region).toHaveAttribute('data-current-page', '1');
  });

  it('un clic en un enlace no pasa de página: el enlace conserva su clic', () => {
    const region = setup();
    const frame = frameOf(0);
    const link = document.createElement('a');
    link.setAttribute('href', '#');
    frame.appendChild(link);
    fireEvent.click(link, { button: 0 });
    expect(region).toHaveAttribute('data-current-page', '1');
  });

  it('fuera de pantalla completa, un clic en la página no cambia de página', () => {
    useFullscreen.setState({ on: false });
    const region = setup();
    fireEvent.click(frameOf(0), { button: 0 });
    expect(region).toHaveAttribute('data-current-page', '1');
  });

  it('la pantalla completa marca el visor con su clase de fondo negro', () => {
    const region = setup();
    expect(region.className).toMatch(/fullscreen/);
  });
});

describe('cursor en pantalla completa', () => {
  it('se oculta tras dos segundos sin mover el ratón y vuelve a mostrarse al moverlo', () => {
    vi.useFakeTimers();
    const region = setup();
    expect(region).not.toHaveAttribute('data-idle');
    act(() => {
      vi.advanceTimersByTime(IDLE_CURSOR_MS - 1);
    });
    expect(region).not.toHaveAttribute('data-idle');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region).toHaveAttribute('data-idle', 'true');
    act(() => {
      fireEvent.pointerMove(window);
    });
    expect(region).not.toHaveAttribute('data-idle');
  });
});
