// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LineShapeAnnotation, BoxShapeAnnotation } from '../../src/core/annotations/model';
import { DEFAULT_INK_WIDTH, DEFAULT_TOOL_COLORS, PALETTE } from '../../src/core/annotations/palette';
import { PageDimsTable } from '../../src/core/page-dims';
import type { PageViewport } from '../../src/engine/pdfjs';
import { App } from '../../src/ui/App';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import {
  addAnnotation,
  endAnnotationSession,
  getEffective,
  setTool,
} from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { createBox, setShapeWidth } from '../../src/state/shape-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { newAnnotation } from '../unit/annotations/factories';

/** Página de 792 pt de alto a escala 2 y rotación 0 (como en `ink.test.tsx`). */
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

function layerSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (svg === null) throw new Error('sin capa SVG');
  return svg;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('formas.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(3, 612, PAGE_HEIGHT, 0),
    dimsVersion: 1,
    currentPage: 0,
  });
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState(initialViewerState);
});

function shapesOf(type: 'square' | 'circle' | 'line'): (BoxShapeAnnotation | LineShapeAnnotation)[] {
  return [...getEffective().values()].filter((a): a is BoxShapeAnnotation | LineShapeAnnotation => a.type === type);
}

describe('herramientas de forma · arrastre en la capa (PDF-108)', () => {
  it('con «Rectángulo», arrastrar crea un rectángulo con el color y el grosor de la herramienta, seleccionado', () => {
    setTool('square');
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 180, pointerId: 1 });

    const [box] = shapesOf('square');
    expect(box).toBeDefined();
    expect(box?.color).toEqual(DEFAULT_TOOL_COLORS.square);
    expect(box?.width).toBe(DEFAULT_INK_WIDTH);
    // Px (100,100)→(200,180) = pt (50,742)→(100,702): caja [50, 702, 100, 742].
    expect(box?.rect).toEqual([50, 702, 100, 742]);
    expect(useAnnotations.getState().selectedId).toBe(box?.id);
    expect(useAnnotations.getState().tool).toBe('square');
  });

  it('mientras se arrastra se ve la vista previa punteada de la forma', () => {
    setTool('circle');
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 180, pointerId: 1 });
    // La vista previa lleva la clase de trazo punteado; la elipse creada no.
    expect(container.querySelector('ellipse[class]')).not.toBeNull();
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 180, pointerId: 1 });
    expect(container.querySelector('ellipse[class]')).toBeNull();
    expect(container.querySelector('ellipse')).not.toBeNull();
  });

  it('Escape durante el arrastre no crea nada', () => {
    setTool('square');
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 180, pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 180, pointerId: 1 });
    expect(shapesOf('square')).toHaveLength(0);
    expect(container.querySelector('rect')).toBeNull();
  });

  it('un arrastre que empieza sobre otra anotación no crea forma', () => {
    setTool('square');
    addAnnotation(newAnnotation('suite-nota', 'note', 0));
    const { container } = renderLayer();
    const zone = container.querySelector<SVGGElement>('[data-annot-id="suite-nota"]');
    if (zone === null) throw new Error('falta la zona de la nota');
    const svg = layerSvg(container);
    fireEvent.pointerDown(zone, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 180, pointerId: 1 });
    expect(shapesOf('square')).toHaveLength(0);
    expect(getEffective().size).toBe(1);
  });

  it('con «Flecha», arrastrar crea una flecha con punta final, de color de flecha', () => {
    setTool('arrow');
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 100, pointerId: 1 });
    const [arrow] = shapesOf('line');
    expect(arrow?.type === 'line' && arrow.endings).toEqual(['None', 'OpenArrow']);
    expect(arrow?.color).toEqual(DEFAULT_TOOL_COLORS.arrow);
    expect(arrow?.type === 'line' && arrow.points).toEqual([50, 742, 150, 742]);
  });

  it('una forma seleccionada se mueve con las flechas del teclado desde su zona', () => {
    const id = createBox(0, 'square', [100, 100, 200, 150]);
    const { container } = renderLayer();
    const zone = container.querySelector<SVGGElement>(`[data-annot-id="${id}"]`);
    if (zone === null) throw new Error('falta la zona del rectángulo');
    expect(zone).toHaveAttribute('role', 'button');
    fireEvent.keyDown(zone, { key: 'ArrowRight' });
    expect(getEffective().get(id)?.rect).toEqual([101, 100, 201, 150]);
  });

  it('el tirador de una elipse seleccionada cambia su tamaño en un solo paso de deshacer', () => {
    const id = createBox(0, 'circle', [100, 100, 200, 150]);
    const { container } = renderLayer();
    const handle = container.querySelector<SVGRectElement>(`[data-resize-id="${id}"]`);
    if (handle === null) throw new Error('falta el tirador');
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 240, clientY: 190, pointerId: 1 });
    const resized = getEffective().get(id);
    expect(resized?.rect).toEqual([100, 100 - 20, 200 + 20, 150]);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar tamaño');
  });

  it('cambiar el grosor con un rectángulo seleccionado lo aplica sin mover su caja', () => {
    const id = createBox(0, 'square', [10, 10, 50, 50]);
    setShapeWidth(8);
    const a = getEffective().get(id);
    expect(a?.type === 'square' && a.width).toBe(8);
    expect(a?.rect).toEqual([10, 10, 50, 50]);
  });
});

describe('barra «Comentar» · formas (PDF-108)', () => {
  it('Intro sobre «Flecha» con la herramienta inactiva crea una flecha en la página actual, seleccionada', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Comentar' }));
    const toolbar = await screen.findByRole('toolbar', { name: 'Comentar' });
    const flecha = within(toolbar).getByRole('button', { name: 'Flecha' });
    flecha.focus();
    await user.keyboard('{Enter}');

    const [arrow] = shapesOf('line');
    expect(arrow?.pageIndex).toBe(0);
    expect(arrow?.type === 'line' && arrow.endings).toEqual(['None', 'OpenArrow']);
    expect(useAnnotations.getState().selectedId).toBe(arrow?.id);
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('«Color» con una forma seleccionada cambia la forma, no la herramienta; «Grosor» fija el grosor de formas', async () => {
    const user = userEvent.setup();
    const id = createBox(0, 'square', [10, 10, 60, 60]);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Comentar' }));
    const toolbar = await screen.findByRole('toolbar', { name: 'Comentar' });

    await user.click(within(toolbar).getByRole('button', { name: 'Color' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Azul' }));
    expect(getEffective().get(id)?.color).toEqual(PALETTE.find((e) => e.id === 'blue')?.rgb);
    expect(useAnnotations.getState().colors.square).toEqual(DEFAULT_TOOL_COLORS.square);

    await user.click(within(toolbar).getByRole('button', { name: 'Grosor' }));
    await user.click(screen.getByRole('menuitemradio', { name: '8 pt' }));
    expect(useAnnotations.getState().shapeWidth).toBe(8);
    const a = getEffective().get(id);
    expect(a?.type === 'square' && a.width).toBe(8);
  });

  it('los cuatro botones de forma tienen nombre accesible y título', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Comentar' }));
    const toolbar = await screen.findByRole('toolbar', { name: 'Comentar' });
    for (const name of ['Rectángulo', 'Elipse', 'Línea', 'Flecha']) {
      const button = within(toolbar).getByRole('button', { name });
      expect(button).toHaveAttribute('title', name);
    }
  });
});
