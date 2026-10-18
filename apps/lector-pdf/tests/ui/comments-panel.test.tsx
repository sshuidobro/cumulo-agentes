// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStorageStore, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import type { ForeignAnnotation } from '../../src/core/annotations/import';
import type { Annotation } from '../../src/core/annotations/model';
import { PageDimsTable } from '../../src/core/page-dims';
import { CommentsPanel } from '../../src/ui/sidebar/CommentsPanel';
import { Sidebar } from '../../src/ui/sidebar/Sidebar';
import {
  endAnnotationSession,
  getEffective,
  startAnnotationSession,
} from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initServices, services } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { FakeResizeObserver } from '../setup/resize-observer';
import { memorySource } from '@suite/platform';
import type * as Navigation from '../../src/state/navigation';
import { fileAnnotation, newAnnotation } from '../unit/annotations/factories';

const goToPage = vi.fn();
vi.mock('../../src/state/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof Navigation>();
  return { ...actual, goToPage: (...args: Parameters<typeof Navigation.goToPage>) => goToPage(...args) };
});

const VIEW_H = 600;
const PAGES = 10;

function setup(options: { readonly scan?: 'done' | 'lazy' | 'scanning'; readonly height?: number } = {}) {
  render(<CommentsPanel />);
  const list = screen.getByRole('listbox', { name: 'Comentarios del documento' });
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: 232 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: options.height ?? VIEW_H });
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 });
  act(() => {
    FakeResizeObserver.triggerResize(list);
  });
  return list;
}

/** Carga anotaciones en el estado (sin documento abierto) y un visor con `PAGES` páginas. */
function load(baseline: readonly Annotation[], foreign: readonly ForeignAnnotation[] = [], scan: 'done' | 'lazy' | 'scanning' = 'done'): void {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('annotated.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(PAGES, 612, 792, 0),
    dimsVersion: 1,
  });
  useAnnotations.setState({
    ...initialAnnotationState(),
    baseline: new Map(baseline.map((a) => [a.id, a] as const)),
    foreign: new Map(foreign.map((r) => [r.id, r] as const)),
    scan,
    author: 'Usuario',
  });
}

function rowNamed(text: string): HTMLElement {
  const row = screen.getAllByRole('option').find((el) => el.textContent?.includes(text));
  if (row === undefined) throw new Error(`sin fila con «${text}»`);
  return row;
}

function optionCount(): number {
  return screen.queryAllByRole('option').length;
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  goToPage.mockClear();
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
    assetBaseUrl: '',
  });
  endAnnotationSession();
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('Panel de comentarios (PDF-036)', () => {
  it('con 10 000 anotaciones monta menos de 40 filas en el DOM', () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      newAnnotation(`suite-${String(i)}`, 'note', i % PAGES),
    );
    load(many);
    setup();
    expect(optionCount()).toBeGreaterThan(0);
    expect(optionCount()).toBeLessThan(40);
    expect(screen.getByText('10.000 comentarios', { selector: 'p' })).toBeInTheDocument();
  });

  it('Intro sobre un comentario va a su página, lo selecciona y abre su ventana', async () => {
    const user = userEvent.setup();
    const note = { ...newAnnotation('suite-1', 'note', 2), contents: 'Revisar esto' };
    load([note]);
    const list = setup();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(goToPage).toHaveBeenCalledTimes(1);
    expect(goToPage).toHaveBeenCalledWith(2, expect.objectContaining({ yFraction: expect.any(Number) }));
    expect(useAnnotations.getState().selectedId).toBe('suite-1');
    // La ventana se abre cuando el visor pone esa página como actual (la navegación es asíncrona).
    expect(useAnnotations.getState().openPopupId).toBeNull();
    act(() => {
      useViewer.setState({ currentPage: 2 });
    });
    expect(useAnnotations.getState().openPopupId).toBe('suite-1');
  });

  it('clic sobre un comentario de solo lectura solo navega: no abre ventana ni selecciona', async () => {
    const user = userEvent.setup();
    const ajena: ForeignAnnotation = {
      id: 'ref:17R',
      pageIndex: 2,
      subtype: 'Square',
      rect: [72, 100, 200, 150],
      contents: 'Ver tabla',
      author: 'Otra persona',
      modified: null,
    };
    load([], [ajena]);
    setup();

    await user.click(rowNamed('Ver tabla'));

    expect(goToPage).toHaveBeenCalledWith(2, expect.any(Object));
    expect(useAnnotations.getState().openPopupId).toBeNull();
    expect(useAnnotations.getState().selectedId).toBeNull();
    expect(screen.getByText('solo lectura')).toBeInTheDocument();
    expect(within(rowNamed('Ver tabla')).queryByRole('button', { name: 'Borrar' })).toBeNull();
  });

  it('cambiar «Tu nombre» a «Ana» guarda la preferencia y el autor de las anotaciones nuevas', async () => {
    const user = userEvent.setup();
    load([]);
    setup();

    const field = screen.getByLabelText('Tu nombre');
    await user.clear(field);
    await user.type(field, 'Ana');
    fireEvent.blur(field);

    const stored = services().platform.prefs.get('annotationAuthor', (v): v is string => typeof v === 'string');
    expect(stored).toBe('Ana');
    expect(useAnnotations.getState().author).toBe('Ana');
  });

  it('el botón Borrar quita el comentario de la lista y del documento', async () => {
    const user = userEvent.setup();
    load([{ ...fileAnnotation(9, 'highlight', 1), contents: 'Para borrar' }]);
    setup();

    await user.click(within(rowNamed('Para borrar')).getByRole('button', { name: 'Borrar' }));

    expect(getEffective().has('ref:9R')).toBe(false);
    await waitFor(() => {
      expect(screen.queryByText('Para borrar')).toBeNull();
    });
  });

  it('el buscador filtra por texto sin distinguir mayúsculas ni acentos y el recuento sigue al filtro', async () => {
    const user = userEvent.setup();
    load([
      { ...newAnnotation('a', 'note', 0), contents: 'Revisar la CIFRA' },
      { ...newAnnotation('b', 'note', 0), contents: 'Otra cosa' },
    ]);
    setup();
    expect(screen.getByText('2 comentarios', { selector: 'p' })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar en comentarios' }), 'cifra');

    expect(screen.getByText('1 comentario', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nota de Ana, página 1' })).toBeInTheDocument();
  });

  it('sin comentarios muestra el mensaje de vacío; con un filtro sin resultados, el de filtro', async () => {
    const user = userEvent.setup();
    load([]);
    setup();
    expect(screen.getByText(/no tiene comentarios/)).toBeInTheDocument();

    load([{ ...newAnnotation('a', 'note', 0), contents: 'algo' }]);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar en comentarios' }), 'zzz');
    expect(screen.getByText('Ningún comentario coincide con el filtro.')).toBeInTheDocument();
  });

  it('documento grande (lazy): aviso y botón que lanza el escaneo con progreso', async () => {
    const user = userEvent.setup();
    const pending = new Promise<never>(() => undefined);
    const lazy = { numPages: 25_000, doc: { numPages: 25_000, getPage: vi.fn(() => pending) } } as unknown as LoadedPdf;
    load([]);
    startAnnotationSession(lazy, new AbortController().signal);
    useViewer.setState({ dims: PageDimsTable.uniform(25_000, 612, 792, 0), dimsVersion: 2 });
    setup();

    expect(screen.getByText(/se muestran los comentarios de las páginas visitadas/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Buscar en todo el documento' }));

    expect(useAnnotations.getState().scan).toBe('scanning');
    expect(screen.getByText(/Cargando comentarios… \(0 de 25\.000 páginas\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('se puede escoger el autor y el tipo desde el menú Filtrar', async () => {
    const user = userEvent.setup();
    load([
      { ...newAnnotation('a', 'note', 0), author: 'Ana', contents: 'de Ana' },
      { ...newAnnotation('b', 'ink', 0), author: 'Luis', contents: 'de Luis' },
    ]);
    setup();

    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Luis' }));
    expect(screen.getByText('1 comentario', { selector: 'p' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Todos los autores' }));
    expect(screen.getByText('2 comentarios', { selector: 'p' })).toBeInTheDocument();
  });

  it('una anotación seleccionada en la página queda marcada en la lista', () => {
    load([{ ...newAnnotation('a', 'note', 0), contents: 'uno' }, { ...newAnnotation('b', 'note', 0), contents: 'dos' }]);
    setup();
    act(() => {
      useAnnotations.setState({ selectedId: 'b' });
    });
    expect(rowNamed('dos')).toHaveAttribute('aria-selected', 'true');
    expect(rowNamed('uno')).toHaveAttribute('aria-selected', 'false');
  });

  it('la pestaña «Comentarios» del panel lateral muestra el panel', () => {
    load([]);
    useViewer.setState({ sidebar: 'comments' });
    render(<Sidebar />);
    expect(screen.getByRole('tab', { name: 'Comentarios' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Tu nombre')).toBeInTheDocument();
  });
});
