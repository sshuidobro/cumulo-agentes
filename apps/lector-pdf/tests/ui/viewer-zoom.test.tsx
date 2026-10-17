// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Viewer } from '../../src/ui/viewer/Viewer';
import { computeLayout, DEFAULT_GAP, DEFAULT_PADDING, scrollMap } from '../../src/core/layout';
import { PageDimsTable } from '../../src/core/page-dims';
import { zoomToScale, wheelZoom } from '../../src/core/zoom';
import { rotateView, zoomIn } from '../../src/state/view-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { memorySource } from '@suite/platform';
import { openedFile } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';

const VIEW_W = 1000;
const VIEW_H = 800;

/** Renderiza el visor con `count` páginas de US Letter a `zoom` y un viewport de VIEW_W × VIEW_H. */
function setup(count: number, zoom: number): { region: HTMLElement; dims: PageDimsTable } {
  const dims = PageDimsTable.uniform(count, 612, 792, 0);
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims,
    dimsVersion: 1,
    zoomMode: { kind: 'custom', zoom },
    zoom,
  });
  render(<Viewer />);
  const region = screen.getByRole('region', { name: 'Documento «pages.pdf»' });
  Object.defineProperty(region, 'clientWidth', { configurable: true, value: VIEW_W });
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: VIEW_H });
  Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(region, 'scrollLeft', { configurable: true, writable: true, value: 0 });
  act(() => {
    FakeResizeObserver.triggerResize(region);
  });
  return { region, dims };
}

function layoutAt(dims: PageDimsTable, zoom: number, rotation: 0 | 90 | 180 | 270 = 0) {
  return computeLayout(dims, { scale: zoomToScale(zoom), rotation, gap: DEFAULT_GAP, padding: DEFAULT_PADDING });
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  useViewer.setState(initialViewerState);
});

describe('Viewer · zoom anclado al punto indicado', () => {
  it('zoomIn con foco a 200 px mantiene la misma posición del documento bajo ese punto', async () => {
    const { region, dims } = setup(50, 1);
    const before = layoutAt(dims, 1);
    // El punto a 200 px del borde superior está en la página 10, a 200 px de su borde superior.
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: (before.tops[10] ?? 0) });
    fireEvent.scroll(region);

    act(() => {
      zoomIn(200);
    });

    const after = layoutAt(dims, 1.1);
    const map = scrollMap(after, VIEW_H);
    const fraction = 200 / (before.heights[10] ?? 1);
    const expectedContentY = (after.tops[10] ?? 0) + fraction * (after.heights[10] ?? 0) - 200;
    await waitFor(() => {
      expect(region.scrollTop).toBeCloseTo(expectedContentY / map.factor, 0);
    });
    expect(useViewer.getState().zoomFocusY).toBeNull();
  });

  it('un zoom sin cambio de layout (ya en el máximo) no deja un foco pendiente', async () => {
    setup(20, 8);
    act(() => {
      zoomIn(100);
    });
    await waitFor(() => expect(useViewer.getState().zoomFocusY).toBeNull());
  });

  it('girar la vista conserva el centro del visor', async () => {
    const { region, dims } = setup(50, 1);
    const before = layoutAt(dims, 1);
    const centerPage = 10;
    const centerContentY = (before.tops[centerPage] ?? 0) + (before.heights[centerPage] ?? 0) / 2;
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: centerContentY - VIEW_H / 2 });
    fireEvent.scroll(region);

    act(() => {
      rotateView(1);
    });

    const turned = layoutAt(dims, 1, 90);
    const expected = (turned.tops[centerPage] ?? 0) + (turned.heights[centerPage] ?? 0) / 2 - VIEW_H / 2;
    await waitFor(() => {
      expect(region.scrollTop).toBeCloseTo(expected, 0);
    });
  });
});

describe('Viewer · Ctrl+rueda', () => {
  it('Ctrl+rueda cambia el zoom (con preventDefault) y sin Ctrl la rueda no hace zoom', async () => {
    const { region } = setup(20, 1);

    const notPrevented = fireEvent.wheel(region, { deltaY: -100 });
    expect(notPrevented).toBe(true);
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1 });

    const prevented = fireEvent.wheel(region, { deltaY: -100, ctrlKey: true, clientY: 300 });
    expect(prevented).toBe(false);

    await waitFor(() => {
      expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: wheelZoom(1, -100, 0) });
    });
    // El foco se aplica en el cambio de layout y después se consume.
    expect(useViewer.getState().zoomFocusY).toBeNull();
  });
});
