// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Viewer } from '../../src/ui/viewer/Viewer';
import { PageDimsTable } from '../../src/core/page-dims';
import type { ViewMode } from '../../src/core/view-mode';
import { goToPage } from '../../src/state/navigation';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { memorySource } from '@suite/platform';
import { openedFile } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';

const VIEW_W = 1000;
const VIEW_H = 800;
/** Página US Letter a zoom 1 (4/3 px por punto): 816 × 1056 px. */
const PAGE_W = 816;
const PAGE_H = 1056;

function mounted(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-page-index]'));
}

function mountedIndices(): number[] {
  return mounted().map((n) => Number(n.dataset.pageIndex));
}

function frameOf(index: number): HTMLElement {
  const frame = document.querySelector<HTMLElement>(`[data-page-index="${String(index)}"]`);
  if (frame === null) throw new Error(`Marco ${String(index)} no montado`);
  return frame;
}

/** Renderiza el visor con `count` páginas, el modo de vista dado y un viewport de VIEW_W × VIEW_H. */
function setup(count: number, viewMode: ViewMode): HTMLElement {
  const dims = PageDimsTable.uniform(count, 612, 792, 0);
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims,
    dimsVersion: 1,
    zoomMode: { kind: 'custom', zoom: 1 },
    viewMode,
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

beforeEach(() => {
  FakeResizeObserver.instances = [];
  useViewer.setState(initialViewerState);
});

describe('Viewer · páginas por fila', () => {
  it('doble página: las páginas 1 y 2 están en la misma fila, centradas en el ancho de la columna', () => {
    setup(5, { scroll: 'continuous', spread: 'pairs' });
    const first = frameOf(0);
    const second = frameOf(1);
    expect(first.style.top).toBe(second.style.top);
    // Columna de la fila doble: 2·816 + 12 px de hueco; el visor es más estrecho, así que el espaciador es de 1676 px.
    expect(first.style.left).toBe('16px');
    expect(second.style.left).toBe(`${String(16 + PAGE_W + 12)}px`);
  });

  it('doble página con portada: la 1 sola y centrada, la 2 y la 3 en la misma fila', () => {
    setup(5, { scroll: 'paged', spread: 'cover' });
    const cover = frameOf(0);
    expect(cover.style.left).toBe(`${String((1676 - PAGE_W) / 2)}px`);
    act(() => {
      goToPage(1);
    });
    expect(mountedIndices()).toEqual([1, 2]);
    expect(frameOf(1).style.top).toBe(frameOf(2).style.top);
    expect(frameOf(1).style.top).toBe('16px');
  });

  it('desplazamiento continuo con una página por fila no cambia la disposición de siempre', () => {
    setup(5, { scroll: 'continuous', spread: 'none' });
    expect(mountedIndices()).toEqual([0, 1]);
    expect(frameOf(1).style.top).toBe(`${String(16 + PAGE_H + 12)}px`);
  });

  it('una página a la vez: solo se montan los marcos de la fila mostrada', () => {
    setup(5, { scroll: 'paged', spread: 'pairs' });
    expect(mountedIndices()).toEqual([0, 1]);
    act(() => {
      goToPage(2);
    });
    expect(mountedIndices()).toEqual([2, 3]);
    // La fila ocupa la ventana: su primera página queda a 16 px del borde superior de la ventana.
    expect(frameOf(2).style.top).toBe('16px');
  });

  it('una página a la vez: la rueda desplaza dentro de la página y, al final, pasa a la siguiente arriba del todo', () => {
    const region = setup(5, { scroll: 'paged', spread: 'none' });
    // Ventana de 1 088 px en un visor de 800 px: el desplazamiento máximo es 288 px.
    fireEvent.wheel(region, { deltaY: 300 });
    expect(region.scrollTop).toBe(288);
    expect(mountedIndices()).toEqual([0]);

    // En el final, 60 px no bastan; con 120 px acumulados se pasa a la página 2.
    fireEvent.wheel(region, { deltaY: 60 });
    expect(mountedIndices()).toEqual([0]);
    fireEvent.wheel(region, { deltaY: 60 });
    expect(mountedIndices()).toEqual([1]);
    expect(region.scrollTop).toBe(0);
  });

  it('una página a la vez: la rueda hacia arriba al principio de la página 2 vuelve a la 1 abajo del todo', () => {
    const region = setup(5, { scroll: 'paged', spread: 'none' });
    act(() => {
      goToPage(1);
    });
    expect(mountedIndices()).toEqual([1]);
    fireEvent.wheel(region, { deltaY: -60 });
    fireEvent.wheel(region, { deltaY: -60 });
    expect(mountedIndices()).toEqual([0]);
    expect(region.scrollTop).toBe(288);
  });

  it('una página a la vez: Av Pág llega al final, y la siguiente pulsación pasa a la página 2', () => {
    const region = setup(5, { scroll: 'paged', spread: 'none' });
    fireEvent.keyDown(region, { key: 'PageDown' });
    expect(mountedIndices()).toEqual([0]);
    fireEvent.keyDown(region, { key: 'PageDown' });
    expect(mountedIndices()).toEqual([1]);
  });
});
