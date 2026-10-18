// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextLayerHandle } from '../../src/engine/text';
import type { PageViewport } from '../../src/engine/pdfjs';
import { attachSelectionBehavior, selectPageText } from '../../src/ui/viewer/text-selection';
import * as registry from '../../src/ui/viewer/text-layer-registry';

/** Capa con dos ítems de texto, como la que dibuja pdf.js. */
function makeLayer(): { layer: HTMLDivElement; spans: HTMLSpanElement[] } {
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  document.body.append(layer);
  const spans = ['Primera', 'segunda'].map((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    layer.append(span);
    return span;
  });
  return { layer, spans };
}

function handleFor(spans: HTMLSpanElement[]): TextLayerHandle {
  const container = spans[0]?.parentElement ?? document.createElement('div');
  return {
    textDivs: spans,
    items: spans.map((s) => s.textContent ?? ''),
    container,
    viewport: { convertToPdfPoint: (x: number, y: number) => [x, y] } as unknown as PageViewport,
    render: () => Promise.resolve(),
    update: () => undefined,
    cancel: () => undefined,
  };
}

/** Evento `copy` con un `clipboardData` que recoge lo escrito. */
function copyEvent(): { event: Event; written: Map<string, string> } {
  const written = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (type: string, text: string) => written.set(type, text) },
  });
  return { event, written };
}

const layers: HTMLElement[] = [];

beforeEach(() => {
  layers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const layer of layers) layer.remove();
  registry.unregister(0);
  registry.unregister(1);
});

describe('attachSelectionBehavior', () => {
  it('añade el marcador endOfContent al final de la capa', () => {
    const { layer } = makeLayer();
    layers.push(layer);
    const detach = attachSelectionBehavior(layer);

    expect(layer.lastElementChild?.className).toBe('endOfContent');
    detach();
  });

  it('al copiar escribe el texto normalizado (Unicode) sin caracteres nulos y cancela el copiado nativo', () => {
    const { layer } = makeLayer();
    layers.push(layer);
    const detach = attachSelectionBehavior(layer);
    vi.spyOn(document, 'getSelection').mockReturnValue({ toString: () => 'ﬁnal\0 ok' } as Selection);
    const { event, written } = copyEvent();

    layer.dispatchEvent(event);

    expect(written.get('text/plain')).toBe('final ok');
    expect(event.defaultPrevented).toBe(true);
    detach();
  });

  it('marca la capa como «selecting» al pulsar el ratón', () => {
    const { layer } = makeLayer();
    layers.push(layer);
    const detach = attachSelectionBehavior(layer);

    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(layer.classList.contains('selecting')).toBe(true);
    detach();
  });

  it('tras desregistrar la última capa quita los oyentes globales y deja de reaccionar a copiar', () => {
    const { layer } = makeLayer();
    layers.push(layer);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const detach = attachSelectionBehavior(layer);
    vi.spyOn(document, 'getSelection').mockReturnValue({ toString: () => 'x' } as Selection);

    detach();

    expect(removeSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    const { event, written } = copyEvent();
    layer.dispatchEvent(event);
    expect(written.size).toBe(0);
  });

  it('con dos capas, quitar la primera conserva los oyentes globales y quitar la última los retira', () => {
    const first = makeLayer();
    const second = makeLayer();
    layers.push(first.layer, second.layer);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const detachFirst = attachSelectionBehavior(first.layer);
    const detachSecond = attachSelectionBehavior(second.layer);

    detachFirst();
    expect(removeSpy).not.toHaveBeenCalledWith('selectionchange', expect.any(Function));

    detachSecond();
    expect(removeSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));
  });
});

describe('selectPageText', () => {
  it('selecciona desde el primer hasta el último ítem de la página registrada', () => {
    const { layer, spans } = makeLayer();
    layers.push(layer);
    const detach = attachSelectionBehavior(layer);
    registry.register(0, handleFor(spans));

    expect(selectPageText(0)).toBe(true);

    const selection = document.getSelection();
    expect(selection?.containsNode(spans[0] as Node, true)).toBe(true);
    expect(selection?.containsNode(spans[1] as Node, true)).toBe(true);
    detach();
  });

  it('devuelve false si la página no tiene capa montada', () => {
    expect(selectPageText(1)).toBe(false);
  });
});
