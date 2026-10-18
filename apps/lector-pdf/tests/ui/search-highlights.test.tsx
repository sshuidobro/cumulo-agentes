// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchMatch } from '../../src/core/search/find';
import { PageDimsTable } from '../../src/core/page-dims';
import type { TextLayerHandle } from '../../src/engine/text';
import { SearchHighlights } from '../../src/ui/viewer/SearchHighlights';
import * as registry from '../../src/ui/viewer/text-layer-registry';
import { initialSearchState, useSearch } from '../../src/state/search-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';

const PAGE = 0;
const PAGE_HEIGHT = 800;

/** Capa de texto falsa con dos ítems: «busqueda uno» y «otra busqueda». */
function fakeLayer(): { readonly handle: TextLayerHandle; readonly host: HTMLElement } {
  const host = document.createElement('div');
  const textDivs = ['busqueda uno', 'otra busqueda'].map((text) => {
    const div = document.createElement('span');
    div.append(document.createTextNode(text));
    host.append(div);
    return div;
  });
  const handle: TextLayerHandle = {
    textDivs,
    items: ['busqueda uno', 'otra busqueda'],
    render: () => Promise.resolve(),
    update: () => undefined,
    cancel: () => undefined,
  };
  return { handle, host };
}

/** Coincidencia que empieza en `start` y acaba en `end` de los ítems de la capa falsa. */
function match(start: { item: number; offset: number }, end: { item: number; offset: number }): SearchMatch {
  return { pageIndex: PAGE, start, end };
}

beforeEach(() => {
  // Geometría que jsdom no calcula: cada trozo de texto mide 40×12 y el visor tiene una página de 800 px.
  // jsdom no implementa Range.getClientRects: se añade solo para estas pruebas (ver afterEach).
  Range.prototype.getClientRects = (): DOMRectList => {
    const top = 400;
    return [{ left: 10, top, width: 40, height: 12, right: 50, bottom: top + 12, x: 10, y: top, toJSON: () => ({}) }] as unknown as DOMRectList;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => PAGE_HEIGHT });
  useViewer.setState({ ...initialViewerState, status: 'ready', dims: PageDimsTable.uniform(3, 612, PAGE_HEIGHT, 0), dimsVersion: 1 });
  useSearch.setState({ ...initialSearchState });
  registry.unregister(PAGE);
});

afterEach(() => {
  registry.unregister(PAGE);
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

describe('SearchHighlights', () => {
  it('pinta un rectángulo por trozo de coincidencia y marca la actual', () => {
    const { handle } = fakeLayer();
    registry.register(PAGE, handle);
    useSearch.setState({
      matchesByPage: new Map([[PAGE, [match({ item: 0, offset: 0 }, { item: 0, offset: 8 }), match({ item: 1, offset: 6 }, { item: 1, offset: 14 })]]]),
      pagesWithMatches: [PAGE],
      total: 2,
      status: 'done',
      current: { page: PAGE, index: 1 },
      revealSeq: 0,
    });

    const { container } = render(<SearchHighlights index={PAGE} zoom={1} rotation={0} />);

    const hits = container.querySelectorAll('.hit');
    expect(hits).toHaveLength(2);
    expect(container.querySelectorAll('.hit-current')).toHaveLength(1);
    expect(container.querySelector('.hit-current')).toBe(hits[1]);
  });

  it('revela la coincidencia actual llevándola a un tercio de la página (yFraction = top/alto − 0,3)', () => {
    const { handle } = fakeLayer();
    registry.register(PAGE, handle);
    useSearch.setState({
      matchesByPage: new Map([[PAGE, [match({ item: 0, offset: 0 }, { item: 0, offset: 8 })]]]),
      pagesWithMatches: [PAGE],
      total: 1,
      status: 'done',
      current: { page: PAGE, index: 0 },
      revealSeq: 7,
    });

    render(<SearchHighlights index={PAGE} zoom={1} rotation={0} />);

    // El rectángulo está a 400 px del borde de la página: 400/800 − 0,3 = 0,2.
    expect(useViewer.getState().navRequest).toMatchObject({ page: PAGE, yFraction: 0.2 });
  });

  it('no vuelve a revelar si revealSeq no ha cambiado', () => {
    const { handle } = fakeLayer();
    registry.register(PAGE, handle);
    useSearch.setState({
      matchesByPage: new Map([[PAGE, [match({ item: 0, offset: 0 }, { item: 0, offset: 8 })]]]),
      pagesWithMatches: [PAGE],
      total: 1,
      status: 'done',
      current: { page: PAGE, index: 0 },
      revealSeq: 9,
    });
    const { rerender } = render(<SearchHighlights index={PAGE} zoom={1} rotation={0} />);
    const first = useViewer.getState().navRequest;

    rerender(<SearchHighlights index={PAGE} zoom={1} rotation={0} />);

    expect(useViewer.getState().navRequest).toBe(first);
  });

  it('una coincidencia que acaba al principio del ítem siguiente termina al final del anterior', () => {
    const { handle } = fakeLayer();
    registry.register(PAGE, handle);
    useSearch.setState({
      matchesByPage: new Map([[PAGE, [match({ item: 0, offset: 0 }, { item: 1, offset: 0 })]]]),
      pagesWithMatches: [PAGE],
      total: 1,
      status: 'done',
      current: { page: PAGE, index: 0 },
      revealSeq: 11,
    });

    const { container } = render(<SearchHighlights index={PAGE} zoom={1} rotation={0} />);

    expect(container.querySelectorAll('.hit')).toHaveLength(1);
  });
});
