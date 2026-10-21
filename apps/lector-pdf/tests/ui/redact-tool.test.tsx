// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageViewport } from '../../src/engine/pdfjs';
import { App } from '../../src/ui/App';
import { editMsg } from '../../src/ui/messages-edit';
import { redactMsg } from '../../src/ui/messages-redact';
import { RedactLayer } from '../../src/ui/viewer/RedactLayer';
import { endAnnotationSession, setTool } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { addMark, registerRedactParticipant } from '../../src/state/redact-actions';
import { initialRedactState, useRedact } from '../../src/state/redact-store';
import { initialSearchState, useSearch } from '../../src/state/search-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Ventana de Pointer Events: jsdom no la tiene. */
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { readonly pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

/** Página de 792 pt de alto a escala 2 (como en las demás pruebas de capas). */
const PAGE_HEIGHT = 792;
const SCALE = 2;

function fakeViewport(): PageViewport {
  return {
    width: 612 * SCALE,
    height: PAGE_HEIGHT * SCALE,
    convertToViewportPoint: (x: number, y: number) => [x * SCALE, (PAGE_HEIGHT - y) * SCALE],
    convertToPdfPoint: (x: number, y: number) => [x / SCALE, PAGE_HEIGHT - y / SCALE],
  } as unknown as PageViewport;
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  registerRedactParticipant();
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useRedact.setState(initialRedactState);
  useSearch.setState(initialSearchState);
  useViewer.setState({ ...initialViewerState, status: 'ready', file: { name: 'a.pdf' } as never });
});

afterEach(() => {
  vi.unstubAllGlobals();
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useRedact.setState(initialRedactState);
  useSearch.setState(initialSearchState);
  useViewer.setState(initialViewerState);
});

/** Arrastra el puntero desde (x0, y0) hasta (x1, y1) sobre la capa, en píxeles de ventana. */
function drag(layer: HTMLElement, [x0, y0]: readonly [number, number], [x1, y1]: readonly [number, number]): void {
  fireEvent.pointerDown(layer, { button: 0, clientX: x0, clientY: y0 });
  fireEvent.pointerMove(window, { clientX: x1, clientY: y1 });
  fireEvent.pointerUp(window, { clientX: x1, clientY: y1 });
}

describe('herramienta «Redactar» en la página (PDF-137)', () => {
  it('arrastrar con la herramienta activa crea una zona en puntos PDF; un clic no crea nada', () => {
    setTool('redact');
    const { container } = render(<RedactLayer pageIndex={0} viewport={fakeViewport()} />);
    const layer = container.firstElementChild as HTMLElement;

    drag(layer, [20, 40], [120, 100]);
    const marks = useRedact.getState().marks;
    expect(marks).toHaveLength(1);
    // Los píxeles (20,40)-(120,100) a escala 2 son (10,20)-(60,50) en puntos, con el eje Y hacia arriba.
    expect(marks[0]?.pageIndex).toBe(0);
    expect(marks[0]?.rect).toEqual([10, PAGE_HEIGHT - 50, 60, PAGE_HEIGHT - 20]);

    fireEvent.pointerDown(layer, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    expect(useRedact.getState().marks).toHaveLength(1);
  });

  it('Escape cancela el arrastre en curso sin crear zona y sin dejar la herramienta', () => {
    setTool('redact');
    const { container } = render(<RedactLayer pageIndex={0} viewport={fakeViewport()} />);
    const layer = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(layer, { button: 0, clientX: 20, clientY: 40 });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 100 });
    expect(container.querySelector('[class*="sketch"]')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[class*="sketch"]')).toBeNull();
    fireEvent.pointerUp(window, { clientX: 120, clientY: 100 });
    expect(useRedact.getState().marks).toHaveLength(0);
    expect(useAnnotations.getState().tool).toBe('redact');
  });

  it('las marcas tienen nombre accesible y Supr quita la marca enfocada', async () => {
    const user = userEvent.setup();
    addMark(0, [10, 10, 100, 50]);
    render(<RedactLayer pageIndex={0} viewport={fakeViewport()} />);

    const mark = screen.getByRole('group', { name: redactMsg.mark(1) });
    await user.click(mark);
    await user.keyboard('{Delete}');
    expect(useRedact.getState().marks).toHaveLength(0);
  });

  it('sin herramienta activa la capa no captura el puntero y no crea zonas', () => {
    const { container } = render(<RedactLayer pageIndex={0} viewport={fakeViewport()} />);
    expect(container.firstChild).toBeNull();
    addMark(0, [10, 10, 100, 50]);
    const layer = render(<RedactLayer pageIndex={0} viewport={fakeViewport()} />).container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(layer, { button: 0, clientX: 20, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 100 });
    expect(useRedact.getState().marks).toHaveLength(1);
  });
});

describe('barra «Editar» con «Redactar» (PDF-137)', () => {
  /** Abre la barra «Editar» y devuelve la segunda fila. */
  async function openEditBar(user: ReturnType<typeof userEvent.setup>) {
    render(<App />);
    await user.click(screen.getByRole('button', { name: editMsg.editButton }));
    return screen.findByRole('toolbar', { name: editMsg.editButton });
  }

  it('«Redactar» activa la herramienta y muestra sus botones; «Aplicar» sigue el número de marcas', async () => {
    const user = userEvent.setup();
    await openEditBar(user);
    const tool = screen.getByRole('button', { name: redactMsg.tool });
    await user.click(tool);
    expect(useAnnotations.getState().tool).toBe('redact');
    expect(tool).toHaveAttribute('aria-pressed', 'true');

    const apply = await screen.findByRole('button', { name: redactMsg.apply(0) });
    expect(apply).toBeDisabled();
    expect(screen.getByRole('button', { name: redactMsg.markSearch })).toBeDisabled();

    act(() => {
      addMark(0, [10, 10, 100, 50]);
    });
    expect(await screen.findByRole('button', { name: redactMsg.apply(1) })).toBeEnabled();
  });

  it('«Marcar resultados de búsqueda» solo se habilita con coincidencias', async () => {
    const user = userEvent.setup();
    await openEditBar(user);
    await user.click(screen.getByRole('button', { name: redactMsg.tool }));
    expect(await screen.findByRole('button', { name: redactMsg.markSearch })).toBeDisabled();

    act(() => {
      useSearch.setState({ total: 2 });
    });
    expect(await screen.findByRole('button', { name: redactMsg.markSearch })).toBeEnabled();
  });
});
