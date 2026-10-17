import { describe, expect, it, vi } from 'vitest';
import { AnnotationMode, RenderingCancelledException } from '../../src/engine/pdfjs';
import type { PDFPageProxy } from '../../src/engine/pdfjs';
import { renderPageToCanvas } from '../../src/engine/render';

interface FakeTask {
  readonly promise: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
}

/** Página falsa cuyo dibujo termina según lo que decida el test. */
function fakePage(task: FakeTask): { page: PDFPageProxy; render: ReturnType<typeof vi.fn>; getViewport: ReturnType<typeof vi.fn> } {
  const render = vi.fn(() => task);
  const getViewport = vi.fn(() => ({ width: 612, height: 792 }));
  return { page: { render, getViewport } as unknown as PDFPageProxy, render, getViewport };
}

function task(promise: Promise<void>): FakeTask {
  return { promise, cancel: vi.fn() };
}

const ok = (): FakeTask => task(Promise.resolve());

describe('renderPageToCanvas', () => {
  it('con la señal ya abortada devuelve cancelled sin dibujar', async () => {
    const controller = new AbortController();
    controller.abort();
    const t = ok();
    const { page, render } = fakePage(t);
    const outcome = await renderPageToCanvas(page, {} as HTMLCanvasElement, {
      scale: 1.33,
      rotation: 0,
      outputScale: 1,
      signal: controller.signal,
    });
    expect(outcome).toBe('cancelled');
    expect(render).not.toHaveBeenCalled();
  });

  it('dibuja con las anotaciones del fichero y sin transform si la densidad es 1', async () => {
    const canvas = {} as HTMLCanvasElement;
    const { page, render, getViewport } = fakePage(ok());
    const outcome = await renderPageToCanvas(page, canvas, {
      scale: 1.5,
      rotation: 90,
      outputScale: 1,
      signal: new AbortController().signal,
    });
    expect(outcome).toBe('done');
    expect(getViewport).toHaveBeenCalledWith({ scale: 1.5, rotation: 90 });
    const params = render.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.canvas).toBe(canvas);
    expect(params.annotationMode).toBe(AnnotationMode.ENABLE_STORAGE);
    expect(params).not.toHaveProperty('transform');
    expect(params).not.toHaveProperty('pageColors');
  });

  it('con densidad distinta de 1 escala con transform y pasa los colores de página si se piden', async () => {
    const { page, render } = fakePage(ok());
    await renderPageToCanvas(page, {} as HTMLCanvasElement, {
      scale: 1,
      rotation: 0,
      outputScale: 2,
      signal: new AbortController().signal,
      pageColors: { background: '#000', foreground: '#fff' },
    });
    const params = render.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(params.pageColors).toEqual({ background: '#000', foreground: '#fff' });
  });

  it('abortar durante el dibujo cancela la tarea de pdf.js y devuelve cancelled', async () => {
    const controller = new AbortController();
    let reject: (reason: unknown) => void = () => undefined;
    const t = task(new Promise<void>((_resolve, rej) => {
      reject = rej;
    }));
    t.cancel.mockImplementation(() => {
      reject(new RenderingCancelledException('cancelado', 0));
    });
    const { page } = fakePage(t);
    const pending = renderPageToCanvas(page, {} as HTMLCanvasElement, {
      scale: 1,
      rotation: 0,
      outputScale: 1,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toBe('cancelled');
    expect(t.cancel).toHaveBeenCalledTimes(1);
  });

  it('un error que no es de cancelación se relanza', async () => {
    const t = task(Promise.reject(new Error('fallo de pdf.js')));
    const { page } = fakePage(t);
    await expect(
      renderPageToCanvas(page, {} as HTMLCanvasElement, {
        scale: 1,
        rotation: 0,
        outputScale: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('fallo de pdf.js');
  });
});
