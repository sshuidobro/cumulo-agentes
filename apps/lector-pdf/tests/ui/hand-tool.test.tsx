// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource } from '@suite/platform';
import { PageDimsTable } from '../../src/core/page-dims';
import { useShortcuts } from '../../src/ui/use-shortcuts';
import { MainToolbar } from '../../src/ui/toolbar/MainToolbar';
import { Viewer } from '../../src/ui/viewer/Viewer';
import { initServices } from '../../src/state/services';
import { setViewTool } from '../../src/state/view-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { openedFile, createFakePlatform } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';

const VIEW_W = 1000;
const VIEW_H = 800;

/** Ventana de Pointer Events: jsdom no la tiene. Conserva `pointerId` y las coordenadas del ratón. */
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { readonly pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

/** Renderiza el visor con 20 páginas y un viewport simulado. El desplazamiento del navegador se simula con `scrollTop`. */
function setupViewer(): HTMLElement {
  const dims = PageDimsTable.uniform(20, 612, 792, 0);
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims,
    dimsVersion: 1,
    zoomMode: { kind: 'custom', zoom: 1 },
  });
  render(<Viewer />);
  const region = screen.getByRole('region', { name: 'Documento «pages.pdf»' });
  Object.defineProperty(region, 'clientWidth', { configurable: true, value: VIEW_W });
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: VIEW_H });
  Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 });
  act(() => {
    FakeResizeObserver.triggerResize(region);
  });
  return region;
}

/** Cambia la herramienta del visor dentro de `act`, como lo haría una acción de la interfaz. */
function selectTool(tool: 'select' | 'hand'): void {
  act(() => {
    setViewTool(tool);
  });
}

/** Mismos manejadores de teclado que `App`, sobre el registro real de atajos. */
function ShortcutHarness() {
  useShortcuts({
    'tool-select': () => {
      setViewTool('select');
    },
    'tool-hand': () => {
      setViewTool('hand');
    },
  });
  return <textarea aria-label="Nota" />;
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  FakeResizeObserver.instances = [];
  useViewer.setState(initialViewerState);
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }),
    assetBaseUrl: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
});

describe('herramienta mano', () => {
  it('con la mano, arrastrar 100 px hacia arriba desplaza el visor 100 px', () => {
    const region = setupViewer();
    selectTool('hand');

    fireEvent.pointerDown(region, { pointerId: 1, button: 0, clientY: 500 });
    fireEvent.pointerMove(region, { pointerId: 1, button: 0, clientY: 400 });
    fireEvent.pointerUp(region, { pointerId: 1, button: 0, clientY: 400 });

    expect(region.scrollTop).toBe(100);
  });

  it('el arrastre sigue al puntero en cada movimiento y se detiene al soltar', () => {
    const region = setupViewer();
    selectTool('hand');

    fireEvent.pointerDown(region, { pointerId: 1, button: 0, clientY: 500 });
    fireEvent.pointerMove(region, { pointerId: 1, button: 0, clientY: 450 });
    fireEvent.pointerMove(region, { pointerId: 1, button: 0, clientY: 420 });
    fireEvent.pointerUp(region, { pointerId: 1, button: 0, clientY: 420 });
    fireEvent.pointerMove(region, { pointerId: 1, button: 0, clientY: 100 });

    expect(region.scrollTop).toBe(80);
  });

  it('con la herramienta de selección, arrastrar no desplaza el visor', () => {
    const region = setupViewer();

    fireEvent.pointerDown(region, { pointerId: 1, button: 0, clientY: 500 });
    fireEvent.pointerMove(region, { pointerId: 1, button: 0, clientY: 400 });

    expect(region.scrollTop).toBe(0);
  });

  it('solo responde al botón principal del ratón', () => {
    const region = setupViewer();
    selectTool('hand');

    fireEvent.pointerDown(region, { pointerId: 1, button: 2, clientY: 500 });
    fireEvent.pointerMove(region, { pointerId: 1, button: 2, clientY: 400 });

    expect(region.scrollTop).toBe(0);
  });

  it('el visor refleja la herramienta en su atributo y en la barra con aria-pressed', () => {
    const region = setupViewer();
    render(<MainToolbar />);

    expect(region).toHaveAttribute('data-tool', 'select');
    expect(screen.getByRole('button', { name: 'Herramienta de selección' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Herramienta mano' }));

    expect(useViewer.getState().tool).toBe('hand');
    expect(region).toHaveAttribute('data-tool', 'hand');
    expect(screen.getByRole('button', { name: 'Herramienta mano' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Herramienta de selección' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('atajos V y H', () => {
  it('H activa la mano y V vuelve a la selección', () => {
    render(<ShortcutHarness />);

    fireEvent.keyDown(document.body, { key: 'h' });
    expect(useViewer.getState().tool).toBe('hand');

    fireEvent.keyDown(document.body, { key: 'v' });
    expect(useViewer.getState().tool).toBe('select');
  });

  it('dentro de un campo de texto, H se escribe y no cambia la herramienta', () => {
    render(<ShortcutHarness />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nota' }), { key: 'h' });

    expect(useViewer.getState().tool).toBe('select');
  });
});
