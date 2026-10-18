// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageViewport } from '../../src/engine/pdfjs';
import type { TextLayerHandle } from '../../src/engine/text';
import { endAnnotationSession, undo } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { markupSelection } from '../../src/state/markup-actions';
import { initServices } from '../../src/state/services';
import { CommentToolbar } from '../../src/ui/toolbar/CommentToolbar';
import { SelectionActions } from '../../src/ui/viewer/SelectionActions';
import { selectionPageRects } from '../../src/ui/viewer/selection-to-pages';
import * as registry from '../../src/ui/viewer/text-layer-registry';
import { createFakePlatform } from '../helpers/fake-platform';

/** Alto de la página simulada (pt): el viewport invierte el eje Y como pdf.js con escala 1. */
const PAGE_H = 800;

/** Caja de ventana con los cuatro lados (para `getBoundingClientRect` y los rectángulos de selección). */
function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top, toJSON: () => ({}) };
}

const viewport = {
  convertToPdfPoint: (x: number, y: number): number[] => [x, PAGE_H - y],
} as unknown as PageViewport;

/** Capa de texto simulada: un contenedor de 600 × 800 px en la posición de la ventana que se le indique. */
function fakeLayer(index: number, top: number): { readonly container: HTMLDivElement; readonly span: HTMLSpanElement } {
  const container = document.createElement('div');
  container.dataset['page'] = String(index);
  const span = document.createElement('span');
  span.textContent = 'murciélago hindú';
  container.append(span);
  document.body.append(container);
  container.getBoundingClientRect = () => rect(0, top, 600, top + PAGE_H);
  const handle: TextLayerHandle = {
    textDivs: [span],
    items: ['murciélago hindú'],
    container,
    viewport,
    render: () => Promise.resolve(),
    update: () => undefined,
    cancel: () => undefined,
  };
  registry.register(index, handle);
  return { container, span };
}

/** Fragmentos de línea que devuelve `getClientRects` para cada nodo de texto que inicia un rango. */
const fragmentsByStart = new Map<Node, DOMRect[]>();
const originalGetClientRects = Range.prototype.getClientRects;

const layers: HTMLElement[] = [];
const originalInnerHeight = window.innerHeight;

beforeEach(() => {
  // Las páginas simuladas están más abajo de los 768 px por defecto de jsdom: la ventana tiene que ser más alta.
  window.innerHeight = 2000;
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  fragmentsByStart.clear();
  Range.prototype.getClientRects = function getClientRects(this: Range): DOMRectList {
    const list = fragmentsByStart.get(this.startContainer) ?? [];
    return Object.assign(list.slice(), { item: (i: number) => list[i] ?? null }) as unknown as DOMRectList;
  };
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  window.innerHeight = originalInnerHeight;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Range.prototype.getClientRects = originalGetClientRects;
  document.getSelection()?.removeAllRanges();
  registry.unregister(1);
  registry.unregister(2);
  for (const layer of layers.splice(0)) layer.remove();
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
});

/**
 * Selección que va de la palabra de la página 2 a la de la página 3 (índices 1 y 2). Cada página tiene un
 * fragmento de línea: el de la página 2 a 100 px de la parte superior de la ventana, y el de la 3 a 200 px de
 * la parte superior de su capa.
 */
function selectAcrossPages(): Selection {
  const p2 = fakeLayer(1, 0);
  const p3 = fakeLayer(2, PAGE_H);
  layers.push(p2.container, p3.container);
  const start = p2.span.firstChild as Text;
  const end = p3.span.firstChild as Text;
  fragmentsByStart.set(start, [rect(100, 100, 160, 112)]);
  fragmentsByStart.set(end, [rect(100, PAGE_H + 200, 180, PAGE_H + 212)]);
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, 5);
  const sel = document.getSelection();
  if (sel === null) throw new Error('sin API de selección');
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

describe('selectionPageRects', () => {
  it('reparte los fragmentos de la selección por página en puntos PDF', () => {
    const sel = selectAcrossPages();
    const pages = selectionPageRects(sel);
    expect([...pages.keys()].sort()).toEqual([1, 2]);
    // Página 2 (capa arriba a 0 px): y de ventana 100–112 → PDF 688–700, con la página de 800 pt de alto.
    expect(pages.get(1)).toEqual([[100, 688, 160, 700]]);
    // Página 3 (capa arriba a 800 px): y local 200–212 → PDF 588–600.
    expect(pages.get(2)).toEqual([[100, 588, 180, 600]]);
  });

  it('ignora los fragmentos que no caen en ninguna capa', () => {
    const sel = selectAcrossPages();
    fragmentsByStart.set(sel.getRangeAt(0).startContainer, [rect(900, 900, 950, 912)]);
    fragmentsByStart.set(sel.getRangeAt(0).endContainer, [rect(900, 1900, 950, 1912)]);
    expect(selectionPageRects(sel).size).toBe(0);
  });

  it('no usa las cajas de contenedores que el rango contiene (marco de página entero)', () => {
    const sel = selectAcrossPages();
    const range = sel.getRangeAt(0);
    // Caja del marco de la página 2 completo (contenedor incluido en el rango): no debe contar como texto.
    range.getClientRects = () => Object.assign([rect(0, 0, 600, PAGE_H)], { item: () => null }) as unknown as DOMRectList;
    const pages = selectionPageRects(sel);
    expect(pages.get(1)).toEqual([[100, 688, 160, 700]]);
    expect(pages.get(2)).toEqual([[100, 588, 180, 600]]);
  });

  it('no cuenta el texto que está fuera de las capas aunque esté dentro del rango (número de página)', () => {
    const sel = selectAcrossPages();
    // Marcador «2» de la página 3, entre los extremos del rango pero fuera de su capa de texto.
    const marker = document.createElement('span');
    marker.textContent = '3';
    document.querySelector('[data-page="2"]')?.before(marker);
    layers.push(marker);
    fragmentsByStart.set(marker.firstChild as Text, [rect(300, PAGE_H + 300, 320, PAGE_H + 340)]);
    const pages = selectionPageRects(sel);
    expect(pages.get(2)).toEqual([[100, 588, 180, 600]]);
    expect(pages.get(1)).toEqual([[100, 688, 160, 700]]);
  });

  it('descarta los fragmentos de área nula', () => {
    const sel = selectAcrossPages();
    const start = sel.getRangeAt(0).startContainer;
    fragmentsByStart.set(start, [rect(100, 100, 100, 112), rect(100, 100, 160, 100)]);
    expect(selectionPageRects(sel).get(1)).toBeUndefined();
  });
});

describe('markupSelection', () => {
  it('con rectángulos en las páginas 2 y 3 crea dos anotaciones con un solo paso de deshacer', () => {
    const sel = selectAcrossPages();
    const before = useAnnotations.getState().undo.undoDepth;

    const created = markupSelection('highlight', sel);

    expect(created).toBe(2);
    const state = useAnnotations.getState();
    expect(state.undo.undoDepth).toBe(before + 1);
    expect(state.undo.undoLabel).toBe('resaltar');
    const pages = [...state.edits.upserts.values()].map((a) => a.pageIndex).sort();
    expect(pages).toEqual([1, 2]);
    expect(sel.isCollapsed).toBe(true);

    act(() => {
      undo();
    });
    expect(useAnnotations.getState().edits.upserts.size).toBe(0);
  });

  it('sin texto seleccionado no crea nada', () => {
    const sel = document.getSelection();
    if (sel === null) throw new Error('sin API de selección');
    sel.removeAllRanges();
    expect(markupSelection('underline', sel)).toBe(0);
    expect(useAnnotations.getState().edits.upserts.size).toBe(0);
  });
});

describe('barra de acciones sobre la selección', () => {
  it('aparece con texto seleccionado y «Resaltar» crea la anotación', async () => {
    const user = userEvent.setup();
    selectAcrossPages();
    render(<SelectionActions />);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const bar = screen.getByRole('toolbar', { name: 'Acciones de la selección' });
    await user.click(within(bar).getByRole('button', { name: 'Resaltar' }));

    expect(useAnnotations.getState().edits.upserts.size).toBe(2);
    expect(screen.queryByRole('toolbar', { name: 'Acciones de la selección' })).toBeNull();
  });

  it('no aparece con una herramienta de anotación activa', () => {
    selectAcrossPages();
    useAnnotations.setState({ tool: 'highlight' });
    render(<SelectionActions />);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.queryByRole('toolbar', { name: 'Acciones de la selección' })).toBeNull();
  });

  it('Esc la quita', () => {
    selectAcrossPages();
    render(<SelectionActions />);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.getByRole('toolbar', { name: 'Acciones de la selección' })).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('toolbar', { name: 'Acciones de la selección' })).toBeNull();
  });
});

describe('«Resaltar» de la barra «Comentar»', () => {
  it('con texto seleccionado marca la selección y no cambia la herramienta', () => {
    selectAcrossPages();
    render(<CommentToolbar />);

    // Se usa `fireEvent`: el `mousedown` simulado de user-event colapsa la selección antes del clic.
    fireEvent.click(screen.getByRole('button', { name: 'Resaltar' }));

    expect(useAnnotations.getState().edits.upserts.size).toBe(2);
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('sin selección activa la herramienta y, si ya estaba activa, la desactiva', async () => {
    const user = userEvent.setup();
    document.getSelection()?.removeAllRanges();
    render(<CommentToolbar />);
    const button = screen.getByRole('button', { name: 'Resaltar' });

    await user.click(button);
    expect(useAnnotations.getState().tool).toBe('highlight');
    expect(useAnnotations.getState().edits.upserts.size).toBe(0);

    await user.click(button);
    expect(useAnnotations.getState().tool).toBe('none');
  });
});
