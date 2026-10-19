// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import type { RenderPageOptions } from '../../src/engine/render';
import { PageView, type PageViewProps } from '../../src/ui/viewer/PageView';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { useAppearance } from '../../src/state/appearance-store';
import { renderQueue } from '../../src/state/render-service';

/** Un dibujo simulado. Por defecto termina enseguida; `hold` decide cuáles se quedan en curso. */
interface FakeRender {
  readonly canvas: HTMLCanvasElement;
  readonly options: RenderPageOptions;
  readonly signal: AbortSignal;
  settled: boolean;
  /** Termina el dibujo con el resultado indicado (para los que `hold` deja en curso). */
  finish(outcome: 'done' | 'cancelled'): void;
}

const renders: FakeRender[] = [];
let hold: (options: RenderPageOptions) => boolean = () => false;

vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(
    (_page: unknown, canvas: HTMLCanvasElement, options: RenderPageOptions) =>
      new Promise<'done' | 'cancelled'>((resolve) => {
        const entry: FakeRender = {
          canvas,
          options,
          signal: options.signal,
          settled: false,
          finish: (outcome) => finish(outcome),
        };
        const finish = (outcome: 'done' | 'cancelled'): void => {
          entry.settled = true;
          resolve(outcome);
        };
        renders.push(entry);
        options.signal.addEventListener('abort', () => finish('cancelled'));
        if (!hold(options)) setTimeout(() => finish('done'), 0);
      }),
  ),
}));

// La capa de texto necesita el motor de pdf.js (sin canvas en jsdom): aquí solo interesa el lienzo.
vi.mock('../../src/engine/text', () => ({
  normalizeUnicode: (text: string) => text,
  createTextLayer: vi.fn(() => ({
    textDivs: [],
    items: [],
    render: () => Promise.resolve(),
    update: () => undefined,
    cancel: () => undefined,
  })),
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

/** Página de A4 (612 × 792 pt) a 3 200 %: su lienzo entero supera MAX_CANVAS_PIXELS, así que está limitado. */
const BIG = { width: 612 * 32, height: 792 * 32 };
const VIEW = { x: 0, y: 0, width: 1280, height: 800 };

function props(overrides: Partial<PageViewProps> = {}): PageViewProps {
  return {
    index: 0,
    numPages: 5,
    top: 0,
    left: 0,
    width: BIG.width,
    height: BIG.height,
    zoom: 32,
    rotation: 0,
    visible: true,
    viewportRect: VIEW,
    ...overrides,
  };
}

/** Dibujos de detalle (los que llevan origen de zona), terminados o no. */
function detailRenders(): FakeRender[] {
  return renders.filter((r) => r.options.offset !== undefined);
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}

beforeEach(() => {
  renders.length = 0;
  hold = () => false;
  useAppearance.setState({ nightMode: false });
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf: { doc: fakeDoc() } as unknown as LoadedPdf });
});

afterEach(() => {
  renderQueue.cancelAll();
});

describe('PageView · lienzo de detalle (ADR-0025)', () => {
  it('con zoom alto dibuja la zona visible con margen a densidad completa, en un contenedor con data-detail', async () => {
    const { container } = render(<PageView {...props()} />);
    await waitFor(() => expect(container.querySelector('[data-detail]')).not.toBeNull());

    const host = container.querySelector<HTMLElement>('[data-detail]');
    // Zona visible 1 280 × 800 más 25 % por lado, sin salirse del marco: 1 600 × 1 000 desde el origen.
    expect(host?.style.left).toBe('0px');
    expect(host?.style.top).toBe('0px');
    expect(host?.style.width).toBe('1600px');
    expect(host?.style.height).toBe('1000px');
    expect(container.querySelectorAll('[data-detail]')).toHaveLength(1);

    const detail = detailRenders()[0];
    expect(detail?.options.offset).toEqual({ x: 0, y: 0 });
    expect(detail?.options.outputScale).toBe(1);
    expect(detail?.canvas.width).toBe(1600);
    expect(detail?.canvas.height).toBe(1000);
    expect(host?.querySelector('canvas')).toBe(detail?.canvas);
  });

  it('con la página entera dentro del límite de lienzo no dibuja detalle', async () => {
    const { container } = render(<PageView {...props({ width: 612, height: 792, zoom: 1 })} />);
    await wait(250);
    expect(container.querySelector('[data-detail]')).toBeNull();
    expect(detailRenders()).toHaveLength(0);
  });

  it('una página solo del overscan no dibuja detalle', async () => {
    const { container } = render(<PageView {...props({ viewportRect: null, visible: false })} />);
    await wait(250);
    expect(container.querySelector('[data-detail]')).toBeNull();
    expect(detailRenders()).toHaveLength(0);
  });

  it('desplazarse dentro de la zona ya dibujada no vuelve a dibujar', async () => {
    const { container, rerender } = render(<PageView {...props()} />);
    await waitFor(() => expect(container.querySelector('[data-detail]')).not.toBeNull());
    expect(detailRenders()).toHaveLength(1);

    rerender(<PageView {...props({ viewportRect: { ...VIEW, y: 10 } })} />);
    await wait(300);
    expect(detailRenders()).toHaveLength(1);
  });

  it('al salir la zona visible de la dibujada, redibuja tras 150 ms y mantiene el anterior hasta que el nuevo termina', async () => {
    const { container, rerender } = render(<PageView {...props()} />);
    await waitFor(() => expect(container.querySelector('[data-detail]')).not.toBeNull());
    const first = detailRenders()[0];
    if (first === undefined) throw new Error('falta el primer detalle');

    // El siguiente detalle se queda en curso hasta que el test lo termine.
    hold = (o) => o.offset !== undefined && o.offset.y > 0;
    rerender(<PageView {...props({ viewportRect: { ...VIEW, y: 5000 } })} />);
    await waitFor(() => expect(detailRenders()).toHaveLength(2));
    const second = detailRenders()[1];
    if (second === undefined) throw new Error('falta el segundo detalle');
    expect(second.options.offset).toEqual({ x: 0, y: 4800 });

    // Mientras dibuja el nuevo, el anterior sigue en pantalla y sin liberar.
    const host = container.querySelector<HTMLElement>('[data-detail]');
    expect(host?.querySelector('canvas')).toBe(first.canvas);
    expect(first.canvas.width).toBe(1600);

    await act(async () => {
      second.finish('done');
    });
    await waitFor(() => expect(container.querySelector('[data-detail]')?.style.top).toBe('4800px'));
    expect(container.querySelector('[data-detail]')?.querySelector('canvas')).toBe(second.canvas);
    expect(first.canvas.width).toBe(0);
  });

  it('al bajar el zoom quita el detalle sin esperar', async () => {
    const { container, rerender } = render(<PageView {...props()} />);
    await waitFor(() => expect(container.querySelector('[data-detail]')).not.toBeNull());
    const detail = detailRenders()[0];

    rerender(<PageView {...props({ zoom: 1, width: 612, height: 792 })} />);
    await waitFor(() => expect(container.querySelector('[data-detail]')).toBeNull());
    expect(container.querySelectorAll('[data-detail] canvas')).toHaveLength(0);
    expect(detail?.canvas.width).toBe(0);
  });

  it('con modo noche el detalle se dibuja con los colores de noche', async () => {
    useAppearance.setState({ nightMode: true });
    const { container } = render(<PageView {...props()} />);
    await waitFor(() => expect(container.querySelector('[data-detail]')).not.toBeNull());
    const detail = detailRenders()[0];
    expect(detail?.options.night).toBeDefined();
  });

  it('al desmontar con un detalle en curso aborta su dibujo y libera el lienzo', async () => {
    hold = (o) => o.offset !== undefined;
    const { unmount } = render(<PageView {...props()} />);
    await waitFor(() => expect(detailRenders()).toHaveLength(1));
    const entry = detailRenders()[0];
    if (entry === undefined) throw new Error('falta el detalle');
    expect(entry.signal.aborted).toBe(false);

    unmount();

    expect(entry.signal.aborted).toBe(true);
    expect(entry.canvas.width).toBe(0);
  });
});
