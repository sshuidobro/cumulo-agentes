// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource } from '@suite/platform';
import type { PageComparison } from '../../src/core/compare/compare';
import type { Word } from '../../src/core/compare/words';
import type { LoadedPdf, PDFDocumentProxy } from '../../src/engine';
import type * as CompareActions from '../../src/state/compare-actions';
import { useCompare, type CompareState } from '../../src/state/compare-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { CompareView } from '../../src/ui/compare/CompareView';
import { ComparePages } from '../../src/ui/compare/ComparePages';
import { compareMsg } from '../../src/ui/messages-compare';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

/*
 * Vista de páginas de la comparación (PDF-117). El render de pdf.js y la capa de texto son dobles: aquí se prueba
 * qué se pinta, dónde y con qué ciclo de vida, no el dibujo real del PDF.
 */

interface FakePage {
  readonly pageNumber: number;
  readonly items: readonly string[];
  getViewport(o: { readonly scale: number }): { readonly width: number; readonly height: number };
  cleanup: Mock;
}

const mocks = vi.hoisted(() => ({
  /** Documento B que devuelve `comparedDocument`. */
  other: null as LoadedPdf | null,
  /** Señal con la que se llamó a `renderPageToCanvas`, en orden. */
  signals: [] as AbortSignal[],
}));

vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(async (_page: unknown, _canvas: unknown, options: { readonly signal: AbortSignal }) => {
    mocks.signals.push(options.signal);
    return 'done';
  }),
}));

vi.mock('../../src/engine/text', () => ({
  createTextLayer: vi.fn((page: FakePage, container: HTMLElement) => {
    const textDivs = page.items.map((str) => {
      const div = document.createElement('span');
      div.textContent = str;
      container.appendChild(div);
      return div;
    });
    return {
      textDivs,
      items: page.items,
      container,
      viewport: {},
      render: async () => undefined,
      update: () => undefined,
      cancel: vi.fn(),
    };
  }),
}));

vi.mock('../../src/state/compare-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof CompareActions>();
  return { ...actual, comparedDocument: () => mocks.other };
});

const IDLE: CompareState = { status: 'idle', otherName: null, results: [], progress: null, selected: null, cancelled: false };

function word(text: string, item: number): Word {
  return { text, start: { item, offset: 0 }, end: { item, offset: text.length } };
}

/** Documento de prueba: `pages[n - 1]` son los ítems de texto de la página n. */
function fakeDoc(pages: readonly (readonly string[])[]): { readonly doc: PDFDocumentProxy; readonly getPage: Mock } {
  const getPage = vi.fn(async (n: number): Promise<FakePage> => ({
    pageNumber: n,
    items: pages[n - 1] ?? [],
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    cleanup: vi.fn(),
  }));
  return { doc: { numPages: pages.length, getPage } as unknown as PDFDocumentProxy, getPage };
}

function fakeLoaded(doc: PDFDocumentProxy): LoadedPdf {
  return { doc, numPages: 2, fingerprint: 'fp', password: null, onIoError: () => () => undefined, destroy: async () => undefined };
}

/** Página 2 («Esto es la página dos») frente a «Esto es la hoja dos» en el otro documento. */
const A_PAGES = [['Primera'], ['Esto es la', 'página', 'dos']];
const B_PAGES = [['Primera'], ['Esto es la', 'hoja', 'dos']];
const CHANGE_PAGE_2: PageComparison = {
  kind: 'changed',
  page: 1,
  changes: [{ kind: 'replace', removed: [word('página', 1)], added: [word('hoja', 1)] }],
};
const ONLY_IN_B: PageComparison = { kind: 'only-in-b', page: 4 };

/** Contexto 2D falso: anota el modo de composición con el que se llama a `drawImage`. */
function fakeContext(): { readonly ctx: CanvasRenderingContext2D; readonly composites: string[] } {
  const composites: string[] = [];
  const ctx = {
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    drawImage: () => {
      composites.push(ctx.globalCompositeOperation);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, composites };
}

let docA: ReturnType<typeof fakeDoc>;
let docB: ReturnType<typeof fakeDoc>;
let composites: string[];

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: '/pdfjs/' });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
  const fake = fakeContext();
  composites = fake.composites;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake.ctx);
  // Rango medido: la anchura del rectángulo es 6 px por letra del texto que cubre, así se comprueba la palabra.
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value(this: Range) {
      const text = this.startContainer.textContent ?? '';
      return [{ left: 0, top: 0, width: text.length * 6, height: 10 }];
    },
  });
  docA = fakeDoc(A_PAGES);
  docB = fakeDoc(B_PAGES);
  mocks.other = fakeLoaded(docB.doc);
  mocks.signals.length = 0;
  useViewer.setState({ ...initialViewerState, status: 'ready', file: openedFile('basic-5.pdf', memorySource(new Uint8Array(1))), pdf: fakeLoaded(docA.doc) });
  useCompare.setState({ ...IDLE, otherName: 'basic-5-changed.pdf', status: 'done', results: [CHANGE_PAGE_2, ONLY_IN_B], selected: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  useCompare.setState(IDLE);
  useViewer.setState(initialViewerState);
  mocks.other = null;
});

describe('ComparePages lado a lado (PDF-117)', () => {
  it('pinta la página de cada documento en su columna y pide la página del cambio', async () => {
    render(<ComparePages result={CHANGE_PAGE_2} token={0} otherName="basic-5-changed.pdf" />);

    const left = screen.getByRole('region', { name: compareMsg.openDocument });
    const right = screen.getByRole('region', { name: 'basic-5-changed.pdf' });
    await waitFor(() => { expect(mocks.signals).toHaveLength(2); });
    expect(docA.getPage).toHaveBeenCalledWith(2);
    expect(docB.getPage).toHaveBeenCalledWith(2);
    expect(left.querySelectorAll('canvas')).toHaveLength(1);
    expect(right.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('resalta «página» en rojo-amarillo a la izquierda y «hoja» a la derecha, ocultos a los lectores de pantalla', async () => {
    render(<ComparePages result={CHANGE_PAGE_2} token={0} otherName="basic-5-changed.pdf" />);

    const left = screen.getByRole('region', { name: compareMsg.openDocument });
    const right = screen.getByRole('region', { name: 'basic-5-changed.pdf' });
    await waitFor(() => { expect(left.querySelectorAll('[data-change]')).toHaveLength(1); });
    const leftMark = left.querySelector<HTMLElement>('[data-change]');
    const rightMark = right.querySelectorAll<HTMLElement>('[data-change]');
    expect(leftMark?.getAttribute('data-change')).toBe('replaced');
    expect(leftMark?.style.width).toBe(`${String('página'.length * 6)}px`);
    expect(rightMark).toHaveLength(1);
    expect(rightMark[0]?.getAttribute('data-change')).toBe('replaced');
    expect(rightMark[0]?.style.width).toBe(`${String('hoja'.length * 6)}px`);
    expect(leftMark?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('una página que solo existe en el otro documento deja «No existe en este documento» a la izquierda', async () => {
    render(<ComparePages result={ONLY_IN_B} token={1} otherName="basic-5-changed.pdf" />);

    const left = screen.getByRole('region', { name: compareMsg.openDocument });
    expect(within(left).getByText(compareMsg.missingPage)).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('region', { name: 'basic-5-changed.pdf' }).querySelectorAll('canvas')).toHaveLength(1); });
  });

  it('cambiar de selección cancela el dibujo anterior y libera el lienzo', async () => {
    const { rerender } = render(<ComparePages result={CHANGE_PAGE_2} token={0} otherName="basic-5-changed.pdf" />);
    await waitFor(() => { expect(mocks.signals).toHaveLength(2); });
    const first = [...mocks.signals];
    expect(first.every((s) => !s.aborted)).toBe(true);

    rerender(<ComparePages result={ONLY_IN_B} token={1} otherName="basic-5-changed.pdf" />);

    expect(first.every((s) => s.aborted)).toBe(true);
  });
});

describe('ComparePages superposición (PDF-117)', () => {
  it('muestra un único lienzo con la diferencia de A y B y la leyenda', async () => {
    const user = userEvent.setup();
    render(<ComparePages result={CHANGE_PAGE_2} token={0} otherName="basic-5-changed.pdf" />);

    await user.click(screen.getByRole('button', { name: compareMsg.overlay }));

    expect(screen.getByRole('button', { name: compareMsg.overlay })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: compareMsg.sideBySide })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(compareMsg.overlayLegend)).toBeInTheDocument();
    await waitFor(() => { expect(composites).toEqual(['source-over', 'difference']); });
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('el selector de modo tiene nombre accesible y se puede volver a lado a lado', async () => {
    const user = userEvent.setup();
    render(<ComparePages result={CHANGE_PAGE_2} token={0} otherName="basic-5-changed.pdf" />);

    expect(screen.getByRole('group', { name: compareMsg.viewMode })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: compareMsg.overlay }));
    await user.click(screen.getByRole('button', { name: compareMsg.sideBySide }));

    expect(screen.queryByText(compareMsg.overlayLegend)).toBeNull();
    expect(screen.getByRole('region', { name: compareMsg.openDocument })).toBeInTheDocument();
  });
});

describe('CompareView con las páginas del cambio (PDF-117)', () => {
  it('«Cambio siguiente» y «Cambio anterior» cambian la selección; Alt+Flecha hace lo mismo con la vista abierta', async () => {
    const user = userEvent.setup();
    useCompare.setState({ selected: null });
    render(<CompareView />);

    expect(screen.getByText(compareMsg.selectChange)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: compareMsg.nextChange }));
    expect(useCompare.getState().selected).toBe(0);

    await user.click(screen.getByRole('button', { name: compareMsg.nextChange }));
    expect(useCompare.getState().selected).toBe(1);

    await user.click(screen.getByRole('button', { name: compareMsg.previousChange }));
    expect(useCompare.getState().selected).toBe(0);

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(useCompare.getState().selected).toBe(1);
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(useCompare.getState().selected).toBe(0);
  });
});
