// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStorageStore, type ByteSource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPdf, type LoadedPdf } from '../../src/engine';
import type { ForeignAnnotation } from '../../src/core/annotations/import';
import type { Annotation } from '../../src/core/annotations/model';
import { newReply, newReviewState } from '../../src/core/annotations/replies';
import type { SignatureAnnotation, SignatureArt } from '../../src/core/annotations';
import { PageDimsTable } from '../../src/core/page-dims';
import { CommentsPanel } from '../../src/ui/sidebar/CommentsPanel';
import { Sidebar } from '../../src/ui/sidebar/Sidebar';
import {
  endAnnotationSession,
  ensurePageAnnotations,
  getEffective,
  startAnnotationSession,
  undo,
} from '../../src/state/annotation-actions';
import { closeDocument, openDocument } from '../../src/state/document-actions';
import { additionsDiff, saveAnnotations } from '../support/save-annotations';
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nombre accesible de una fila: empieza por `name` y va seguido de espacio o del final (el resto es el contenido). */
function optionName(name: string): RegExp {
  const escaped = escapeRegExp(name).replace(/,/g, '\\s*,');
  return new RegExp('^' + escaped + '(?:\\s|$)');
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

    await user.click(within(rowNamed('Para borrar')).getByTestId('comment-row-delete'));

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
    expect(screen.getByRole('option', { name: optionName('Nota de Ana, página 1') })).toBeInTheDocument();
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

  it('la fila tiene como nombre su contenido visible: «Nota de Ana, página 1» seguido del extracto', () => {
    load([{ ...fileAnnotation(1, 'note', 0), contents: 'Revisar esto' }]);
    setup();
    const row = screen.getByRole('option', { name: optionName('Nota de Ana, página 1') });
    expect(row).toHaveTextContent('Revisar esto');
    expect(row).not.toHaveAttribute('aria-label');
  });

  it('ninguna fila contiene botones ni elementos enfocables ( ni con comentario de solo lectura)', () => {
    load(
      [{ ...fileAnnotation(1, 'note', 0), contents: 'uno' }],
      [{ id: 'ref:17R', pageIndex: 0, subtype: 'Square', rect: [72, 100, 200, 150], contents: 'dos', author: 'Otra', modified: null }],
    );
    setup();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(within(option).queryAllByRole('button')).toHaveLength(0);
      expect(option.querySelectorAll('[tabindex]')).toHaveLength(0);
    }
  });

  it('con el foco en la lista, Supr borra la fila activa; la activa pasa a la siguiente y Ctrl+Z la recupera', async () => {
    const user = userEvent.setup();
    load([
      { ...fileAnnotation(1, 'note', 0), contents: 'uno' },
      { ...fileAnnotation(2, 'note', 0), contents: 'dos' },
    ]);
    const list = setup();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}');
    expect(list).toHaveAttribute('aria-activedescendant', rowNamed('uno').id);
    await user.keyboard('{Delete}');

    expect(screen.queryByText('uno')).toBeNull();
    expect(getEffective().has('ref:1R')).toBe(false);
    expect(list).toHaveAttribute('aria-activedescendant', rowNamed('dos').id);

    act(() => {
      undo();
    });
    expect(getEffective().has('ref:1R')).toBe(true);
    expect(rowNamed('uno')).toBeInTheDocument();
  });

  it('al borrar con Supr la última fila, la activa pasa a la anterior', async () => {
    const user = userEvent.setup();
    load([
      { ...fileAnnotation(1, 'note', 0), contents: 'uno' },
      { ...fileAnnotation(2, 'note', 0), contents: 'dos' },
    ]);
    const list = setup();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}{ArrowDown}{Delete}');

    expect(getEffective().has('ref:2R')).toBe(false);
    expect(getEffective().has('ref:1R')).toBe(true);
    expect(list).toHaveAttribute('aria-activedescendant', rowNamed('uno').id);
  });

  it('Retroceso también borra la fila activa editable', async () => {
    const user = userEvent.setup();
    load([{ ...fileAnnotation(1, 'note', 0), contents: 'uno' }]);
    const list = setup();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}{Backspace}');

    expect(getEffective().has('ref:1R')).toBe(false);
    expect(list).not.toHaveAttribute('aria-activedescendant');
  });

  it('Supr sobre una fila de solo lectura no borra nada', async () => {
    const user = userEvent.setup();
    load(
      [],
      [{ id: 'ref:17R', pageIndex: 2, subtype: 'Square', rect: [72, 100, 200, 150], contents: 'Ver tabla', author: 'Otra persona', modified: null }],
    );
    const list = setup();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}{Delete}');

    expect(useAnnotations.getState().foreign.has('ref:17R')).toBe(true);
    expect(rowNamed('Ver tabla')).toBeInTheDocument();
  });

  it('«Borrar comentario» está deshabilitado sin fila activa y con una de solo lectura; con una editable la borra', async () => {
    const user = userEvent.setup();
    load(
      [{ ...fileAnnotation(1, 'note', 0), contents: 'uno' }],
      [{ id: 'ref:17R', pageIndex: 1, subtype: 'Square', rect: [72, 100, 200, 150], contents: 'Ver tabla', author: 'Otra persona', modified: null }],
    );
    const list = setup();
    const button = screen.getByRole('button', { name: 'Borrar comentario' });
    expect(button).toBeDisabled();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(list).toHaveAttribute('aria-activedescendant', rowNamed('Ver tabla').id);
    expect(button).toBeDisabled();

    await user.keyboard('{ArrowUp}');
    expect(button).toBeEnabled();
    await user.click(button);

    expect(getEffective().has('ref:1R')).toBe(false);
    expect(useAnnotations.getState().foreign.has('ref:17R')).toBe(true);
  });

  it('el icono de borrar de una fila borra el comentario sin navegar a su página', async () => {
    const user = userEvent.setup();
    load([{ ...fileAnnotation(1, 'note', 4), contents: 'Para borrar' }]);
    useViewer.setState({ currentPage: 7 });
    setup();

    await user.click(within(rowNamed('Para borrar')).getByTestId('comment-row-delete'));

    expect(getEffective().has('ref:1R')).toBe(false);
    expect(goToPage).not.toHaveBeenCalled();
    expect(useViewer.getState().currentPage).toBe(7);
  });
});

describe('sellos ajenos guardados por la suite (PDF-104)', () => {
  const stamp = (id: string, stampName?: string): ForeignAnnotation => ({
    id,
    pageIndex: 0,
    subtype: 'Stamp',
    rect: [10, 20, 110, 40],
    contents: '',
    author: '',
    modified: null,
    ...(stampName === undefined ? {} : { stampName }),
  });

  it('una firma de la suite se muestra como «Firma» y el filtro de tipos la ofrece', async () => {
    const user = userEvent.setup();
    load([], [stamp('ref:20R', 'SuiteFirma')]);
    setup();

    expect(rowNamed('Firma')).toBeInTheDocument();
    expect(screen.queryByText('Sello', { exact: false })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Firma' })).toBeInTheDocument();
  });

  it('un sello con otro /Name, o sin nombre, se muestra como «Sello»', () => {
    load([], [stamp('ref:21R', 'Approved'), stamp('ref:22R')]);
    setup();

    expect(screen.getAllByRole('option').filter((el) => el.textContent?.includes('Sello'))).toHaveLength(2);
    expect(screen.queryByText('Firma', { exact: false })).toBeNull();
  });

  it('la firma reabierta es de solo lectura: no tiene botón de borrar activo', () => {
    load([], [stamp('ref:23R', 'SuiteFirma')]);
    setup();

    const row = rowNamed('Firma');
    expect(row.querySelector('button')).toBeNull();
  });
});

describe('firmas y sellos de un PDF abierto (PDF-104)', () => {
  const OPEN_TIMEOUT = 30_000;
  // El PDF mínimo no usa fuentes ni mapas de caracteres: no hace falta la carpeta de recursos de pdf.js.
  const ASSET_BASE = '';
  const SIGNED_AT = '2026-10-18T09:30:00.000Z';
  const INK: SignatureArt = { kind: 'ink', paths: [[0, 0, 25, 40, 50, 0]], width: 2, box: [100, 50] };
  const signature: SignatureAnnotation = {
    id: 'firma-1',
    type: 'signature',
    pageIndex: 0,
    rect: [100, 100, 300, 200],
    color: [0, 0, 0.6],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: SIGNED_AT,
    created: SIGNED_AT,
    origin: { kind: 'new' },
    art: INK,
  };

  /** PDF mínimo de una página, escrito a mano (jsdom no puede leer `fixtures/`): objetos y xref con desplazamientos reales. */
  function minimalPdf(): Uint8Array {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((object, i) => {
      const offset = body.length;
      body += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xref = body.length;
    body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return new TextEncoder().encode(body);
  }

  /** PDF de una página con una firma escrita por la suite (`/Name /SuiteFirma`). */
  async function signedBytes(): Promise<Uint8Array> {
    const { data } = await saveAnnotations(minimalPdf(), additionsDiff([signature]));
    return data;
  }

  /**
   * Mismo PDF con un sello de Acrobat `/Name /Approved`. Se cambia el nombre por otro de la misma longitud
   * («Approved» con dos espacios), así no se mueven los desplazamientos de la xref.
   */
  function asApprovedStamp(data: Uint8Array): Uint8Array {
    const parts = Buffer.from(data).toString('latin1').split('/Name /SuiteFirma');
    if (parts.length !== 2) throw new Error('el PDF no tiene exactamente una firma de la suite');
    return new Uint8Array(Buffer.from(parts.join('/Name /Approved  '), 'latin1'));
  }

  async function openAndWaitForScan(data: Uint8Array): Promise<void> {
    await openDocument(openedFile('firmado.pdf', memorySource(data)));
    await vi.waitFor(() => {
      expect(useAnnotations.getState().scan).toBe('done');
    }, { timeout: OPEN_TIMEOUT });
  }

  beforeEach(() => {
    initServices({
      platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
      assetBaseUrl: ASSET_BASE,
    });
  });

  afterEach(async () => {
    await closeDocument();
  });

  it('abrir un PDF con una firma de la suite lista «Firma» y el filtro la ofrece', async () => {
    const user = userEvent.setup();
    await openAndWaitForScan(await signedBytes());
    setup();

    expect(rowNamed('Firma')).toBeInTheDocument();
    expect(screen.queryByText('Sello', { exact: false })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Firma' })).toBeInTheDocument();
  }, OPEN_TIMEOUT);

  it('abrir un PDF con un sello /Name /Approved lista «Sello», no «Firma»', async () => {
    await openAndWaitForScan(asApprovedStamp(await signedBytes()));
    setup();

    expect(rowNamed('Sello')).toBeInTheDocument();
    expect(screen.queryByText('Firma', { exact: false })).toBeNull();
  }, OPEN_TIMEOUT);

  it('en modo «lazy», la página importada al verla lista «Firma»', async () => {
    const data = await signedBytes();
    const loaded = await loadPdf(memorySource(data), { assetBaseUrl: ASSET_BASE });
    if (!loaded.ok) throw new Error(loaded.error.code);
    try {
      // Más páginas que el límite de escaneo completo: la sesión no escanea y cada página se importa al verla.
      const lazy: LoadedPdf = { ...loaded.value, numPages: 25_000 };
      useViewer.setState({
        ...initialViewerState,
        status: 'ready',
        file: openedFile('firmado.pdf', memorySource(data)),
        dims: PageDimsTable.uniform(1, 612, 792, 0),
        dimsVersion: 1,
      });
      startAnnotationSession(lazy, new AbortController().signal, memorySource(data));
      await ensurePageAnnotations(0);
      setup();

      expect(useAnnotations.getState().scan).toBe('lazy');
      expect(rowNamed('Firma')).toBeInTheDocument();
    } finally {
      endAnnotationSession();
      await loaded.value.destroy();
    }
  }, OPEN_TIMEOUT);

  it('si el fichero no se puede volver a leer, el escaneo termina y la firma sale como «Sello» sin error', async () => {
    const data = await signedBytes();
    const loaded = await loadPdf(memorySource(data), { assetBaseUrl: ASSET_BASE });
    if (!loaded.ok) throw new Error(loaded.error.code);
    try {
      const broken: ByteSource = { size: data.length, read: () => Promise.reject(new Error('lectura fallida')) };
      startAnnotationSession(loaded.value, new AbortController().signal, broken);
      await vi.waitFor(() => {
        expect(useAnnotations.getState().scan).toBe('done');
      }, { timeout: OPEN_TIMEOUT });
      setup();

      expect(rowNamed('Sello')).toBeInTheDocument();
      expect(screen.queryByText('Firma', { exact: false })).toBeNull();
    } finally {
      endAnnotationSession();
      await loaded.value.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('respuestas y estados en el panel (PDF-116)', () => {
  const AT = '2026-10-17T12:00:00.000Z';

  /** Una nota con una respuesta de Ana y un estado «Aceptado», en la página 2. */
  function threaded() {
    const note = { ...newAnnotation('suite-1', 'note', 2), contents: 'Revisar esto', author: 'Otra persona' };
    const reply = newReply({ id: 'suite-r1', parent: note, contents: 'Hecho', author: 'Ana', now: AT });
    const state = newReviewState({ id: 'suite-s1', parent: note, state: 'Accepted', author: 'Ana', now: AT });
    return { note, reply, state };
  }

  it('la respuesta va bajo su comentario con su autor; el comentario muestra su estado y «1 respuesta»', () => {
    const { note, reply, state } = threaded();
    load([note, reply, state]);
    setup();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[1]).toBe(rowNamed('Respuesta de Ana'));
    expect(screen.getByText('Aceptado')).toBeInTheDocument();
    expect(screen.getByText('1 respuesta')).toBeInTheDocument();
    expect(screen.getByText('1 comentario', { selector: 'p' })).toBeInTheDocument();
  });

  it('flecha abajo desde el comentario pasa a su respuesta; Intro en la respuesta abre la ventana del comentario padre', async () => {
    const user = userEvent.setup();
    const { note, reply, state } = threaded();
    load([note, reply, state]);
    const list = setup();

    act(() => list.focus());
    await user.keyboard('{ArrowDown}');
    expect(list).toHaveAttribute('aria-activedescendant', rowNamed('Revisar esto').id);
    await user.keyboard('{ArrowDown}');
    expect(list).toHaveAttribute('aria-activedescendant', rowNamed('Respuesta de Ana').id);

    await user.keyboard('{Enter}');
    expect(goToPage).toHaveBeenLastCalledWith(2, expect.objectContaining({ yFraction: expect.any(Number) }));
    expect(useAnnotations.getState().selectedId).toBe('suite-1');
    act(() => {
      useViewer.setState({ currentPage: 2 });
    });
    expect(useAnnotations.getState().openPopupId).toBe('suite-1');
  });

  it('clic sobre una respuesta abre la ventana de su comentario', async () => {
    const user = userEvent.setup();
    const { note, reply, state } = threaded();
    load([note, reply, state]);
    setup();

    await user.click(rowNamed('Respuesta de Ana'));
    expect(useAnnotations.getState().selectedId).toBe('suite-1');
  });

  it('el menú Filtrar tiene el grupo «Estado»; elegir «Rechazado» oculta la nota aceptada con su respuesta', async () => {
    const user = userEvent.setup();
    const { note, reply, state } = threaded();
    const rejected = { ...newAnnotation('suite-2', 'note', 3), contents: 'Otra nota', author: 'Otra persona' };
    const rejectedState = newReviewState({ id: 'suite-s2', parent: rejected, state: 'Rejected', author: 'Ana', now: AT });
    load([note, reply, state, rejected, rejectedState]);
    setup();

    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(screen.getByText('Estado', { selector: 'div' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Rechazado' }));
    expect(screen.getByText('1 comentario', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Respuesta de Ana/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Revisar esto/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Otra nota/ })).toBeInTheDocument();
  });
});
