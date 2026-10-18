// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import type * as AnnotationActions from '../../src/state/annotation-actions';
import { PageView, type PageViewProps } from '../../src/ui/viewer/PageView';
import { endAnnotationSession } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { renderQueue } from '../../src/state/render-service';

const ensurePageAnnotations = vi.fn<(index: number) => Promise<void>>(() => Promise.resolve());
vi.mock('../../src/state/annotation-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof AnnotationActions>();
  return { ...actual, ensurePageAnnotations: (index: number) => ensurePageAnnotations(index) };
});

// Dibujo y capas de texto simulados: aquí solo interesa la importación perezosa.
vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(() => new Promise<'cancelled'>(() => undefined)),
}));
vi.mock('../../src/engine/text', () => ({
  normalizeUnicode: (text: string) => text,
  createTextLayer: vi.fn(() => ({ textDivs: [], items: [], render: () => Promise.resolve(), update: () => undefined, cancel: () => undefined })),
}));
vi.mock('../../src/state/document-actions', () => ({ reportPageDims: vi.fn() }));

function fakeDoc(): LoadedPdf['doc'] {
  const getPage = (n: number): Promise<unknown> =>
    Promise.resolve({
      pageNumber: n,
      rotate: 0,
      getViewport: () => ({ width: 612, height: 792 }),
      getAnnotations: () => Promise.resolve([]),
      cleanup: () => true,
    });
  return { getPage } as unknown as LoadedPdf['doc'];
}

function props(overrides: Partial<PageViewProps> = {}): PageViewProps {
  return { index: 7, numPages: 25_000, top: 0, left: 0, width: 612, height: 792, zoom: 1, rotation: 0, visible: true, ...overrides };
}

beforeEach(() => {
  ensurePageAnnotations.mockClear();
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf: { doc: fakeDoc() } as unknown as LoadedPdf });
  useAnnotations.setState({ ...initialAnnotationState(), scan: 'lazy' });
});

afterEach(() => {
  renderQueue.cancelAll();
  endAnnotationSession();
});

describe('PageView · importación perezosa de anotaciones', () => {
  it('con documento perezoso, una página visible pide sus anotaciones una vez', () => {
    render(<PageView {...props()} />);
    expect(ensurePageAnnotations).toHaveBeenCalledTimes(1);
    expect(ensurePageAnnotations).toHaveBeenCalledWith(7);
  });

  it('una página fuera del visor (overscan) no pide sus anotaciones', () => {
    render(<PageView {...props({ visible: false })} />);
    expect(ensurePageAnnotations).not.toHaveBeenCalled();
  });

  it('con el escaneo completo (documento normal) no se pide nada', () => {
    useAnnotations.setState({ scan: 'done' });
    render(<PageView {...props()} />);
    expect(ensurePageAnnotations).not.toHaveBeenCalled();
  });
});
