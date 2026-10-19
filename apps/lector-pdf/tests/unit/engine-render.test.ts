import { describe, expect, it, vi } from 'vitest';
import { pdfjs } from '../../src/engine/pdfjs';
import type { PDFPageProxy } from '../../src/engine/pdfjs';
import { renderPageToCanvas } from '../../src/engine/render';
import { NIGHT_PAGE_COLORS } from '../../src/core/night';

interface FakeTask {
  readonly promise: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
}

/**
 * Página falsa cuyo dibujo termina según lo que decida el test. `getOperatorList` devuelve `ops` (por defecto,
 * una lista vacía); si se pasa `ops` como promesa, la página espera a que el test la resuelva.
 */
function fakePage(
  task: FakeTask,
  ops: Promise<unknown> = Promise.resolve({ fnArray: [], argsArray: [] }),
): {
  page: PDFPageProxy;
  render: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  getOperatorList: ReturnType<typeof vi.fn>;
} {
  const render = vi.fn(() => task);
  const getViewport = vi.fn(() => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }));
  const getOperatorList = vi.fn(() => ops);
  return { page: { render, getViewport, getOperatorList } as unknown as PDFPageProxy, render, getViewport, getOperatorList };
}

function task(promise: Promise<void>): FakeTask {
  return { promise, cancel: vi.fn() };
}

const ok = (): FakeTask => task(Promise.resolve());

/** Lienzo falso con contexto 2d sobre un búfer de `width × height` píxeles blancos. */
function fakeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  putImageData: ReturnType<typeof vi.fn>;
  data: Uint8ClampedArray;
} {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const putImageData = vi.fn();
  const ctx = {
    getImageData: vi.fn(() => ({ data, width, height })),
    putImageData,
  };
  const canvas = { width, height, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
  return { canvas, putImageData, data };
}

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
    const { AnnotationMode } = pdfjs();
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

  it('con densidad distinta de 1 escala con transform', async () => {
    const { page, render } = fakePage(ok());
    await renderPageToCanvas(page, {} as HTMLCanvasElement, {
      scale: 1,
      rotation: 0,
      outputScale: 2,
      signal: new AbortController().signal,
    });
    const params = render.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.transform).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('con origen de zona desplaza el viewport con offsetX/offsetY negativos (lienzo de detalle)', async () => {
    const { page, getViewport } = fakePage(ok());
    await renderPageToCanvas(page, {} as HTMLCanvasElement, {
      scale: 2,
      rotation: 90,
      outputScale: 1,
      offset: { x: 120, y: 340 },
      signal: new AbortController().signal,
    });
    expect(getViewport).toHaveBeenCalledWith({ scale: 2, rotation: 90, offsetX: -120, offsetY: -340 });
  });

  it('abortar durante el dibujo cancela la tarea de pdf.js y devuelve cancelled', async () => {
    const { RenderingCancelledException } = pdfjs();
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

describe('renderPageToCanvas · modo noche', () => {
  it('sin modo noche no pide la lista de operadores ni pasa colores a pdf.js', async () => {
    const { page, render, getOperatorList } = fakePage(ok());
    const { canvas, putImageData } = fakeCanvas(2, 2);
    await renderPageToCanvas(page, canvas, { scale: 1, rotation: 0, outputScale: 1, signal: new AbortController().signal });
    expect(getOperatorList).not.toHaveBeenCalled();
    expect(putImageData).not.toHaveBeenCalled();
    const params = render.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('pageColors');
  });

  it('con modo noche pide los operadores con el mismo modo de anotaciones y transforma el lienzo una vez', async () => {
    const { AnnotationMode } = pdfjs();
    const { page, render, getOperatorList } = fakePage(ok());
    const { canvas, putImageData, data } = fakeCanvas(2, 2);
    const outcome = await renderPageToCanvas(page, canvas, {
      scale: 1,
      rotation: 0,
      outputScale: 1,
      signal: new AbortController().signal,
      night: NIGHT_PAGE_COLORS,
    });
    expect(outcome).toBe('done');
    expect(getOperatorList).toHaveBeenCalledWith({ intent: 'display', annotationMode: AnnotationMode.ENABLE_STORAGE });
    const params = render.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('pageColors');
    expect(params.annotationMode).toBe(AnnotationMode.ENABLE_STORAGE);
    expect(putImageData).toHaveBeenCalledTimes(1);
    // Blanco → fondo de noche (31, 31, 35); alfa intacto.
    expect(Array.from(data.slice(0, 4))).toEqual([31, 31, 35, 255]);
  });

  it('si la señal aborta mientras se espera la lista de operadores, devuelve cancelled sin escribir el lienzo', async () => {
    const controller = new AbortController();
    let resolveOps: (value: unknown) => void = () => undefined;
    const ops = new Promise<unknown>((resolve) => {
      resolveOps = resolve;
    });
    const { page } = fakePage(ok(), ops);
    const { canvas, putImageData } = fakeCanvas(2, 2);
    const pending = renderPageToCanvas(page, canvas, {
      scale: 1,
      rotation: 0,
      outputScale: 1,
      signal: controller.signal,
      night: NIGHT_PAGE_COLORS,
    });
    controller.abort();
    resolveOps({ fnArray: [], argsArray: [] });
    await expect(pending).resolves.toBe('cancelled');
    expect(putImageData).not.toHaveBeenCalled();
  });

  it('si falla la lista de operadores, dibuja la página normal sin modo noche', async () => {
    const { page } = fakePage(ok(), Promise.reject(new Error('sin operadores')));
    const { canvas, putImageData } = fakeCanvas(2, 2);
    const outcome = await renderPageToCanvas(page, canvas, {
      scale: 1,
      rotation: 0,
      outputScale: 1,
      signal: new AbortController().signal,
      night: NIGHT_PAGE_COLORS,
    });
    expect(outcome).toBe('done');
    expect(putImageData).not.toHaveBeenCalled();
  });
});
