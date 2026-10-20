// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { createStorageStore, memorySource, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SignatureArt } from '../../src/core/annotations/model';
import type { PageViewport } from '../../src/engine/pdfjs';
import { AnnotationLayer } from '../../src/ui/viewer/AnnotationLayer';
import {
  chooseSignature,
  endAnnotationSession,
  getEffective,
  placeSignatureFromKeyboard,
  select,
  setTool,
  undo,
} from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

/** Página de 792 pt de alto a escala 2 y rotación 0 (mismo viewport simulado que la capa de notas). */
const PAGE_HEIGHT = 792;
const SCALE = 2;

/** Firma de trazos 300 × 100: 150 × 50 pt al colocarla. */
const INK_ART: SignatureArt = { kind: 'ink', paths: [[0, 0, 300, 100]], width: 2, box: [300, 100] };

function fakeViewport(): PageViewport {
  return {
    width: 612 * SCALE,
    height: PAGE_HEIGHT * SCALE,
    transform: [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE],
    convertToPdfPoint: (x: number, y: number) => [x / SCALE, PAGE_HEIGHT - y / SCALE],
  } as unknown as PageViewport;
}

/**
 * Replica el manejador de `Viewer` (`clearAnnotationSelection`, PDF-151): un clic fuera de una anotación la deselecciona.
 * Así el test ve el mismo recorrido del `pointerdown` que en la aplicación.
 */
function ViewerPointerRoot({ children }: { readonly children: React.ReactNode }) {
  const clear = (target: EventTarget | null): void => {
    if (target instanceof Element && target.closest('[data-annot-id]') !== null) return;
    if (useAnnotations.getState().selectedId !== null) select(null);
  };
  return <div onPointerDown={(e) => clear(e.target)}>{children}</div>;
}

function renderLayer() {
  return render(<AnnotationLayer pageIndex={0} viewport={fakeViewport()} />);
}

/** Capa dentro del manejador de deselección del visor, como en la aplicación (PDF-151). */
function renderInViewer() {
  return render(
    <ViewerPointerRoot>
      <AnnotationLayer pageIndex={0} viewport={fakeViewport()} />
    </ViewerPointerRoot>,
  );
}

function zone(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-annot-id="${id}"]`);
  if (el === null) throw new Error(`sin zona para ${id}`);
  return el;
}

function layerSvg(): HTMLElement {
  const el = document.querySelector<HTMLElement>('svg');
  if (el === null) throw new Error('sin capa');
  return el;
}

function resizeHandle(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-resize-id]');
  if (el === null) throw new Error('sin tirador');
  return el;
}

/** Id de la única anotación de firma de la página. */
function onlySignatureId(): string {
  const found = [...getEffective().values()].filter((a) => a.type === 'signature');
  expect(found).toHaveLength(1);
  const [only] = found;
  if (only === undefined) throw new Error('sin firma');
  return only.id;
}

beforeEach(() => {
  initServices({
    platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
    assetBaseUrl: '',
  });
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('firmado.pdf', memorySource(new Uint8Array([0x25]))),
  });
  endAnnotationSession();
});

afterEach(() => {
  endAnnotationSession();
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

describe('AnnotationLayer · firma (PDF-043)', () => {
  it('con «Firmar» elegida, un clic en la página coloca la firma centrada en el punto y la selecciona', () => {
    chooseSignature(INK_ART);
    renderLayer();
    // Clic en (200, 200) px = (100, 692) pt: la firma de 150 × 50 pt queda en [25, 667, 175, 717].
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });

    const id = onlySignatureId();
    expect(getEffective().get(id)?.rect).toEqual([25, 667, 175, 717]);
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(useAnnotations.getState().tool).toBe('none');
    expect(useAnnotations.getState().pendingSignature).toBeNull();
  });

  it('tras colocar con un clic, la firma queda seleccionada con su tirador (PDF-151)', () => {
    chooseSignature(INK_ART);
    renderInViewer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });

    const id = onlySignatureId();
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(resizeHandle().getAttribute('data-resize-id')).toBe(id);
  });

  it('tras colocar una imagen con un clic, queda seleccionada con su tirador (PDF-151)', () => {
    useAnnotations.setState({ pendingSignature: INK_ART, tool: 'page-image' });
    renderInViewer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });

    const id = onlySignatureId();
    expect(useAnnotations.getState().selectedId).toBe(id);
    expect(resizeHandle().getAttribute('data-resize-id')).toBe(id);
  });

  it('un clic posterior en zona vacía deselecciona la firma recién colocada (PDF-151)', () => {
    chooseSignature(INK_ART);
    renderInViewer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });
    expect(useAnnotations.getState().selectedId).not.toBeNull();

    setTool('none');
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 400, clientY: 400 });
    expect(useAnnotations.getState().selectedId).toBeNull();
  });

  it('sin firma pendiente, un clic en la página no crea nada', () => {
    setTool('signature');
    renderLayer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });
    expect(getEffective().size).toBe(0);
  });

  it('cancelar la herramienta descarta la firma pendiente', () => {
    chooseSignature(INK_ART);
    setTool('none');
    expect(useAnnotations.getState().pendingSignature).toBeNull();
  });

  it('arrastrar 50 px a la derecha mueve la firma 25 pt (50 px a escala 2)', () => {
    chooseSignature(INK_ART);
    renderLayer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });
    const id = onlySignatureId();

    fireEvent.pointerDown(zone(id), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 35, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10 });

    expect(getEffective().get(id)?.rect).toEqual([50, 667, 200, 717]);
  });

  it('el tirador agranda la firma manteniendo la proporción; deshacer devuelve el tamaño anterior', () => {
    chooseSignature(INK_ART);
    renderLayer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });
    const id = onlySignatureId();
    const before = getEffective().get(id)?.rect;

    fireEvent.pointerDown(resizeHandle(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 0 });

    // 60 px a escala 2 = 30 pt más de ancho: 180 × 60, esquina superior izquierda fija.
    const after = getEffective().get(id)?.rect;
    expect(after).toEqual([before?.[0], (before?.[3] ?? 0) - 60, (before?.[0] ?? 0) + 180, before?.[3]]);
    expect(useAnnotations.getState().undo.undoDepth).toBeGreaterThan(0);

    undo();
    expect(getEffective().get(id)?.rect).toEqual(before);
  });

  it('Supr borra la firma seleccionada', () => {
    chooseSignature(INK_ART);
    renderLayer();
    fireEvent.pointerDown(layerSvg(), { button: 0, clientX: 200, clientY: 200 });
    const id = onlySignatureId();

    fireEvent.keyDown(zone(id), { key: 'Delete' });
    expect(getEffective().has(id)).toBe(false);
  });

  it('Intro con «Firmar» (teclado) coloca la firma en la página actual, centrada y a un tercio de lo visible', () => {
    // Página A4 (595 × 842 pt) en la página 0, sin girar, con el borde superior visible al principio.
    useViewer.setState({
      dims: {
        count: 1,
        width: () => 595,
        height: () => 842,
        rotation: () => 0,
      } as unknown as NonNullable<ReturnType<typeof useViewer.getState>['dims']>,
      currentPage: 0,
      currentYFraction: 0,
      rotation: 0,
    });
    chooseSignature(INK_ART);
    const id = placeSignatureFromKeyboard(0.5);
    expect(id).not.toBeNull();
    const rect = id === null ? undefined : getEffective().get(id)?.rect;
    // Centro en x = 297,5 y en y ≈ 842 − 842 × (0,5 / 3): la firma de 150 × 50 pt queda centrada en ese punto.
    expect(rect?.[0]).toBeCloseTo(297.5 - 75);
    expect(rect?.[2]).toBeCloseTo(297.5 + 75);
    expect(useAnnotations.getState().tool).toBe('none');
  });
});
