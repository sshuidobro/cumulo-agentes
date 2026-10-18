// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InkAnnotation } from '../../src/core/annotations/model';
import type { PageViewport } from '../../src/engine/pdfjs';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import {
  endAnnotationSession,
  getEffective,
  select,
  setInkColor,
  setInkWidth,
  setTool,
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

/** Lienzo SVG de la capa (el primer `svg` que pinta `AnnotationLayer`). */
function layerSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (svg === null) throw new Error('sin capa SVG');
  return svg;
}

type Point = readonly [number, number];

/**
 * Traza con eventos de puntero: bajada en el primer punto, movimientos en los intermedios y subida en el último.
 * `pointerId` identifica el puntero (ratón, lápiz o un dedo).
 */
function draw(svg: Element, points: readonly Point[], pointerId = 1, pointerType = 'mouse'): void {
  points.forEach(([clientX, clientY], i) => {
    const init = { button: 0, clientX, clientY, pointerId, pointerType };
    if (i === 0) fireEvent.pointerDown(svg, init);
    else if (i === points.length - 1) fireEvent.pointerUp(svg, init);
    else fireEvent.pointerMove(svg, init);
  });
}

/** Zigzag de `count` eventos entre x = 10 y x = 10 + 5 × (count − 1), en píxeles de pantalla. */
function zigzag(count: number): Point[] {
  return Array.from({ length: count }, (_, i): Point => [10 + i * 5, 100 + (i % 2) * 20]);
}

function inks(): InkAnnotation[] {
  return [...getEffective().values()].filter((a): a is InkAnnotation => a.type === 'ink');
}

beforeEach(() => {
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
    assetBaseUrl: '',
  });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('dibujo.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
  setFileAnnotationHidden.mockClear();
  setTool('ink');
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('AnnotationLayer · dibujo a mano alzada (PDF-035)', () => {
  it('un trazo de 50 eventos crea una anotación ink con el grosor de la herramienta y una caja que contiene todos los puntos', () => {
    setInkWidth(4);
    const { container } = renderLayer();
    const points = zigzag(50);

    draw(layerSvg(container), points);

    const created = inks();
    expect(created).toHaveLength(1);
    const [a] = created;
    if (a === undefined) throw new Error('sin anotación');
    expect(a.width).toBe(4);
    expect(a.opacity).toBe(1);
    expect(a.color).toEqual(useAnnotations.getState().colors.ink);
    // Pantalla → PDF: x / 2 e y = 792 − y / 2. La caja incluye la mitad del grosor más 1 pt (3 pt aquí).
    for (const [px, py] of points) {
      const x = px / SCALE;
      const y = PAGE_HEIGHT - py / SCALE;
      expect(x).toBeGreaterThanOrEqual(a.rect[0]);
      expect(x).toBeLessThanOrEqual(a.rect[2]);
      expect(y).toBeGreaterThanOrEqual(a.rect[1]);
      expect(y).toBeLessThanOrEqual(a.rect[3]);
    }
    // La simplificación conserva la forma: un zigzag no se reduce a una recta.
    expect(a.paths[0]?.length ?? 0).toBeGreaterThan(4);
  });

  it('pointercancel descarta el trazo: no se crea ninguna anotación', () => {
    const { container } = renderLayer();
    const svg = layerSvg(container);

    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(svg, { button: 0, clientX: 60, clientY: 80, pointerId: 1 });
    fireEvent.pointerCancel(svg, { button: 0, clientX: 60, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 60, clientY: 80, pointerId: 1 });

    expect(inks()).toHaveLength(0);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
  });

  it('dos trazos crean dos anotaciones y dos entradas de deshacer', () => {
    const { container } = renderLayer();
    const svg = layerSvg(container);

    draw(svg, zigzag(10));
    draw(svg, zigzag(12).map(([x, y]): Point => [x, y + 200]));

    expect(inks()).toHaveLength(2);
    expect(useAnnotations.getState().undo.undoDepth).toBe(2);
    expect(useAnnotations.getState().undo.undoLabel).toBe('añadir dibujo');

    undo();
    expect(inks()).toHaveLength(1);
    undo();
    expect(inks()).toHaveLength(0);
  });

  it('la herramienta sigue activa tras cada trazo', () => {
    const { container } = renderLayer();
    draw(layerSvg(container), zigzag(6));
    expect(useAnnotations.getState().tool).toBe('ink');
  });

  it('sin la herramienta «Dibujar» activa, el puntero no dibuja', () => {
    setTool('none');
    const { container } = renderLayer();
    draw(layerSvg(container), zigzag(10));
    expect(inks()).toHaveLength(0);
  });

  it('un clic sin arrastre no crea ningún dibujo', () => {
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
    expect(inks()).toHaveLength(0);
  });

  it('un segundo puntero durante el trazo se ignora: el trazo sigue el primero', () => {
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 400, clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 60, clientY: 60, pointerId: 2 });
    fireEvent.pointerUp(svg, { clientX: 60, clientY: 60, pointerId: 1 });

    const created = inks();
    expect(created).toHaveLength(1);
    const [a] = created;
    // Ningún punto del segundo puntero (400, 400 → x = 200, y = 596 en pt) ni su movimiento (60, 10) entra en el trazo.
    const xs = a?.paths.flatMap((p) => p.filter((_v, i) => i % 2 === 0)) ?? [];
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(30);
  });

  it('dos dedos: el segundo toque descarta el trazo en curso y no se dibuja', () => {
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 60, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerDown(svg, { button: 0, clientX: 200, clientY: 200, pointerId: 2, pointerType: 'touch' });
    fireEvent.pointerMove(svg, { clientX: 90, clientY: 90, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(svg, { clientX: 90, clientY: 90, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(svg, { clientX: 220, clientY: 220, pointerId: 2, pointerType: 'touch' });

    expect(inks()).toHaveLength(0);
  });

  it('un trazo que sale de la página se recorta a sus bordes (0..612 x 0..792 pt)', () => {
    const { container } = renderLayer();
    draw(layerSvg(container), [
      [100, 100],
      [-500, 300],
      [5000, 3000],
      [200, -900],
      [300, 400],
    ]);
    const [a] = inks();
    if (a === undefined) throw new Error('sin anotación');
    const all = a.paths.flat();
    expect(all.length).toBeGreaterThan(0);
    all.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(i % 2 === 0 ? 612 : 792);
    });
  });

  it('un dedo dibuja como el ratón', () => {
    const { container } = renderLayer();
    draw(layerSvg(container), zigzag(8), 3, 'touch');
    expect(inks()).toHaveLength(1);
  });

  it('mientras se traza, la vista previa es una polilínea que se actualiza por frame y desaparece al soltar', async () => {
    const { container } = renderLayer();
    const svg = layerSvg(container);
    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 40, pointerId: 1 });
    // La vista previa es el grupo sin eventos de puntero; el dibujo confirmado es otra polilínea, sin ese grupo.
    const preview = 'g[pointer-events="none"] polyline';
    await waitFor(() => {
      expect(container.querySelector(preview)).not.toBeNull();
    });
    fireEvent.pointerUp(svg, { clientX: 50, clientY: 40, pointerId: 1 });
    expect(container.querySelector(preview)).toBeNull();
    expect(inks()).toHaveLength(1);
  });

  it('cambiar el grosor y el color con un dibujo seleccionado los cambia y deja una entrada de deshacer por cambio', () => {
    const { container } = renderLayer();
    draw(layerSvg(container), zigzag(8));
    const [created] = inks();
    if (created === undefined) throw new Error('sin anotación');
    select(created.id);

    setInkWidth(8);
    const widened = inks()[0];
    if (widened === undefined) throw new Error('sin dibujo tras cambiar el grosor');
    expect(widened.width).toBe(8);
    // La caja crece con el grosor: la mitad del grosor más 1 pt a cada lado.
    expect(widened.rect[2] - widened.rect[0]).toBeGreaterThan(created.rect[2] - created.rect[0]);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar grosor');

    setInkColor([0.26, 0.65, 0.96]);
    expect(inks()[0]?.color).toEqual([0.26, 0.65, 0.96]);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar color');
    expect(useAnnotations.getState().colors.ink).toEqual([0.26, 0.65, 0.96]);
  });
});
