// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import type { PageViewport } from '../../src/engine/pdfjs';
import { newAnnotation, fileAnnotation } from '../unit/annotations/factories';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import { AnnotationPopup } from '../../src/ui/viewer/AnnotationPopup';
import {
  addAnnotation,
  endAnnotationSession,
  getEffective,
  openPopup,
  startAnnotationSession,
  undo,
} from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

const setFileAnnotationHidden = vi.fn();
vi.mock('../../src/engine/annotation-visibility', () => ({
  setFileAnnotationHidden: (...args: unknown[]) => setFileAnnotationHidden(...args),
}));

/** Página US Letter (612 × 792 pt) a escala 1 y rotación 0: x_px = x_pt, y_px = 792 - y_pt. */
const PAGE_HEIGHT = 792;
const PAGE_WIDTH = 612;

function fakeViewport(): PageViewport {
  return {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    transform: [1, 0, 0, -1, 0, PAGE_HEIGHT],
    convertToPdfPoint: (x: number, y: number) => [x, PAGE_HEIGHT - y],
  } as unknown as PageViewport;
}

/** Capa de la página y su ventana de comentario, como las monta `PageView`. */
function renderPage(visible = true) {
  return render(
    <>
      <AnnotationLayer pageIndex={0} viewport={fakeViewport()} />
      <AnnotationPopup pageIndex={0} viewport={fakeViewport()} visible={visible} />
    </>,
  );
}

/** Zona activa de la anotación con este id. */
function zone(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-annot-id="${id}"]`);
  if (el === null) throw new Error(`sin zona para ${id}`);
  return el;
}

/** Svg de la capa de anotaciones de la página. */
function layerSvg(): Element {
  const svg = document.querySelector('svg');
  if (svg === null) throw new Error('sin capa');
  return svg;
}

function lazyLoaded(): LoadedPdf {
  return { numPages: 25_000, doc: {} } as unknown as LoadedPdf;
}

/** Valor del campo de comentario. */
function valueOf(el: HTMLElement): string {
  return (el as HTMLTextAreaElement).value;
}

/** Avanza el reloj falso (solo `Date`, para el agrupado de deshacer). */
function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  // El reloj falso va antes de crear la pila de deshacer (`endAnnotationSession`) para que la capture.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
    assetBaseUrl: '',
  });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('annotated.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
  setFileAnnotationHidden.mockClear();
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
  vi.useRealTimers();
});

describe('Herramienta Nota (PDF-033)', () => {
  it('un clic en (100, 100) px crea una nota cuya esquina superior izquierda es ese punto, abre su ventana con el foco en el comentario y deja la herramienta en «ninguna»', () => {
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    useAnnotations.setState({ tool: 'note' });
    renderPage();

    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });

    const notes = [...getEffective().values()];
    expect(notes).toHaveLength(1);
    const [note] = notes;
    expect(note?.type).toBe('note');
    expect(note?.rect[0]).toBeCloseTo(100, 1);
    expect(note?.rect[3]).toBeCloseTo(PAGE_HEIGHT - 100, 1);
    expect(note?.rect[2]).toBeCloseTo(120, 1);
    expect(note?.rect[1]).toBeCloseTo(PAGE_HEIGHT - 120, 1);
    expect(useAnnotations.getState().tool).toBe('none');
    expect(useAnnotations.getState().selectedId).toBe(note?.id);

    const dialog = screen.getByRole('dialog', { name: 'Comentario de Usuario' });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Comentario' })).toBe(document.activeElement);
  });

  it('la nota nueva queda en la pila como «añadir nota»', () => {
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    useAnnotations.setState({ tool: 'note' });
    renderPage();

    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 50, clientY: 50 });

    expect(useAnnotations.getState().undo.undoLabel).toBe('añadir nota');
  });

  it('sin la herramienta «Nota», un clic en la página no crea nada', () => {
    useAnnotations.setState({ tool: 'none' });
    renderPage();

    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });

    expect(getEffective().size).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Ventana de comentario · escritura y deshacer (PDF-033)', () => {
  it('cuatro cambios en menos de 500 ms son una sola entrada «escribir comentario»; Ctrl+Z con el foco fuera deja el comentario vacío', () => {
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });
    const text = screen.getByRole('textbox', { name: 'Comentario' });

    for (const value of ['h', 'ho', 'hol', 'hola']) {
      fireEvent.change(text, { target: { value } });
      advance(100);
    }

    expect(valueOf(text)).toBe('hola');
    expect(useAnnotations.getState().undo.undoLabel).toBe('escribir comentario');
    expect(useAnnotations.getState().undo.undoDepth).toBe(2);

    // Foco fuera del campo: el atajo de deshacer de la aplicación actúa sobre la pila.
    text.blur();
    act(() => {
      undo();
    });

    const [note] = [...getEffective().values()];
    expect(note?.contents).toBe('');
    expect(useAnnotations.getState().undo.undoLabel).toBe('añadir nota');
  });

  it('Esc cierra la ventana, devuelve el foco a la zona activa de la nota y corta el agrupado', () => {
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });
    const [note] = [...getEffective().values()];
    const text = screen.getByRole('textbox', { name: 'Comentario' });
    fireEvent.change(text, { target: { value: 'x' } });

    fireEvent.keyDown(text, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAnnotations.getState().openPopupId).toBeNull();
    expect(document.activeElement).toBe(zone(note?.id ?? ''));
  });

  it('«Borrar» elimina la anotación y cierra la ventana', () => {
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });
    const [note] = [...getEffective().values()];

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect(getEffective().has(note?.id ?? '')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Cerrar» cierra la ventana y devuelve el foco a la zona', () => {
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });
    const [note] = [...getEffective().values()];

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(zone(note?.id ?? ''));
  });

  it('la ventana tiene rol de diálogo no modal con nombre, y el orden de tabulación es comentario, Borrar, Cerrar', () => {
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });

    const dialog = screen.getByRole('dialog', { name: 'Comentario de Usuario' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    const text = screen.getByRole('textbox', { name: 'Comentario' });
    const borrar = screen.getByRole('button', { name: 'Borrar' });
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    // Node.DOCUMENT_POSITION_FOLLOWING: el siguiente en el DOM es el que sigue en el orden de tabulación.
    expect(text.compareDocumentPosition(borrar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(borrar.compareDocumentPosition(cerrar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Ventana de comentario · apertura (PDF-033)', () => {
  it('doble clic en un resaltado del fichero muestra su comentario y su autor', () => {
    useAnnotations.setState({
      baseline: new Map([
        ['ref:5R', { ...fileAnnotation(5, 'highlight'), contents: 'Comentario previo', author: 'Otra persona' }],
      ]),
    });
    renderPage();

    fireEvent.doubleClick(zone('ref:5R'));

    expect(screen.getByRole('dialog', { name: 'Comentario de Otra persona' })).toBeTruthy();
    expect(valueOf(screen.getByRole('textbox', { name: 'Comentario' }))).toBe('Comentario previo');
    expect(useAnnotations.getState().openPopupId).toBe('ref:5R');
  });

  it('Intro sobre la zona activa abre la ventana; el texto de la ventana se edita y pasa la anotación del fichero a modificada', () => {
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    useAnnotations.setState({
      baseline: new Map([['ref:5R', { ...fileAnnotation(5, 'highlight'), contents: '', author: 'Otra persona' }]]),
    });
    renderPage();

    fireEvent.keyDown(zone('ref:5R'), { key: 'Enter' });
    const text = screen.getByRole('textbox', { name: 'Comentario' });
    fireEvent.change(text, { target: { value: 'Revisar' } });

    expect(getEffective().get('ref:5R')?.contents).toBe('Revisar');
    expect(setFileAnnotationHidden).toHaveBeenCalledWith(expect.anything(), { num: 5, gen: 0 }, true);
  });

  it('abrir otra ventana cambia la que está abierta (solo hay una)', () => {
    useAnnotations.setState({
      baseline: new Map([
        ['ref:5R', { ...fileAnnotation(5, 'highlight'), contents: 'A', author: 'Ana' }],
        ['ref:6R', { ...fileAnnotation(6, 'underline'), contents: 'B', author: 'Luis' }],
      ]),
    });
    renderPage();

    fireEvent.doubleClick(zone('ref:5R'));
    fireEvent.doubleClick(zone('ref:6R'));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Comentario de Luis' })).toBeTruthy();
  });

  it('el título nativo de la zona muestra los primeros 200 caracteres del comentario', () => {
    const long = 'é'.repeat(250);
    useAnnotations.setState({
      baseline: new Map([['ref:7R', { ...fileAnnotation(7, 'highlight'), contents: long }]]),
    });
    renderPage();

    expect(zone('ref:7R').querySelector('title')?.textContent).toBe('é'.repeat(200));
  });

  it('con la ventana abierta y la página no visible, la ventana se cierra', () => {
    useAnnotations.setState({
      baseline: new Map([['ref:5R', { ...fileAnnotation(5, 'highlight'), contents: 'A' }]]),
    });
    openPopup('ref:5R');
    renderPage(false);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAnnotations.getState().openPopupId).toBeNull();
  });

  it('si la anotación de la ventana deja de existir (p. ej. al deshacer su creación), la ventana se cierra', () => {
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => {
      undo();
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAnnotations.getState().openPopupId).toBeNull();
  });
});

describe('Ventana de comentario · anotaciones nuevas (PDF-033)', () => {
  it('una anotación nueva con comentario muestra la fecha de modificación en la cabecera', () => {
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    useAnnotations.setState({ tool: 'note' });
    renderPage();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 100, clientY: 100 });

    const time = document.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(new Date().toISOString());
    expect(time?.textContent).not.toBe('');
  });

  it('una anotación resaltada nueva con texto se abre con doble clic', () => {
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    const h = { ...newAnnotation('suite-h1', 'highlight'), contents: 'Cifra' };
    useAnnotations.setState({ edits: { upserts: new Map([[h.id, h]]), removed: new Set(), fields: new Map() } });
    renderPage();

    fireEvent.doubleClick(zone('suite-h1'));

    expect(valueOf(screen.getByRole('textbox', { name: 'Comentario' }))).toBe('Cifra');
  });
});

describe('Ventana de comentario · respuestas y estados (PDF-109)', () => {
  /** Abre la ventana de una nota con texto, con el autor «Ana». */
  function openNote(): void {
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    useAnnotations.setState({ author: 'Ana' });
    addAnnotation({ ...newAnnotation('suite-nota', 'note'), contents: 'Revisar la cifra' });
    openPopup('suite-nota');
    renderPage();
  }

  function replyField(): HTMLTextAreaElement {
    return screen.getByRole('textbox', { name: 'Escribe una respuesta' }) as HTMLTextAreaElement;
  }

  it('escribir y pulsar «Responder» añade la respuesta a la lista y vacía el campo, que conserva el foco', () => {
    openNote();

    fireEvent.change(replyField(), { target: { value: 'De acuerdo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));

    const list = screen.getByRole('list', { name: 'Respuestas' });
    expect(within(list).getByText('De acuerdo')).toBeTruthy();
    expect(within(list).getByText('Ana')).toBeTruthy();
    expect(valueOf(replyField())).toBe('');
    expect(document.activeElement).toBe(replyField());
    expect(screen.getByText('1 respuesta')).toBeTruthy();
  });

  it('con el campo en blanco, «Responder» está desactivado y no añade nada', () => {
    openNote();

    expect((screen.getByRole('button', { name: 'Responder' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('list', { name: 'Respuestas' })).toBeNull();
  });

  it('Ctrl+Intro en el campo responde; Intro sola inserta un salto de línea y no responde', () => {
    openNote();

    fireEvent.change(replyField(), { target: { value: 'Con atajo' } });
    fireEvent.keyDown(replyField(), { key: 'Enter' });
    expect(screen.queryByRole('list', { name: 'Respuestas' })).toBeNull();

    fireEvent.keyDown(replyField(), { key: 'Enter', ctrlKey: true });
    expect(within(screen.getByRole('list', { name: 'Respuestas' })).getByText('Con atajo')).toBeTruthy();
  });

  it('Escape en el campo de respuesta cierra la ventana, como en el comentario', () => {
    openNote();

    fireEvent.keyDown(replyField(), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAnnotations.getState().openPopupId).toBeNull();
  });

  it('editar una respuesta con teclado: Intro confirma, Escape cancela', () => {
    openNote();
    fireEvent.change(replyField(), { target: { value: 'Primera' } });
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));

    fireEvent.click(screen.getByRole('button', { name: 'Editar respuesta' }));
    const editor = screen.getByRole('textbox', { name: 'Editar respuesta' });
    fireEvent.change(editor, { target: { value: 'Editada' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.getByText('Primera')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Editar respuesta' }));

    fireEvent.click(screen.getByRole('button', { name: 'Editar respuesta' }));
    const again = screen.getByRole('textbox', { name: 'Editar respuesta' });
    fireEvent.change(again, { target: { value: 'Editada' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(screen.getByText('Editada')).toBeTruthy();
    expect(screen.queryByText('Primera')).toBeNull();
  });

  it('borrar una respuesta la quita de la lista', () => {
    openNote();
    fireEvent.change(replyField(), { target: { value: 'Sobra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));

    fireEvent.click(screen.getByRole('button', { name: 'Borrar respuesta' }));

    expect(screen.queryByRole('list', { name: 'Respuestas' })).toBeNull();
    expect(screen.queryByText('Sobra')).toBeNull();
  });

  it('el menú «Estado» fija el estado vigente, que se muestra en la cabecera', () => {
    openNote();
    expect(screen.queryByText('Estado: Aceptado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Estado' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Aceptado' }));

    expect(getEffective().size).toBe(2);
    expect(screen.getByText('Estado: Aceptado')).toBeTruthy();
    expect(screen.getByText('Estado: Aceptado').getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Estado' }));
    expect(screen.getByRole('menuitemradio', { name: 'Aceptado' }).getAttribute('aria-checked')).toBe('true');
  });
});
