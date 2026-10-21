// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import type { FreeTextAnnotation } from '../../src/core/annotations/model';
import type { PageViewport } from '../../src/engine/pdfjs';
import { newAnnotation } from '../unit/annotations/factories';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import { AnnotationShape } from '../../src/ui/viewer/annotation-shapes';
import {
  addAnnotation,
  endAnnotationSession,
  getEffective,
  select,
  setFreeTextColor,
  setFreeTextFontSize,
  setTool,
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

/** Texto libre de prueba (`newAnnotation` devuelve la unión de tipos; aquí se estrecha a `freetext`). */
function freeText(id: string, extra: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation {
  const base = newAnnotation(id, 'freetext');
  if (base.type !== 'freetext') throw new Error('fábrica de prueba inconsistente');
  return { ...base, ...extra };
}

/** Página de 792 pt de alto a escala 2 y rotación 0 (la matriz viene de pdf.js). */
const PAGE_HEIGHT = 792;
const SCALE = 2;

function fakeViewport(): PageViewport {
  return {
    width: 612 * SCALE,
    height: PAGE_HEIGHT * SCALE,
    transform: [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE],
    convertToPdfPoint: (x: number, y: number) => [x / SCALE, PAGE_HEIGHT - y / SCALE],
  } as unknown as PageViewport;
}

function renderLayer() {
  return render(<AnnotationLayer pageIndex={0} viewport={fakeViewport()} />);
}

function zone(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-annot-id="${id}"]`);
  if (el === null) throw new Error(`sin zona para ${id}`);
  return el;
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Texto del cuadro' });
}

/** Con la herramienta «Texto», un clic en (x, y) píxeles de la página (sin arrastre). */
function clickWithTextTool(x: number, y: number): void {
  setTool('freetext');
  const layer = document.querySelector('svg');
  if (layer === null) throw new Error('sin capa');
  fireEvent.pointerDown(layer, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(window, { clientX: x, clientY: y });
}

function undoDepth(): number {
  return useAnnotations.getState().undo.undoDepth;
}

function lazyLoaded(): LoadedPdf {
  return { numPages: 25_000, doc: {} } as unknown as LoadedPdf;
}

beforeEach(() => {
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
    assetBaseUrl: '',
  });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('basic.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
  startAnnotationSession(lazyLoaded(), new AbortController().signal);
  setFileAnnotationHidden.mockClear();
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('texto libre · crear', () => {
  it('un clic con «Texto» abre el editor en el sitio sin crear anotación', () => {
    renderLayer();
    clickWithTextTool(200, 200);

    expect(editor()).toHaveFocus();
    expect(getEffective().size).toBe(0);
    expect(undoDepth()).toBe(0);
  });

  it('clic y Esc sin escribir: ninguna anotación ni entrada de deshacer', () => {
    renderLayer();
    clickWithTextTool(200, 200);
    fireEvent.keyDown(editor(), { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Texto del cuadro' })).toBeNull();
    expect(getEffective().size).toBe(0);
    expect(undoDepth()).toBe(0);
  });

  it('escribir «Hola» y perder el foco crea 1 texto libre con esa frase, el tamaño de la herramienta y 1 deshacer', async () => {
    const user = userEvent.setup();
    useAnnotations.setState({ fontSize: 18 });
    renderLayer();
    clickWithTextTool(200, 200);
    await user.type(editor(), 'Hola');
    fireEvent.blur(editor());

    const created = [...getEffective().values()];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: 'freetext', contents: 'Hola', fontSize: 18, origin: { kind: 'new' } });
    expect(undoDepth()).toBe(1);
    expect(useAnnotations.getState().undo.undoLabel).toBe('añadir texto');
    expect(useAnnotations.getState().selectedId).toBe(created[0]?.id);
  });

  it('un clic creado en la página tiene 200 pt de ancho con la esquina superior izquierda en el punto', async () => {
    const user = userEvent.setup();
    renderLayer();
    clickWithTextTool(200, 200);
    await user.type(editor(), 'x');
    fireEvent.blur(editor());

    const [created] = [...getEffective().values()];
    // El punto (200, 200) px son (100, 692) pt; la caja mide 200 pt de ancho y 1,15 × 12 + 4 de alto.
    expect(created?.rect[0]).toBe(100);
    expect(created?.rect[2]).toBe(300);
    expect(created?.rect[3]).toBe(692);
    expect((created?.rect[3] ?? 0) - (created?.rect[1] ?? 0)).toBeCloseTo(17.8, 10);
  });
});

describe('texto libre · editar y borrar', () => {
  it('doble clic sobre un texto existente abre el editor con su texto', () => {
    addAnnotation({ ...newAnnotation('suite-t1', 'freetext'), contents: 'Hola' });
    renderLayer();
    fireEvent.doubleClick(zone('suite-t1'));

    expect(editor()).toHaveValue('Hola');
    expect(editor()).toHaveFocus();
  });

  it('editar un texto existente y perder el foco lo cambia con la etiqueta «editar texto»', async () => {
    const user = userEvent.setup();
    addAnnotation({ ...newAnnotation('suite-t1', 'freetext'), contents: 'Hola' });
    renderLayer();
    fireEvent.doubleClick(zone('suite-t1'));
    await user.type(editor(), ' mundo');
    fireEvent.blur(editor());

    expect(getEffective().get('suite-t1')).toMatchObject({ contents: 'Hola mundo' });
    expect(useAnnotations.getState().undo.undoLabel).toBe('editar texto');
  });

  it('editar un texto existente dejándolo vacío lo borra, y Ctrl+Z lo recupera con su texto', async () => {
    const user = userEvent.setup();
    addAnnotation({ ...newAnnotation('suite-t1', 'freetext'), contents: 'Hola' });
    renderLayer();
    fireEvent.doubleClick(zone('suite-t1'));
    await user.clear(editor());
    fireEvent.blur(editor());

    expect(getEffective().has('suite-t1')).toBe(false);
    undo();
    expect(getEffective().get('suite-t1')).toMatchObject({ contents: 'Hola' });
  });

  it('Intro sobre un texto libre seleccionado abre el editor (no la ventana de comentario)', () => {
    addAnnotation({ ...newAnnotation('suite-t1', 'freetext'), contents: 'Hola' });
    renderLayer();
    act(() => {
      select('suite-t1');
    });
    zone('suite-t1').focus();
    fireEvent.keyDown(zone('suite-t1'), { key: 'Enter' });

    expect(editor()).toHaveValue('Hola');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mientras se edita, el texto del fichero o el dibujado no se pinta debajo del editor', () => {
    addAnnotation({ ...newAnnotation('suite-t1', 'freetext'), contents: 'Hola' });
    renderLayer();
    expect(document.querySelector('[data-annot-id="suite-t1"]')?.previousElementSibling).toBeTruthy();
    fireEvent.doubleClick(zone('suite-t1'));

    expect(document.querySelectorAll('text')).toHaveLength(0);
  });
});

describe('texto libre · tamaño por teclado y tirador', () => {
  it('Mayús+→ tres veces amplía el texto 3 pt en una sola entrada de deshacer', () => {
    addAnnotation({ ...newAnnotation('suite-t2', 'freetext'), rect: [100, 600, 300, 620] });
    renderLayer();
    act(() => {
      select('suite-t2');
    });
    zone('suite-t2').focus();
    const before = undoDepth();

    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(zone('suite-t2'), { key: 'ArrowRight', shiftKey: true });
    }

    expect(getEffective().get('suite-t2')?.rect).toEqual([100, 600, 303, 620]);
    expect(undoDepth()).toBe(before + 1);
  });

  it('Mayús+↓ hace el cuadro más alto 1 pt, sin mover el punto de anclaje', () => {
    addAnnotation({ ...newAnnotation('suite-t2', 'freetext'), rect: [100, 600, 300, 620] });
    renderLayer();
    act(() => {
      select('suite-t2');
    });
    fireEvent.keyDown(zone('suite-t2'), { key: 'ArrowDown', shiftKey: true });

    expect(getEffective().get('suite-t2')?.rect).toEqual([100, 599, 300, 620]);
  });

  it('el tirador de la esquina inferior derecha cambia el ancho arrastrando, en una entrada', () => {
    addAnnotation({ ...newAnnotation('suite-t2', 'freetext'), rect: [100, 600, 300, 620] });
    renderLayer();
    act(() => {
      select('suite-t2');
    });
    const handle = screen.getByRole('button', { name: 'Cambiar tamaño' });
    const before = undoDepth();

    // A escala 2, 20 px son 10 pt.
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 20, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 20, clientY: 0 });

    expect(getEffective().get('suite-t2')?.rect).toEqual([100, 600, 310, 620]);
    expect(undoDepth()).toBe(before + 1);
  });

  it('no hay tirador sin texto libre seleccionado', () => {
    addAnnotation({ ...newAnnotation('suite-t2', 'freetext'), rect: [100, 600, 300, 620] });
    renderLayer();

    expect(screen.queryByRole('button', { name: 'Cambiar tamaño' })).toBeNull();
  });
});

describe('texto libre · tamaño y color de la barra', () => {
  it('cambiar el tamaño con un texto libre seleccionado lo cambia y deja una entrada', () => {
    addAnnotation(freeText('suite-t3', { fontSize: 12 }));
    select('suite-t3');
    setFreeTextFontSize(18);

    expect(getEffective().get('suite-t3')).toMatchObject({ fontSize: 18 });
    expect(useAnnotations.getState().fontSize).toBe(18);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar tamaño de letra');
  });

  it('cambiar el color cambia el color del texto y no el del borde', () => {
    addAnnotation(freeText('suite-t3', { color: [1, 0, 0], textColor: [0, 0, 0] }));
    select('suite-t3');
    setFreeTextColor([0, 0, 1]);

    expect(getEffective().get('suite-t3')).toMatchObject({ textColor: [0, 0, 1], color: [1, 0, 0] });
  });
});

describe('texto libre · borde (PDF-149)', () => {
  const text = (over: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation => ({
    ...(newAnnotation('suite-ft', 'freetext') as FreeTextAnnotation),
    rect: [50, 50, 250, 120],
    contents: 'Hola',
    color: [1, 0, 0],
    ...over,
  });

  it('sin borderless se dibuja el rectángulo del borde', () => {
    const { container } = render(<svg><AnnotationShape a={text()} /></svg>);
    expect(container.querySelectorAll('rect[stroke]')).toHaveLength(1);
  });

  it('con borderless: true no hay ningún rectángulo con trazo, pero sí el texto', () => {
    const { container } = render(<svg><AnnotationShape a={text({ borderless: true })} /></svg>);
    expect(container.querySelectorAll('rect[stroke]')).toHaveLength(0);
    expect(container.textContent).toContain('Hola');
  });
});
