// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import { PageView, type PageViewProps } from '../../src/ui/viewer/PageView';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { renderQueue } from '../../src/state/render-service';

/** Un dibujo simulado: el test decide cuándo termina y cómo. */
interface FakeRender {
  readonly pageId: number;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  /** `true` cuando el dibujo ha terminado o ha sido cancelado. */
  settled: boolean;
  resolve(outcome: 'done' | 'cancelled'): void;
  reject(error: unknown): void;
}

const renders: FakeRender[] = [];

vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(
    (page: { id: number }, canvas: HTMLCanvasElement, o: { signal: AbortSignal }) =>
      new Promise<'done' | 'cancelled'>((resolve, reject) => {
        const entry: FakeRender = {
          pageId: page.id,
          canvas,
          signal: o.signal,
          settled: false,
          resolve: (outcome) => {
            entry.settled = true;
            resolve(outcome);
          },
          reject: (error) => {
            entry.settled = true;
            reject(error);
          },
        };
        renders.push(entry);
        o.signal.addEventListener('abort', () => {
          entry.resolve('cancelled');
        });
      }),
  ),
}));

// `reportPageDims` vive en el estado del documento; aquí solo interesa el dibujo.
vi.mock('../../src/state/document-actions', () => ({ reportPageDims: vi.fn() }));

function fakeDoc(): LoadedPdf['doc'] {
  const getPage = (n: number): Promise<unknown> =>
    Promise.resolve({
      id: n,
      pageNumber: n,
      rotate: 0,
      getViewport: () => ({ width: 612, height: 792 }),
      cleanup: () => true,
    });
  return { getPage } as unknown as LoadedPdf['doc'];
}

function props(index: number, overrides: Partial<PageViewProps> = {}): PageViewProps {
  return {
    index,
    numPages: 5,
    top: index * 800,
    left: 0,
    width: 612,
    height: 792,
    zoom: 1,
    rotation: 0,
    visible: true,
    ...overrides,
  };
}

/** Dibujos que están ahora mismo en curso (no terminados ni cancelados). */
function inFlight(): number {
  return renders.filter((r) => !r.settled).length;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  renders.length = 0;
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf: { doc: fakeDoc() } as unknown as LoadedPdf });
});

afterEach(() => {
  renderQueue.cancelAll();
});

describe('PageView · cola de render', () => {
  it('pide las visibles con prioridad 0 y el overscan con 1; nunca hay más de 2 dibujos en curso', async () => {
    // Páginas 0 y 4 son overscan; 1, 2 y 3 están en pantalla.
    render(
      <>
        {[0, 1, 2, 3, 4].map((i) => (
          <PageView key={i} {...props(i, { visible: i >= 1 && i <= 3 })} />
        ))}
      </>,
    );
    await settle();

    // Solo dos arrancan a la vez; las primeras son las visibles (índices 1 y 2 → páginas 2 y 3).
    expect(renders.map((r) => r.pageId)).toEqual([2, 3]);
    expect(inFlight()).toBe(2);

    // Cada vez que termina uno, arranca el siguiente por prioridad (visibles antes que overscan).
    for (let finished = 0; finished < 5; finished++) {
      expect(inFlight()).toBeLessThanOrEqual(2);
      const next = renders.find((r) => !r.settled);
      if (next === undefined) break;
      await act(async () => {
        next.resolve('done');
      });
      await settle();
    }

    // Visibles (páginas 2, 3, 4) antes que el overscan (páginas 1 y 5).
    expect(renders.map((r) => r.pageId)).toEqual([2, 3, 4, 1, 5]);
  });

  it('al desmontar una página con dibujo en curso aborta la señal y libera su lienzo', async () => {
    const { unmount } = render(<PageView {...props(0)} />);
    await waitFor(() => expect(renders).toHaveLength(1));
    const [entry] = renders;
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.signal.aborted).toBe(false);

    unmount();

    expect(entry.signal.aborted).toBe(true);
    expect(entry.canvas.width).toBe(0);
    expect(entry.canvas.height).toBe(0);
  });

  it('al cambiar el zoom el lienzo anterior sigue en el DOM hasta que el nuevo termina; luego queda uno solo', async () => {
    const { container, rerender } = render(<PageView {...props(0)} />);
    await waitFor(() => expect(renders).toHaveLength(1));
    const first = renders[0];
    if (first === undefined) throw new Error('falta el primer dibujo');
    await act(async () => {
      first.resolve('done');
    });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Página 1 de 5' })).toHaveAttribute('data-rendered', 'true'));

    rerender(<PageView {...props(0, { zoom: 2 })} />);
    await waitFor(() => expect(renders).toHaveLength(2));
    const second = renders[1];
    if (second === undefined) throw new Error('falta el segundo dibujo');

    // Mientras dibuja el nuevo, el anterior sigue montado y sin liberar.
    const canvasesWhileDrawing = container.querySelectorAll('canvas');
    expect(canvasesWhileDrawing).toHaveLength(1);
    expect(canvasesWhileDrawing[0]).toBe(first.canvas);
    expect(first.canvas.width).toBeGreaterThan(0);

    await act(async () => {
      second.resolve('done');
    });
    await waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(1));
    expect(container.querySelector('canvas')).toBe(second.canvas);
    expect(first.canvas.width).toBe(0);
  });

  it('si el dibujo falla con un error normal muestra el aviso y las demás páginas se dibujan', async () => {
    render(
      <>
        <PageView {...props(0)} />
        <PageView {...props(1)} />
      </>,
    );
    await waitFor(() => expect(renders).toHaveLength(2));
    const failing = renders.find((r) => r.pageId === 1);
    const working = renders.find((r) => r.pageId === 2);
    if (failing === undefined || working === undefined) throw new Error('faltan los dibujos');

    await act(async () => {
      failing.reject(new Error('fallo simulado'));
      working.resolve('done');
    });

    await waitFor(() => expect(screen.getByText('No se ha podido dibujar esta página.')).toBeInTheDocument());
    expect(screen.getByRole('group', { name: 'Página 2 de 5' })).toHaveAttribute('data-rendered', 'true');
    expect(screen.getByRole('group', { name: 'Página 1 de 5' })).not.toHaveAttribute('data-rendered');
  });
});
