import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { createFakePlatform, openedFile } from '../../helpers/fake-platform';
import type { LoadedPdf } from '../../../src/engine';
import type { BoxShapeAnnotation, LineShapeAnnotation, RectPt } from '../../../src/core/annotations/model';
import { stampColor } from '../../../src/core/annotations/shapes';
import { DEFAULT_TOOL_COLORS, DEFAULT_INK_WIDTH } from '../../../src/core/annotations/palette';
import { PageDimsTable } from '../../../src/core/page-dims';
import {
  endAnnotationSession,
  getEffective,
  setTool,
  startAnnotationSession,
  undo,
} from '../../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../../src/state/annotation-store';
import {
  addShapeFromKeyboard,
  chooseStamp,
  createBox,
  createLine,
  createPolygon,
  isShapeTool,
  placeStamp,
  resizeShape,
  selectedShape,
  setShapeColor,
  setShapeWidth,
} from '../../../src/state/shape-actions';
import { initServices } from '../../../src/state/services';
import { initialViewerState, useViewer } from '../../../src/state/viewer-store';

const RED = [0.9, 0.22, 0.21] as const;
const BLUE = [0.26, 0.65, 0.96] as const;
const PAGE_W = 612;
const PAGE_H = 792;

let platform: Platform;

function setup(prefs: Record<string, unknown> = {}): void {
  platform = createFakePlatform({ prefs: createStorageStore(null, 'shapes.') });
  for (const [k, v] of Object.entries(prefs)) platform.prefs.set(k, v);
  initServices({ platform, assetBaseUrl: '' });
}

/** Documento de 25 000 páginas: la sesión queda en modo «lazy» y no lee páginas. */
function fakeLazyDoc(): LoadedPdf {
  return { numPages: 25_000, doc: { numPages: 25_000, getPage: vi.fn() } } as unknown as LoadedPdf;
}

function shapes(): (BoxShapeAnnotation | LineShapeAnnotation)[] {
  return [...getEffective().values()].filter(
    (a): a is BoxShapeAnnotation | LineShapeAnnotation => a.type === 'square' || a.type === 'circle' || a.type === 'line',
  );
}

beforeEach(() => {
  setup();
  endAnnotationSession();
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('formas.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(3, PAGE_W, PAGE_H, 0),
    dimsVersion: 1,
    currentPage: 0,
    currentYFraction: 0,
    rotation: 0,
  });
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('herramientas de forma (PDF-108)', () => {
  it('isShapeTool distingue las cuatro formas del resto', () => {
    expect(isShapeTool('square')).toBe(true);
    expect(isShapeTool('arrow')).toBe(true);
    expect(isShapeTool('ink')).toBe(false);
    expect(isShapeTool('none')).toBe(false);
  });

  it('createBox: rectángulo con el color de su herramienta y el grosor de formas, seleccionado; la herramienta sigue activa', () => {
    setTool('square');
    const id = createBox(0, 'square', [10, 20, 110, 80]);
    const a = getEffective().get(id);
    expect(a?.type).toBe('square');
    expect(a?.color).toEqual(DEFAULT_TOOL_COLORS.square);
    expect(a?.pageIndex).toBe(0);
    expect(a?.rect).toEqual([10, 20, 110, 80]);
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(useAnnotations.getState().tool).toBe('square');
  });

  it('createLine: una flecha usa el color de «Flecha» y punta final; una línea, el de «Línea» y sin puntas', () => {
    const arrowId = createLine(1, [10, 10, 100, 60], true);
    const lineId = createLine(1, [10, 100, 100, 150], false);
    const arrow = getEffective().get(arrowId);
    const line = getEffective().get(lineId);
    expect(arrow?.type === 'line' && arrow.endings).toEqual(['None', 'OpenArrow']);
    expect(line?.type === 'line' && line.endings).toEqual(['None', 'None']);
    expect(arrow?.color).toEqual(DEFAULT_TOOL_COLORS.arrow);
    expect(line?.color).toEqual(DEFAULT_TOOL_COLORS.line);
    expect(useAnnotations.getState().shapeWidth).toBe(DEFAULT_INK_WIDTH);
  });

  it('setShapeWidth(8) con una flecha seleccionada: una sola entrada de deshacer y la caja contiene las puntas', () => {
    const id = createLine(0, [100, 100, 300, 200], true);
    const before = getEffective().get(id);
    expect(before?.type === 'line' && before.width).toBe(DEFAULT_INK_WIDTH);
    setShapeWidth(8);

    const after = getEffective().get(id);
    if (after?.type !== 'line') throw new Error('la flecha debía seguir existiendo');
    expect(after.width).toBe(8);
    // Las puntas sobresalen del segmento: la caja tiene que contener el extremo final y su punta.
    expect(after.rect[2]).toBeGreaterThan(300);
    expect(after.rect[0]).toBeLessThanOrEqual(100);
    expect(after.rect[1]).toBeLessThanOrEqual(100);

    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar grosor');
    undo();
    const restored = getEffective().get(id);
    expect(restored?.type === 'line' && restored.width).toBe(DEFAULT_INK_WIDTH);
    // Deshacer solo revierte el grosor: la flecha sigue existiendo y el grosor se puede rehacer.
    expect(useAnnotations.getState().undo.canRedo).toBe(true);
    expect(getEffective().has(id)).toBe(true);
  });

  it('setShapeWidth sin forma seleccionada solo fija el grosor de las nuevas y lo guarda', () => {
    setShapeWidth(4);
    expect(useAnnotations.getState().shapeWidth).toBe(4);
    expect(platform.prefs.get('shapeWidth', (v): v is number => typeof v === 'number')).toBe(4);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
  });

  it('setShapeWidth con un rectángulo seleccionado cambia el grosor y deja la caja', () => {
    const id = createBox(0, 'circle', [50, 50, 150, 120]);
    setShapeWidth(1);
    const a = getEffective().get(id);
    expect(a?.type === 'circle' && a.width).toBe(1);
    expect(a?.rect).toEqual([50, 50, 150, 120]);
  });

  it('setShapeColor cambia el color de la forma seleccionada en una entrada «cambiar color», sin tocar la herramienta', () => {
    const id = createLine(0, [0, 0, 100, 0], false);
    setShapeColor(BLUE);
    expect(getEffective().get(id)?.color).toEqual(BLUE);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar color');
    expect(useAnnotations.getState().colors.line).toEqual(DEFAULT_TOOL_COLORS.line);
  });

  it('setShapeColor sin forma seleccionada no hace nada', () => {
    setShapeColor(BLUE);
    expect(shapes()).toHaveLength(0);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
  });

  it('resizeShape cambia el cuadro de un rectángulo o una elipse; otras formas no', () => {
    const box = createBox(0, 'square', [10, 10, 60, 60]);
    resizeShape(box, [10, 10, 200, 150]);
    expect(getEffective().get(box)?.rect).toEqual([10, 10, 200, 150]);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar tamaño');

    const line = createLine(0, [0, 0, 50, 50], false);
    const before = getEffective().get(line);
    resizeShape(line, [0, 0, 500, 500]);
    expect(getEffective().get(line)).toBe(before);
  });

  it('selectedShape devuelve la forma seleccionada y undefined sin ella', () => {
    expect(selectedShape()).toBeUndefined();
    const id = createBox(0, 'square', [0, 0, 40, 40]);
    expect(selectedShape()?.id).toBe(id);
  });

  it('addShapeFromKeyboard: forma por defecto centrada en un tercio de la página, seleccionada; devuelve la herramienta a «ninguna»', () => {
    setTool('square');
    const id = addShapeFromKeyboard('square');
    expect(id).not.toBeNull();
    const a = getEffective().get(id ?? '');
    // Centro: horizontal en la mitad y a un tercio del borde superior (visibleFraction 1, yFraction 0).
    const cx = PAGE_W / 2;
    const cy = PAGE_H - PAGE_H / 3;
    expect(a?.type).toBe('square');
    expect(a?.rect).toEqual([cx - 72, cy - 48, cx + 72, cy + 48]);
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('addShapeFromKeyboard: una flecha horizontal de 144 pt centrada', () => {
    const id = addShapeFromKeyboard('arrow');
    const a = getEffective().get(id ?? '');
    const cx = PAGE_W / 2;
    const cy = PAGE_H - PAGE_H / 3;
    expect(a?.type === 'line' && a.points).toEqual([cx - 72, cy, cx + 72, cy]);
    expect(a?.type === 'line' && a.endings).toEqual(['None', 'OpenArrow']);
  });

  it('addShapeFromKeyboard sin documento devuelve null', () => {
    useViewer.setState({ dims: null });
    expect(addShapeFromKeyboard('circle')).toBeNull();
    expect(shapes()).toHaveLength(0);
  });
});

describe('preferencias de formas (PDF-108)', () => {
  it('una preferencia antigua sin colores de formas conserva sus colores y las formas toman rojo', () => {
    const old = {
      highlight: [0.1, 0.2, 0.3],
      underline: BLUE,
      strikeout: RED,
      note: [1, 0.92, 0.23],
      freetext: RED,
      ink: RED,
    };
    setup({ annotationColors: old });
    startAnnotationSession(fakeLazyDoc(), new AbortController().signal);
    const colors = useAnnotations.getState().colors;
    expect(colors.highlight).toEqual([0.1, 0.2, 0.3]);
    expect(colors.square).toEqual(RED);
    expect(colors.circle).toEqual(RED);
    expect(colors.line).toEqual(RED);
    expect(colors.arrow).toEqual(RED);
  });

  it('un color de forma guardado se respeta y el grosor de formas se carga', () => {
    setup({
      annotationColors: { ...DEFAULT_TOOL_COLORS, square: BLUE, highlight: RED, underline: BLUE, strikeout: RED, note: RED, freetext: RED, ink: RED },
      shapeWidth: 4,
    });
    startAnnotationSession(fakeLazyDoc(), new AbortController().signal);
    expect(useAnnotations.getState().colors.square).toEqual(BLUE);
    expect(useAnnotations.getState().shapeWidth).toBe(4);
  });

  it('un color de forma no válido invalida la preferencia de colores entera', () => {
    setup({ annotationColors: { ...DEFAULT_TOOL_COLORS, square: 'azul' } });
    startAnnotationSession(fakeLazyDoc(), new AbortController().signal);
    expect(useAnnotations.getState().colors.square).toEqual(RED);
    expect(useAnnotations.getState().colors.highlight).toEqual(DEFAULT_TOOL_COLORS.highlight);
  });
});

describe('polígono y sello (PDF-115)', () => {
  it('createPolygon: polígono con el color de «Polígono» y el grosor de formas, seleccionado; la herramienta sigue activa', () => {
    setTool('polygon');
    const id = createPolygon(0, [10, 10, 100, 10, 100, 80]);
    const a = getEffective().get(id);
    expect(a?.type).toBe('polygon');
    expect(a?.color).toEqual(DEFAULT_TOOL_COLORS.polygon);
    expect(a?.type === 'polygon' && a.vertices).toEqual([10, 10, 100, 10, 100, 80]);
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(useAnnotations.getState().tool).toBe('polygon');
    expect(useAnnotations.getState().undo.undoLabel).toBe('añadir polígono');
  });

  it('chooseStamp fija el sello pendiente, lo guarda como preferencia y activa «stamp»', () => {
    chooseStamp('Draft');
    expect(useAnnotations.getState().pendingStamp).toBe('Draft');
    expect(useAnnotations.getState().tool).toBe('stamp');
    expect(platform.prefs.get('pendingStamp', (v): v is string => v === 'Draft')).toBe('Draft');
  });

  it('el sello pendiente por defecto es «Approved» y la preferencia guardada se lee al arrancar', () => {
    expect(useAnnotations.getState().pendingStamp).toBe('Approved');
    setup({ pendingStamp: 'NotApproved' });
    endAnnotationSession();
    startAnnotationSession(fakeLazyDoc(), new AbortController().signal);
    expect(useAnnotations.getState().pendingStamp).toBe('NotApproved');
  });

  it('placeStamp coloca el sello pendiente centrado en el punto, seleccionado, y devuelve la herramienta a «ninguna»', () => {
    chooseStamp('Approved');
    const id = placeStamp(1, [300, 400], [0, 0, PAGE_W, PAGE_H]);
    const a = getEffective().get(id);
    expect(a?.type).toBe('stamp');
    expect(a?.type === 'stamp' && a.name).toBe('Approved');
    expect(a?.pageIndex).toBe(1);
    expect(a?.color).toEqual(stampColor('Approved'));
    const cx = a !== undefined ? (a.rect[0] + a.rect[2]) / 2 : NaN;
    const cy = a !== undefined ? (a.rect[1] + a.rect[3]) / 2 : NaN;
    expect(cx).toBeCloseTo(300, 6);
    expect(cy).toBeCloseTo(400, 6);
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('placeStamp desplaza el sello que sobresale de la página para que quede dentro', () => {
    chooseStamp('Confidential');
    const id = placeStamp(0, [2, 2], [0, 0, PAGE_W, PAGE_H]);
    const a = getEffective().get(id);
    expect(a?.rect[0]).toBeGreaterThanOrEqual(0);
    expect(a?.rect[1]).toBeGreaterThanOrEqual(0);
  });

  it('addShapeFromKeyboard con «polygon» crea el polígono por defecto en la página actual; con «stamp» coloca el sello', () => {
    setTool('polygon');
    const polyId = addShapeFromKeyboard('polygon');
    const poly = polyId === null ? undefined : getEffective().get(polyId);
    expect(poly?.type === 'polygon' && poly.vertices).toHaveLength(10);
    expect(poly?.pageIndex).toBe(0);
    expect(useAnnotations.getState().tool).toBe('none');

    chooseStamp('Final');
    const stampId = addShapeFromKeyboard('stamp');
    const stamp = stampId === null ? undefined : getEffective().get(stampId);
    expect(stamp?.type).toBe('stamp');
    expect(stamp?.pageIndex).toBe(0);
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('resizeShape acepta un sello: cambia su cuadro; sin cambio real no crea entrada de deshacer', () => {
    chooseStamp('Approved');
    const id = placeStamp(0, [300, 400], [0, 0, PAGE_W, PAGE_H]);
    const before = getEffective().get(id);
    if (before?.type !== 'stamp') throw new Error('sin sello');
    const depth = useAnnotations.getState().undo.undoDepth;
    resizeShape(id, before.rect);
    expect(useAnnotations.getState().undo.undoDepth).toBe(depth);
    const bigger: RectPt = [before.rect[0], before.rect[1], before.rect[2] + 40, before.rect[3] + 20];
    resizeShape(id, bigger);
    expect(getEffective().get(id)?.rect).toEqual(bigger);
    expect(useAnnotations.getState().undo.undoLabel).toBe('cambiar tamaño');
  });
});
