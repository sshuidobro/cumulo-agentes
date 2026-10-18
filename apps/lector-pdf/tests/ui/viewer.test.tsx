// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Viewer } from '../../src/ui/viewer/Viewer';
import { computeLayout, DEFAULT_GAP, DEFAULT_PADDING, scrollMap } from '../../src/core/layout';
import { PageDimsTable } from '../../src/core/page-dims';
import { zoomToScale } from '../../src/core/zoom';
import { goToPage, lastPage } from '../../src/state/navigation';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { memorySource } from '@suite/platform';
import { openedFile } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';

const VIEW_W = 1000;
const VIEW_H = 800;
/** Página US Letter a zoom 1: 792 pt × 4/3 px de alto. */
const PAGE_H = 1056;

function mountedIndices(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-page-index]')).map((n) =>
    Number(n.dataset.pageIndex),
  );
}

/** Renderiza el visor con `count` páginas y un viewport simulado de VIEW_W × VIEW_H. */
function setup(count: number, zoom = 1): { region: HTMLElement; dims: PageDimsTable } {
  const dims = PageDimsTable.uniform(count, 612, 792, 0);
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims,
    dimsVersion: 1,
    zoomMode: { kind: 'custom', zoom },
  });
  render(<Viewer />);
  const region = screen.getByRole('region', { name: 'Documento «pages.pdf»' });
  Object.defineProperty(region, 'clientWidth', { configurable: true, value: VIEW_W });
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: VIEW_H });
  Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 });
  act(() => {
    FakeResizeObserver.triggerResize(region);
  });
  return { region, dims };
}

function totalHeight(dims: PageDimsTable, zoom: number): number {
  return computeLayout(dims, { scale: zoomToScale(zoom), rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING })
    .totalHeight;
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  useViewer.setState(initialViewerState);
});

describe('Viewer · virtualización', () => {
  it('con 5 000 páginas monta como mucho 5 marcos, y tras ir a la mitad sigue con ≤ 5 cerca de la 2 500', async () => {
    const { region, dims } = setup(5000);
    expect(mountedIndices().length).toBeLessThanOrEqual(5);

    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: totalHeight(dims, 1) / 2 });
    fireEvent.scroll(region);

    await waitFor(() => {
      const indices = mountedIndices();
      expect(indices.length).toBeLessThanOrEqual(5);
      expect(indices.some((i) => Math.abs(i - 2500) <= 2)).toBe(true);
    });
  });

  it('goToPage monta la página pedida y la deja como actual; las peticiones fuera de rango se acotan', async () => {
    setup(5000);

    act(() => goToPage(4999));
    await waitFor(() => expect(document.querySelector('[data-page-index="4999"]')).not.toBeNull());
    expect(useViewer.getState().currentPage).toBe(4999);

    act(() => goToPage(-3));
    await waitFor(() => expect(document.querySelector('[data-page-index="0"]')).not.toBeNull());
    expect(useViewer.getState().currentPage).toBe(0);

    act(() => goToPage(99999));
    await waitFor(() => expect(useViewer.getState().currentPage).toBe(4999));
  });

  it('con 100 000 páginas (escalado de scroll), End monta la última y la rueda mueve el contenido 100 px', async () => {
    const { region, dims } = setup(100_000);
    const map = scrollMap(
      computeLayout(dims, { scale: zoomToScale(1), rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING }),
      VIEW_H,
    );
    expect(map.factor).toBeGreaterThan(1);

    fireEvent.wheel(region, { deltaY: 100 });
    await waitFor(() => expect(region.scrollTop).toBeCloseTo(100 / map.factor, 6));
    expect(region.scrollTop).not.toBeCloseTo(100 * map.factor, 0);

    // «Fin» es ahora un atajo global de navegación (PDF-012): el visor solo muestra la página pedida.
    act(() => { lastPage(); });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Página 100000 de 100000' })).toBeVisible());
  });

  it('con 5 000 páginas (sin escalado), el visor no atiende «Fin» (es atajo global) y no monta de más', () => {
    const { region } = setup(5000);
    fireEvent.keyDown(region, { key: 'End' });
    expect(region.scrollTop).toBe(0);
    expect(mountedIndices().length).toBeLessThanOrEqual(5);
  });
});

describe('Viewer · desbordamiento horizontal', () => {
  it('marca el desbordamiento cuando el contenido es más ancho que el visor, y lo quita al volver a un zoom que cabe', async () => {
    setup(3, 3);
    await waitFor(() => expect(useViewer.getState().hasHorizontalOverflow).toBe(true));

    act(() => {
      useViewer.setState({ zoomMode: { kind: 'custom', zoom: 0.5 }, zoom: 0.5 });
    });
    await waitFor(() => expect(useViewer.getState().hasHorizontalOverflow).toBe(false));
  });
});

describe('Viewer · ancla al cambiar zoom o dimensiones', () => {
  it('cambiar el zoom o cambiar páginas anteriores no mueve la página actual', async () => {
    const { region, dims } = setup(5000, 1);
    const tops = computeLayout(dims, { scale: zoomToScale(1), rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING }).tops;
    const middleOf300 = (tops[300] ?? 0) + PAGE_H / 2;

    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: middleOf300 });
    fireEvent.scroll(region);
    await waitFor(() => expect(useViewer.getState().currentPage).toBe(300));

    act(() => useViewer.setState({ zoomMode: { kind: 'custom', zoom: 2 } }));
    await waitFor(() => expect(useViewer.getState().zoom).toBe(2));
    expect(useViewer.getState().currentPage).toBe(300);

    act(() => {
      dims.set(10, 612, 1400, 0);
      useViewer.setState({ dimsVersion: useViewer.getState().dimsVersion + 1 });
    });
    expect(useViewer.getState().currentPage).toBe(300);
  });
});

describe('Viewer · regresión: zoom automático con tamaños mezclados', () => {
  it('con modo automático y páginas de tamaños distintos, desplazarse no provoca bucle de actualizaciones', async () => {
    const count = 40;
    const dims = PageDimsTable.uniform(count, 612, 792, 0);
    // Páginas alternas apaisadas: cambiar de página cambia el zoom automático y, con él, el layout.
    for (let i = 1; i < count; i += 2) dims.set(i, 792, 612, 0);
    useViewer.setState({
      ...initialViewerState,
      status: 'ready',
      file: openedFile('sizes.pdf', memorySource(new Uint8Array([0x25]))),
      dims,
      dimsVersion: 1,
      zoomMode: { kind: 'auto' },
    });
    render(<Viewer />);
    const region = screen.getByRole('region', { name: 'Documento «sizes.pdf»' });
    Object.defineProperty(region, 'clientWidth', { configurable: true, value: VIEW_W });
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: VIEW_H });
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 });
    act(() => {
      FakeResizeObserver.triggerResize(region);
    });

    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    // La propiedad protegida: el zoom automático no cambia al desplazarse (la página de referencia no depende de la actual).
    const zoomAtStart = useViewer.getState().zoom;
    expect(zoomAtStart).toBeGreaterThan(0);
    try {
      for (let step = 1; step <= 12; step++) {
        const page = step * 3;
        // El zoom automático cambia tras cada salto: el objetivo se calcula con el zoom que tiene el visor ahora.
        const layout = computeLayout(dims, {
          scale: zoomToScale(useViewer.getState().zoom),
          rotation: 0,
          gap: DEFAULT_GAP,
          padding: DEFAULT_PADDING,
        });
        // La página actual es la que queda en el tercio superior: se sitúa su centro ahí.
        const target = (layout.tops[page] ?? 0) + (layout.heights[page] ?? 0) / 2 - VIEW_H / 3;
        Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: target });
        fireEvent.scroll(region);
        await waitFor(() => expect(useViewer.getState().currentPage).toBe(page));
        expect(useViewer.getState().zoom).toBe(zoomAtStart);
      }
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
    expect(useViewer.getState().zoom).toBe(zoomAtStart);
  });
});

describe('Viewer · accesibilidad', () => {
  it('es un área enfocable con Tab que recibe el foco al abrir, y cada página tiene su etiqueta', async () => {
    const { region } = setup(5);
    await waitFor(() => expect(document.activeElement).toBe(region));
    expect(region).toHaveAttribute('tabindex', '0');

    const pages = screen.getAllByRole('group');
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toHaveAttribute('aria-label', 'Página 1 de 5');
  });
});
