// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import type { PageViewport } from '../../src/engine/pdfjs';
import { newAnnotation, fileAnnotation, T0 } from '../unit/annotations/factories';
import { newBoxShape, newLineShape, newPolygonShape, newStamp } from '../../src/core/annotations/shapes';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import {
  addAnnotation,
  endAnnotationSession,
  getEffective,
  redo,
  startAnnotationSession,
  undo,
  updateAnnotation,
} from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

const setFileAnnotationHidden = vi.fn();
vi.mock('../../src/engine/annotation-visibility', () => ({
  setFileAnnotationHidden: (...args: unknown[]) => setFileAnnotationHidden(...args),
}));

/** Página de 792 pt de alto a escala 2 y rotación 0: y_px = (792 - y_pt) × 2 + 0 (la matriz viene de pdf.js). */
const PAGE_HEIGHT = 792;
const SCALE = 2;

/** Viewport simulado que cumple la matriz de pdf.js para escala 2 y rotación 0. */
function fakeViewport(): PageViewport {
  return {
    width: 612 * SCALE,
    height: PAGE_HEIGHT * SCALE,
    transform: [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE],
    convertToPdfPoint: (x: number, y: number) => [x / SCALE, PAGE_HEIGHT - y / SCALE],
  } as unknown as PageViewport;
}

function renderLayer(viewport: PageViewport = fakeViewport()) {
  return render(<AnnotationLayer pageIndex={0} viewport={viewport} />);
}

/** Zona activa de la anotación con este id. */
function zone(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-annot-id="${id}"]`);
  if (el === null) throw new Error(`sin zona para ${id}`);
  return el;
}

/** Documento simulado de 25 000 páginas: la sesión no importa nada (modo perezoso). */
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
    file: openedFile('annotated.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
  setFileAnnotationHidden.mockClear();
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('AnnotationLayer · dibujo y zonas activas', () => {
  it('una nota nueva usa la matriz de la página y su zona tiene el nombre accesible correcto', () => {
    addAnnotation({ ...newAnnotation('suite-n1', 'note'), rect: [100, 700, 120, 720], author: 'Ana', contents: 'Revisar' });
    renderLayer();

    const group = document.querySelector('svg > g');
    expect(group?.getAttribute('transform')).toBe('matrix(2 0 0 -2 0 1584)');
    const el = screen.getByRole('button', { name: 'Nota de Ana: Revisar' });
    expect(el).toBe(zone('suite-n1'));
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('el nombre accesible recorta el comentario a 80 caracteres y omite los dos puntos si está vacío', () => {
    addAnnotation({ ...newAnnotation('suite-long', 'freetext'), contents: 'x'.repeat(200) });
    addAnnotation({ ...newAnnotation('suite-empty', 'highlight'), author: '' });
    renderLayer();

    expect(zone('suite-long').getAttribute('aria-label')).toBe(`Texto de Ana: ${'x'.repeat(80)}`);
    expect(zone('suite-empty').getAttribute('aria-label')).toBe('Resaltado');
  });

  it('las anotaciones del fichero sin tocar no dibujan nada, pero sí tienen zona activa', () => {
    useAnnotations.setState({ baseline: new Map([['ref:5R', fileAnnotation(5, 'highlight')]]) });
    renderLayer();

    expect(zone('ref:5R')).toBeTruthy();
    expect(document.querySelector('[data-annot-id="ref:5R"]')?.previousElementSibling).toBeNull();
  });

  it('las anotaciones ajenas (no soportadas) no tienen zona activa', () => {
    useAnnotations.setState({
      foreign: new Map([
        ['ref:9R', { id: 'ref:9R', pageIndex: 0, subtype: 'Square', rect: [0, 0, 10, 10], contents: '', author: '', modified: null }],
      ]),
    });
    renderLayer();

    expect(document.querySelector('[data-annot-id="ref:9R"]')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('AnnotationLayer · selección, borrado y deshacer', () => {
  it('clic en la zona la selecciona; un clic en zona vacía no hace nada aquí (lo gestiona el visor)', async () => {
    addAnnotation(newAnnotation('suite-h1', 'highlight'));
    renderLayer();

    fireEvent.pointerDown(zone('suite-h1'), { button: 0, clientX: 0, clientY: 0 });
    expect(useAnnotations.getState().selectedId).toBe('suite-h1');
    expect(zone('suite-h1').querySelector('rect')?.getAttribute('class')).toMatch(/outlineOn/);
  });

  it('Supr borra la seleccionada, mueve el foco y undo la recupera', () => {
    addAnnotation(newAnnotation('suite-h1', 'highlight'));
    addAnnotation(newAnnotation('suite-h2', 'highlight'));
    renderLayer();

    fireEvent.pointerDown(zone('suite-h1'), { button: 0, clientX: 0, clientY: 0 });
    zone('suite-h1').focus();
    fireEvent.keyDown(zone('suite-h1'), { key: 'Delete' });

    expect(getEffective().has('suite-h1')).toBe(false);
    expect(document.activeElement).toBe(zone('suite-h2'));
    expect(useAnnotations.getState().selectedId).toBeNull();

    undo();
    expect(getEffective().has('suite-h1')).toBe(true);
  });

  it('Supr borra la zona enfocada aunque no esté seleccionada (llegada con Tab)', () => {
    addAnnotation(newAnnotation('suite-h1', 'highlight'));
    addAnnotation(newAnnotation('suite-h2', 'highlight'));
    renderLayer();

    zone('suite-h2').focus();
    expect(useAnnotations.getState().selectedId).toBeNull();
    fireEvent.keyDown(zone('suite-h2'), { key: 'Delete' });

    expect(getEffective().has('suite-h2')).toBe(false);
    expect(document.activeElement).toBe(zone('suite-h1'));
  });

  it('con una nota seleccionada, las flechas la mueven 1 pt (10 con Mayús) y varias pulsaciones son una sola entrada', () => {
    addAnnotation({ ...newAnnotation('suite-n1', 'note'), rect: [100, 700, 120, 720] });
    renderLayer();
    fireEvent.pointerDown(zone('suite-n1'), { button: 0, clientX: 0, clientY: 0 });
    zone('suite-n1').focus();

    fireEvent.keyDown(zone('suite-n1'), { key: 'ArrowRight' });
    fireEvent.keyDown(zone('suite-n1'), { key: 'ArrowRight' });
    fireEvent.keyDown(zone('suite-n1'), { key: 'ArrowRight', shiftKey: true });

    const moved = getEffective().get('suite-n1');
    expect(moved?.rect).toEqual([112, 700, 132, 720]);
    expect(useAnnotations.getState().undo.undoDepth).toBe(2);

    undo();
    expect(getEffective().get('suite-n1')?.rect).toEqual([100, 700, 120, 720]);
    redo();
    expect(getEffective().get('suite-n1')?.rect).toEqual([112, 700, 132, 720]);
  });

  it('un arrastre con el ratón mueve la nota según la escala (50 px a escala 2 = 25 pt) y deja una sola entrada', () => {
    addAnnotation({ ...newAnnotation('suite-n1', 'note'), rect: [100, 700, 120, 720] });
    renderLayer();
    fireEvent.pointerDown(zone('suite-n1'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10 });

    expect(getEffective().get('suite-n1')?.rect).toEqual([125, 700, 145, 720]);
    expect(useAnnotations.getState().undo.undoDepth).toBe(2);
  });

  it('un movimiento menor que el umbral de 3 px no mueve la anotación', () => {
    addAnnotation({ ...newAnnotation('suite-n1', 'note'), rect: [100, 700, 120, 720] });
    renderLayer();
    fireEvent.pointerDown(zone('suite-n1'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 12, clientY: 11 });
    fireEvent.pointerUp(window, { clientX: 12, clientY: 11 });

    expect(getEffective().get('suite-n1')?.rect).toEqual([100, 700, 120, 720]);
  });

  it('arrastrar o pulsar flechas sobre un resaltado no lo mueve', () => {
    addAnnotation(newAnnotation('suite-h1', 'highlight'));
    renderLayer();
    fireEvent.pointerDown(zone('suite-h1'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 60 });
    fireEvent.keyDown(zone('suite-h1'), { key: 'ArrowRight' });

    expect(getEffective().get('suite-h1')?.rect).toEqual([10, 20, 110, 40]);
    // Solo la adición previa está en la pila: el arrastre y la flecha no añaden nada.
    expect(useAnnotations.getState().undo.undoDepth).toBe(1);
  });

  it('con ninguna movible seleccionada, ↑/↓ mueven el foco entre las zonas de la página', () => {
    addAnnotation(newAnnotation('suite-h1', 'highlight'));
    addAnnotation(newAnnotation('suite-h2', 'underline'));
    renderLayer();
    zone('suite-h1').focus();

    fireEvent.keyDown(zone('suite-h1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(zone('suite-h2'));
    expect(zone('suite-h2').getAttribute('tabindex')).toBe('0');
    expect(zone('suite-h1').getAttribute('tabindex')).toBe('-1');
  });
});

describe('AnnotationLayer · ediciones del fichero', () => {
  it('editar una anotación del fichero la oculta en el lienzo; deshacer la vuelve a mostrar', () => {
    const original = fileAnnotation(5, 'highlight');
    startAnnotationSession(lazyLoaded(), new AbortController().signal);
    // La sesión reinicia el estado: la línea base se fija después de abrirla.
    useAnnotations.setState({ baseline: new Map([[original.id, original]]) });
    renderLayer();

    updateAnnotation({ ...original, color: [0, 1, 0] });
    expect(setFileAnnotationHidden).toHaveBeenLastCalledWith(expect.anything(), { num: 5, gen: 0 }, true);

    undo();
    expect(setFileAnnotationHidden).toHaveBeenLastCalledWith(expect.anything(), { num: 5, gen: 0 }, false);
  });
});

describe('AnnotationLayer · tipos y herramienta', () => {
  it('una nota editada del fichero se dibuja (la capa sustituye a pdf.js en esa anotación)', () => {
    const original = fileAnnotation(7, 'note');
    useAnnotations.setState({ baseline: new Map([[original.id, original]]) });
    updateAnnotation({ ...original, contents: 'cambiada' });
    renderLayer();

    expect(document.querySelector('[data-annot-id="ref:7R"]')?.previousElementSibling).not.toBeNull();
  });
});

describe('AnnotationLayer · formas y sellos (PDF-057)', () => {
  it('una forma nueva de cada tipo se dibuja y su zona tiene su nombre accesible', () => {
    const shape = { pageIndex: 0, color: [1, 0, 0] as const, author: 'Ana', now: T0 };
    addAnnotation({
      ...newBoxShape({ ...shape, id: 'suite-sq', kind: 'square', rect: [72, 600, 172, 650], width: 2 }),
      interior: [1, 1, 0],
    });
    addAnnotation(newBoxShape({ ...shape, id: 'suite-ci', kind: 'circle', rect: [200, 600, 300, 650], width: 2 }));
    addAnnotation(newLineShape({ ...shape, id: 'suite-ln', points: [72, 500, 200, 520], arrow: true, width: 2 }));
    addAnnotation(newLineShape({ ...shape, id: 'suite-pl', points: [72, 480, 200, 480], arrow: false, width: 2 }));
    addAnnotation(
      newPolygonShape({
        ...shape,
        id: 'suite-pg',
        vertices: [320, 600, 380, 610, 400, 650, 350, 670, 310, 640],
        width: 2,
      }),
    );
    addAnnotation(newStamp({ ...shape, id: 'suite-st', name: 'Draft', center: [300, 398] }));
    renderLayer();

    const shapeOf = (id: string): Element | null => zone(id).previousElementSibling;

    expect(shapeOf('suite-sq')?.tagName).toBe('rect');
    expect(shapeOf('suite-sq')?.getAttribute('fill')).toBe('rgb(255 255 0)');
    expect(shapeOf('suite-ci')?.tagName).toBe('ellipse');
    expect(shapeOf('suite-ln')?.querySelector('line')).not.toBeNull();
    expect(shapeOf('suite-ln')?.querySelector('polyline')).not.toBeNull();
    expect(shapeOf('suite-pl')?.querySelector('polyline')).toBeNull();
    expect(shapeOf('suite-pg')?.tagName).toBe('polygon');
    expect(shapeOf('suite-st')?.querySelector('text')?.textContent).toBe('BORRADOR');

    expect(zone('suite-sq').getAttribute('aria-label')).toBe('Rectángulo de Ana');
    expect(zone('suite-ci').getAttribute('aria-label')).toBe('Elipse de Ana');
    expect(zone('suite-ln').getAttribute('aria-label')).toBe('Flecha de Ana');
    expect(zone('suite-pl').getAttribute('aria-label')).toBe('Línea de Ana');
    expect(zone('suite-pg').getAttribute('aria-label')).toBe('Polígono de Ana');
    expect(zone('suite-st').getAttribute('aria-label')).toBe('Sello de Ana');
  });
});
