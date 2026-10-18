// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoomToScale } from '../../src/core/zoom';
import type { LoadedPdf } from '../../src/engine';
import { createTextLayer } from '../../src/engine/text';
import { TextLayerView } from '../../src/ui/viewer/TextLayerView';
import * as registry from '../../src/ui/viewer/text-layer-registry';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';

// jsdom no tiene canvas 2D: el motor de pdf.js se simula. Lo real se prueba en e2e (text.spec.ts).
vi.mock('../../src/engine/text', () => ({
  normalizeUnicode: (text: string) => text,
  createTextLayer: vi.fn((_page: unknown, container: HTMLElement) => {
    const span = document.createElement('span');
    span.textContent = 'Hola';
    return {
      textDivs: [span],
      items: ['Hola'],
      render: vi.fn(() => {
        container.append(span);
        return Promise.resolve();
      }),
      update: vi.fn(),
      cancel: vi.fn(),
    };
  }),
}));

const getViewport = vi.fn((params: { scale: number; rotation: number }) => ({ ...params }));

function fakeDoc(): LoadedPdf['doc'] {
  const getPage = (n: number): Promise<unknown> =>
    Promise.resolve({ pageNumber: n, rotate: 0, getViewport, cleanup: () => true });
  return { getPage } as unknown as LoadedPdf['doc'];
}

/** Layer simulado de la última llamada a `createTextLayer`. */
function lastLayer(): {
  render: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const results = vi.mocked(createTextLayer).mock.results;
  const last = results[results.length - 1];
  if (last === undefined) throw new Error('no se ha creado ninguna capa');
  return last.value as unknown as ReturnType<typeof lastLayer>;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  vi.mocked(createTextLayer).mockClear();
  getViewport.mockClear();
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf: { doc: fakeDoc() } as unknown as LoadedPdf });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TextLayerView · ciclo de vida de la capa', () => {
  it('al montar crea una capa una vez, la pinta y la registra en su página', async () => {
    render(<TextLayerView index={2} zoom={1} rotation={0} />);
    await settle();

    expect(createTextLayer).toHaveBeenCalledTimes(1);
    expect(lastLayer().render).toHaveBeenCalledTimes(1);
    expect(registry.get(2)).toBeDefined();
    expect(document.querySelector('.textLayer .endOfContent')).not.toBeNull();
  });

  it('cambiar el zoom recoloca la capa existente con update y no crea otra', async () => {
    const { rerender } = render(<TextLayerView index={2} zoom={1} rotation={0} />);
    await settle();

    rerender(<TextLayerView index={2} zoom={2} rotation={0} />);

    expect(createTextLayer).toHaveBeenCalledTimes(1);
    expect(lastLayer().update).toHaveBeenCalledTimes(1);
    expect(lastLayer().update).toHaveBeenLastCalledWith(expect.objectContaining({ scale: zoomToScale(2) }));
  });

  it('cambiar la rotación cancela la capa anterior y crea una nueva con la rotación de la vista', async () => {
    const { rerender } = render(<TextLayerView index={0} zoom={1} rotation={0} />);
    await settle();
    const before = lastLayer();

    rerender(<TextLayerView index={0} zoom={1} rotation={90} />);
    await settle();

    expect(before.cancel).toHaveBeenCalledTimes(1);
    expect(createTextLayer).toHaveBeenCalledTimes(2);
    expect(getViewport).toHaveBeenLastCalledWith(expect.objectContaining({ rotation: 90 }));
    expect(registry.get(0)).toBeDefined();
  });

  it('al desmontar cancela la capa, la desregistra y quita sus oyentes globales', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<TextLayerView index={4} zoom={1} rotation={0} />);
    await settle();
    const layer = lastLayer();

    unmount();

    expect(layer.cancel).toHaveBeenCalledTimes(1);
    expect(registry.get(4)).toBeUndefined();
    expect(removeSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));
  });

  it('si se desmonta antes de terminar de pintar, no se registra la capa', async () => {
    let finish: () => void = () => undefined;
    const cancel = vi.fn();
    vi.mocked(createTextLayer).mockImplementationOnce((_page, container: HTMLElement) => ({
      textDivs: [],
      items: [],
      render: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            container.append(document.createElement('span'));
            resolve();
          };
        }),
      update: vi.fn(),
      cancel,
    }));
    const { unmount } = render(<TextLayerView index={1} zoom={1} rotation={0} />);
    await settle();

    unmount();
    finish();
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(registry.get(1)).toBeUndefined();
  });
});
