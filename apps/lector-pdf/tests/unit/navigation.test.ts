import { beforeEach, describe, expect, it } from 'vitest';
import {
  firstPage,
  goToPage,
  lastPage,
  nextPage,
  prevPage,
  setCurrentPage,
  setHorizontalOverflow,
} from '../../src/state/navigation';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { PageDimsTable } from '../../src/core/page-dims';

function withPages(count: number): void {
  useViewer.setState({ ...initialViewerState, dims: PageDimsTable.uniform(count, 612, 792, 0), dimsVersion: 1 });
}

beforeEach(() => {
  useViewer.setState(initialViewerState);
});

describe('goToPage', () => {
  it('acota la página a [0, último]', () => {
    withPages(5000);
    goToPage(-3);
    expect(useViewer.getState().navRequest?.page).toBe(0);
    goToPage(99999);
    expect(useViewer.getState().navRequest?.page).toBe(4999);
    goToPage(4999);
    expect(useViewer.getState().navRequest?.page).toBe(4999);
  });

  it('trunca a entero y usa posición por defecto (arriba, sin X)', () => {
    withPages(10);
    goToPage(3.7);
    expect(useViewer.getState().navRequest).toMatchObject({ page: 3, yFraction: 0, xFraction: null });
  });

  it('acota las fracciones de posición a [0, 1]', () => {
    withPages(10);
    goToPage(2, { yFraction: 1.5, xFraction: -0.2 });
    expect(useViewer.getState().navRequest).toMatchObject({ page: 2, yFraction: 1, xFraction: 0 });
  });

  it('da un seq creciente a cada petición, aunque sea la misma página', () => {
    withPages(10);
    goToPage(4);
    const first = useViewer.getState().navRequest?.seq ?? -1;
    goToPage(4);
    const second = useViewer.getState().navRequest?.seq ?? -1;
    expect(second).toBeGreaterThan(first);
  });

  it('sin dimensiones no hace nada', () => {
    goToPage(3);
    expect(useViewer.getState().navRequest).toBeNull();
  });

  it('rechaza un número no finito como bug del llamante', () => {
    withPages(10);
    expect(() => goToPage(Number.NaN)).toThrow(RangeError);
  });
});

describe('setCurrentPage', () => {
  it('cambia la página actual', () => {
    setCurrentPage(7);
    expect(useViewer.getState().currentPage).toBe(7);
  });

  it('no vuelve a escribir el estado si la página no cambia', () => {
    setCurrentPage(7);
    const before = useViewer.getState();
    setCurrentPage(7);
    expect(useViewer.getState()).toBe(before);
  });
});

describe('nextPage, prevPage, firstPage, lastPage', () => {
  function requestedPage(): number | undefined {
    return useViewer.getState().navRequest?.page;
  }

  it('siguiente y anterior se mueven sobre la página actual', () => {
    withPages(10);
    setCurrentPage(4);
    nextPage();
    expect(requestedPage()).toBe(5);
    setCurrentPage(4);
    prevPage();
    expect(requestedPage()).toBe(3);
  });

  it('no salen de los extremos y no piden navegación', () => {
    withPages(10);
    setCurrentPage(9);
    nextPage();
    expect(useViewer.getState().navRequest).toBeNull();
    setCurrentPage(0);
    prevPage();
    expect(useViewer.getState().navRequest).toBeNull();
  });

  it('primera y última van a los extremos del documento', () => {
    withPages(5000);
    setCurrentPage(10);
    lastPage();
    expect(requestedPage()).toBe(4999);
    firstPage();
    expect(requestedPage()).toBe(0);
  });

  it('sin documento no hace nada', () => {
    nextPage();
    prevPage();
    firstPage();
    lastPage();
    expect(useViewer.getState().navRequest).toBeNull();
  });
});

describe('setHorizontalOverflow', () => {
  it('escribe solo cuando cambia el valor', () => {
    setHorizontalOverflow(false);
    const before = useViewer.getState();
    setHorizontalOverflow(false);
    expect(useViewer.getState()).toBe(before);
    setHorizontalOverflow(true);
    expect(useViewer.getState().hasHorizontalOverflow).toBe(true);
  });
});
