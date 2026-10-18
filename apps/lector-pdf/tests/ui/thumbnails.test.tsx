// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import { PageDimsTable } from '../../src/core/page-dims';
import { Thumbnails } from '../../src/ui/sidebar/Thumbnails';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { renderQueue } from '../../src/state/render-service';
import { memorySource } from '@suite/platform';
import { openedFile } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';
import { renderPageToCanvas } from '../../src/engine/render';

// El dibujo real necesita un canvas con pdf.js: aquí cada miniatura se completa al instante y se cuentan las llamadas.
vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(async () => 'done' as const),
}));

const VIEW_H = 600;
const MAX_SCROLL_HEIGHT = 8_000_000;

/** Documento simulado: `getPage` devuelve una página con `id` y `rotate`, y cuenta las peticiones. */
function fakePdf(numPages: number) {
  const getPage = vi.fn(async (n: number) => ({ id: n, rotate: 0, cleanup: () => undefined }));
  const pdf = { numPages, doc: { numPages, getPage } } as unknown as LoadedPdf;
  return { pdf, getPage };
}

/** Pone el visor en estado listo con `count` páginas y monta las miniaturas con un viewport de VIEW_H px. */
function setup(count: number, labels: readonly string[] | null = null, height = VIEW_H) {
  const dims = PageDimsTable.uniform(count, 612, 792, 0);
  const { pdf, getPage } = fakePdf(count);
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('many.pdf', memorySource(new Uint8Array([0x25]))),
    pdf,
    dims,
    dimsVersion: 1,
    pageLabels: labels,
    sidebar: 'thumbnails',
  });
  render(<Thumbnails />);
  const list = screen.getByRole('listbox', { name: 'Miniaturas' });
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: 232 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 });
  act(() => {
    FakeResizeObserver.triggerResize(list);
  });
  return { list, getPage };
}

function options(): HTMLElement[] {
  return screen.queryAllByRole('option');
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.mocked(renderPageToCanvas).mockClear();
  useViewer.setState(initialViewerState);
});

/** Trabajos de prueba que retienen la cola hasta que el test los libera. */
const holders: Array<() => void> = [];

afterEach(() => {
  // Primero se vacía la cola y luego se liberan los trabajos retenidos, para que no entre nada más.
  renderQueue.cancelAll();
  for (const release of holders.splice(0)) release();
});

describe('Miniaturas · virtualización', () => {
  it('con 100 000 páginas y 600 px de alto monta como mucho 12 opciones, y al final de la lista sigue habiendo ≤ 12', async () => {
    const { list } = setup(100_000);
    expect(options().length).toBeGreaterThan(0);
    expect(options().length).toBeLessThanOrEqual(12);

    // Llevar el scroll al final del contenedor (el máximo que admite el navegador).
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      writable: true,
      value: MAX_SCROLL_HEIGHT - VIEW_H,
    });
    fireEvent.scroll(list);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Página 100000 de 100000' })).toBeInTheDocument());
    expect(options().length).toBeLessThanOrEqual(12);
  });

  it('muestra la etiqueta de página cuando existe y el número cuando no', () => {
    setup(3, ['i', 'ii']);
    const first = screen.getByRole('option', { name: 'Página 1 de 3' });
    const second = screen.getByRole('option', { name: 'Página 2 de 3' });
    const third = screen.getByRole('option', { name: 'Página 3 de 3' });
    expect(within(first).getByText('i')).toBeInTheDocument();
    expect(within(second).getByText('ii')).toBeInTheDocument();
    expect(within(third).getByText('3')).toBeInTheDocument();
  });
});

describe('Miniaturas · interacción', () => {
  it('clic en la miniatura 7 pide ir a la página 6 (índice 0) y la marca como actual', async () => {
    // Un panel de 1 000 px muestra unas cinco miniaturas más el margen: la 7 está montada.
    setup(20, null, 1000);
    fireEvent.click(screen.getByRole('option', { name: 'Página 7 de 20' }));
    expect(useViewer.getState().navRequest?.page).toBe(6);
    expect(useViewer.getState().currentPage).toBe(6);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Página 7 de 20' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('con el foco en la lista, ArrowDown avanza una página y aria-activedescendant cambia; End va a la última; Home a la primera', async () => {
    const user = userEvent.setup();
    const { list } = setup(20);
    expect(list).toHaveAttribute('aria-activedescendant', 'thumb-0');
    expect(screen.getByRole('option', { name: 'Página 1 de 20' })).toHaveAttribute('aria-selected', 'true');

    act(() => list.focus());
    expect(list).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(list).toHaveAttribute('aria-activedescendant', 'thumb-1');
    expect(useViewer.getState().navRequest?.page).toBe(1);

    await user.keyboard('{End}');
    expect(list).toHaveAttribute('aria-activedescendant', 'thumb-19');
    expect(useViewer.getState().navRequest?.page).toBe(19);

    await user.keyboard('{Home}');
    expect(list).toHaveAttribute('aria-activedescendant', 'thumb-0');
  });

  it('Re Pág y Av Pág se mueven por pantallas de miniaturas', async () => {
    const user = userEvent.setup();
    const { list } = setup(100);
    act(() => list.focus());
    await user.keyboard('{PageDown}');
    const afterDown = Number(list.getAttribute('aria-activedescendant')?.replace('thumb-', ''));
    expect(afterDown).toBeGreaterThan(1);
    await user.keyboard('{PageUp}');
    expect(list).toHaveAttribute('aria-activedescendant', 'thumb-0');
  });

  it('si la página actual cambia fuera de la vista, la lista desplaza el scroll para mostrarla', async () => {
    const { list } = setup(200);
    act(() => {
      useViewer.setState({ currentPage: 150 });
    });
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
    expect(screen.getByRole('option', { name: 'Página 151 de 200' })).toBeInTheDocument();
  });
});

describe('Miniaturas · prioridad de render', () => {
  it('las miniaturas se piden con prioridad 2: con la cola llena de trabajos de prioridad 0, ninguna miniatura empieza', async () => {
    const release: Array<() => void> = [];
    const blocker = (key: string, priority: number) =>
      renderQueue.request({
        key,
        priority,
        run: () =>
          new Promise<void>((resolve) => {
            release.push(resolve);
            holders.push(resolve);
          }),
      });
    // Dos trabajos ocupan la concurrencia y un tercero de prioridad 0 espera su turno.
    blocker('test:visible-1', 0);
    blocker('test:visible-2', 0);
    blocker('test:visible-3', 0);

    setup(10);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderPageToCanvas).not.toHaveBeenCalled();

    // Al liberar uno entra el de prioridad 0 pendiente; las miniaturas siguen esperando.
    act(() => release[0]?.());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderPageToCanvas).not.toHaveBeenCalled();

    // Al liberar el resto, las miniaturas empiezan.
    act(() => {
      release[1]?.();
      release[2]?.();
    });
    await waitFor(() => expect(renderPageToCanvas).toHaveBeenCalled());
  });

  it('cada miniatura visible se dibuja una vez y su lienzo queda en el DOM', async () => {
    setup(4);
    await waitFor(() => expect(renderPageToCanvas).toHaveBeenCalledTimes(4));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-rendered="true"]')).toHaveLength(4);
    });
    expect(document.querySelectorAll('[role="option"] canvas')).toHaveLength(4);
  });
});
