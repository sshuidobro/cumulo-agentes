// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpeechChunk } from '../../src/core/read-aloud/chunks';
import { PageDimsTable } from '../../src/core/page-dims';
import type { TextLayerHandle } from '../../src/engine/text';
import type { PageViewport } from '../../src/engine/pdfjs';
import { useReadAloud } from '../../src/state/read-aloud-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ReadAloudHighlight } from '../../src/ui/viewer/ReadAloudHighlight';
import * as registry from '../../src/ui/viewer/text-layer-registry';

const PAGE = 0;
const PAGE_HEIGHT = 800;

/** Capa de texto falsa con dos ítems: «busqueda uno» y «otra busqueda». */
function fakeLayer(): TextLayerHandle {
  const host = document.createElement('div');
  const textDivs = ['busqueda uno', 'otra busqueda'].map((text) => {
    const div = document.createElement('span');
    div.append(document.createTextNode(text));
    host.append(div);
    return div;
  });
  return {
    textDivs,
    items: ['busqueda uno', 'otra busqueda'],
    container: host,
    viewport: { convertToPdfPoint: (x: number, y: number) => [x, y] } as unknown as PageViewport,
    render: () => Promise.resolve(),
    update: () => undefined,
    cancel: () => undefined,
  };
}

/** Fragmento «busqueda» (primer ítem, sin la «uno»), de la página `page`. */
function chunkOn(page: number): SpeechChunk {
  return { pageIndex: page, text: 'busqueda', start: { item: 0, offset: 0 }, end: { item: 0, offset: 8 } };
}

beforeEach(() => {
  // Geometría que jsdom no calcula: el trozo de texto de la fila 400 px y la página mide 800 px.
  Range.prototype.getClientRects = (): DOMRectList => {
    const top = 400;
    return [{ left: 10, top, width: 40, height: 12, right: 50, bottom: top + 12, x: 10, y: top, toJSON: () => ({}) }] as unknown as DOMRectList;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => PAGE_HEIGHT });
  useViewer.setState({ ...initialViewerState, status: 'ready', dims: PageDimsTable.uniform(3, 612, PAGE_HEIGHT, 0), dimsVersion: 1 });
  useReadAloud.setState({ status: 'idle', scope: null, current: null });
  registry.unregister(PAGE);
});

afterEach(() => {
  registry.unregister(PAGE);
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

describe('resaltado de la frase en voz alta', () => {
  it('pinta una sola caja «read-aloud-current» sobre el fragmento en curso y ninguna sin lectura', () => {
    registry.register(PAGE, fakeLayer());
    useReadAloud.setState({ status: 'speaking', current: chunkOn(PAGE) });

    const { container } = render(<ReadAloudHighlight index={PAGE} zoom={1} rotation={0} />);

    expect(container.querySelectorAll('.read-aloud-current')).toHaveLength(1);
    expect(container.querySelector('.read-aloud-highlight')).toHaveAttribute('aria-hidden', 'true');
  });

  it('no pinta nada en las páginas que no contienen el fragmento', () => {
    registry.register(PAGE, fakeLayer());
    useReadAloud.setState({ status: 'speaking', current: chunkOn(2) });

    const { container } = render(<ReadAloudHighlight index={PAGE} zoom={1} rotation={0} />);

    expect(container.querySelectorAll('.read-aloud-current')).toHaveLength(0);
  });

  it('sin capa de texto montada no pinta nada', () => {
    useReadAloud.setState({ status: 'speaking', current: chunkOn(PAGE) });

    const { container } = render(<ReadAloudHighlight index={PAGE} zoom={1} rotation={0} />);

    expect(container.querySelectorAll('.read-aloud-current')).toHaveLength(0);
  });

  it('si el fragmento queda fuera del visor, lleva la página a la vista una sola vez por fragmento', () => {
    registry.register(PAGE, fakeLayer());
    const chunk = chunkOn(PAGE);
    useReadAloud.setState({ status: 'speaking', current: chunk });

    // El marco del visor en jsdom mide 0: la línea (en 400 px) queda fuera y debe revelarse.
    const { rerender } = render(
      <div data-testid="viewer">
        <ReadAloudHighlight index={PAGE} zoom={1} rotation={0} />
      </div>,
    );
    const first = useViewer.getState().navRequest;
    expect(first).toMatchObject({ page: PAGE, yFraction: 0.2 });

    // Mismo fragmento tras otro render: no se vuelve a revelar.
    rerender(
      <div data-testid="viewer">
        <ReadAloudHighlight index={PAGE} zoom={1} rotation={0} />
      </div>,
    );
    expect(useViewer.getState().navRequest?.seq).toBe(first?.seq);
  });

  it('si el fragmento ya está a la vista, no mueve la página', () => {
    registry.register(PAGE, fakeLayer());
    useReadAloud.setState({ status: 'speaking', current: chunkOn(PAGE) });
    // Marco del visor que contiene la línea (400 px) dentro de su rectángulo.
    const viewer = document.createElement('div');
    viewer.setAttribute('data-testid', 'viewer');
    viewer.getBoundingClientRect = () => ({ top: -1000, bottom: 1000, left: 0, right: 0, width: 0, height: 2000, x: 0, y: -1000, toJSON: () => ({}) });
    document.body.append(viewer);
    const before = useViewer.getState().navRequest;

    render(<ReadAloudHighlight index={PAGE} zoom={1} rotation={0} />, { container: viewer });

    expect(useViewer.getState().navRequest).toBe(before);
    viewer.remove();
  });
});
