import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from '../../src/engine/pdfjs';
import { renderPageForPrint, renderPageImage } from '../../src/engine/print-render';

/**
 * Sin `canvas` en Node: el lienzo y la página son dobles que registran cómo se les llama.
 * Comprueba los parámetros de `render`, la limpieza y las marcas `noPrint`, no los píxeles.
 */

interface FakeAnnotation {
  readonly id: string;
  readonly annotationType: number;
}

interface Fixture {
  readonly doc: PDFDocumentProxy;
  readonly page: PDFPageProxy;
  readonly storage: Map<string, object>;
  readonly renderParams: unknown[];
  readonly cleanup: ReturnType<typeof vi.fn>;
  readonly canvas: { width: number; height: number; toBlob: ReturnType<typeof vi.fn> };
  /** Cancelación de la tarea de render. */
  readonly cancel: ReturnType<typeof vi.fn>;
}

const A4 = { width: 595, height: 842 };
const ANNOTATIONS: readonly FakeAnnotation[] = [
  { id: '10R', annotationType: 8 }, // Highlight: se oculta sin comentarios
  { id: '11R', annotationType: 20 }, // Widget: campo de formulario, se queda
];

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Doble del documento y de la página. `renderPromise` decide cómo acaba el dibujo. */
function fixture(options: { readonly annotations?: readonly FakeAnnotation[]; readonly renderPromise?: () => Promise<void> } = {}): Fixture {
  const storage = new Map<string, object>();
  const renderParams: unknown[] = [];
  const cleanup = vi.fn();
  const cancel = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    toBlob: vi.fn((callback: (blob: Blob | null) => void, type: string) => {
      callback(new Blob(['png'], { type }));
    }),
  };
  const annotationStorage = {
    has: (key: string) => storage.has(key),
    get: (key: string) => storage.get(key),
    getRawValue: (key: string) => storage.get(key),
    setValue: (key: string, value: object) => { storage.set(key, value); },
    remove: (key: string) => { storage.delete(key); },
  };
  const page = {
    getViewport: ({ scale }: { readonly scale: number }) => ({ width: A4.width * scale, height: A4.height * scale }),
    getAnnotations: vi.fn(() => Promise.resolve(options.annotations ?? ANNOTATIONS)),
    render: vi.fn((params: unknown) => {
      renderParams.push(params);
      return { promise: options.renderPromise?.() ?? Promise.resolve(), cancel };
    }),
    cleanup,
  } as unknown as PDFPageProxy;
  const doc = {
    annotationStorage,
    getPage: vi.fn(() => Promise.resolve(page)),
  } as unknown as PDFDocumentProxy;
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return { doc, page, storage, renderParams, cleanup, canvas: canvas as Fixture['canvas'], cancel };
}

function hasNoPrint(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'noPrint' in value && value.noPrint === true;
}

function options(overrides: { readonly withComments?: boolean; readonly signal?: AbortSignal } = {}) {
  return {
    dpi: 150,
    withComments: overrides.withComments ?? true,
    signal: overrides.signal ?? new AbortController().signal,
  };
}

describe('renderPageForPrint', () => {
  it('dibuja con intent print, guardado de anotaciones y la escala a 150 ppp; devuelve un PNG', async () => {
    const f = fixture();

    const blob = await renderPageForPrint(f.doc, 0, options());

    expect(blob).toBeInstanceOf(Blob);
    expect(blob instanceof Blob && blob.type).toBe('image/png');
    expect(f.renderParams).toHaveLength(1);
    const params = f.renderParams[0] as { intent: string; annotationMode: number; viewport: { width: number; height: number } };
    expect(params.intent).toBe('print');
    expect(params.annotationMode).toBe(pdfjs().AnnotationMode.ENABLE_STORAGE);
    expect(params.viewport.width).toBeCloseTo(595 * (150 / 72), 6);
    expect(params.viewport.height).toBeCloseTo(842 * (150 / 72), 6);
  });

  it('libera el lienzo y la página antes de resolver', async () => {
    const f = fixture();

    await renderPageForPrint(f.doc, 0, options());

    expect(f.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(f.canvas.width).toBe(0);
    expect(f.canvas.height).toBe(0);
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  it('con withComments false marca noPrint solo en las anotaciones que no son campos y deshace la marca al terminar', async () => {
    const f = fixture();
    f.storage.set('11R', { value: 'Sí' }); // un campo con valor no se toca

    await renderPageForPrint(f.doc, 0, options({ withComments: false }));

    expect(f.storage.has('10R')).toBe(false);
    expect(f.storage.get('11R')).toEqual({ value: 'Sí' });
  });

  it('con withComments false y una marca previa en el storage la restaura en vez de borrarla', async () => {
    const f = fixture();
    f.storage.set('10R', { noPrint: false, keep: true });

    await renderPageForPrint(f.doc, 0, options({ withComments: false }));

    expect(f.storage.get('10R')).toEqual({ noPrint: false, keep: true });
  });

  it('con withComments false, las marcas se aplican antes de dibujar', async () => {
    const seen: boolean[] = [];
    const f = fixture({
      renderPromise: () => {
        seen.push(hasNoPrint(f.storage.get('10R')));
        return Promise.resolve();
      },
    });

    await renderPageForPrint(f.doc, 0, options({ withComments: false }));

    expect(seen).toEqual([true]);
  });

  it('con withComments true no toca el annotationStorage', async () => {
    const f = fixture();

    await renderPageForPrint(f.doc, 0, options({ withComments: true }));

    expect(f.storage.size).toBe(0);
    expect(f.page.getAnnotations).not.toHaveBeenCalled();
  });

  it('si la señal ya está abortada devuelve cancelled sin dibujar', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();

    expect(await renderPageForPrint(f.doc, 0, options({ signal: controller.signal }))).toBe('cancelled');

    expect(f.renderParams).toHaveLength(0);
  });

  it('abortar durante el dibujo cancela la tarea y devuelve cancelled, dejando el lienzo libre', async () => {
    let rejectRender: (reason: unknown) => void = () => undefined;
    const f = fixture({
      renderPromise: () => new Promise<void>((_, reject) => { rejectRender = reject; }),
    });
    // Como pdf.js: cancelar la tarea hace que su promesa rechace con RenderingCancelledException.
    f.cancel.mockImplementation(() => { rejectRender(new (pdfjs().RenderingCancelledException)('cancelado', 0)); });
    const controller = new AbortController();

    const pending = renderPageForPrint(f.doc, 0, options({ signal: controller.signal }));
    await vi.waitFor(() => {
      expect(f.renderParams).toHaveLength(1);
    });
    controller.abort();

    expect(await pending).toBe('cancelled');
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.canvas.width).toBe(0);
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  it('abortar mientras se prepara la página, antes de dibujar, no inicia el render', async () => {
    const controller = new AbortController();
    const f = fixture();
    const doc = {
      ...f.doc,
      getPage: vi.fn(async () => {
        controller.abort();
        return f.page;
      }),
    } as unknown as PDFDocumentProxy;

    expect(await renderPageForPrint(doc, 0, options({ signal: controller.signal }))).toBe('cancelled');

    expect(f.renderParams).toHaveLength(0);
    expect(f.canvas.width).toBe(0);
  });

  it('un error de pdf.js que no es cancelación se relanza', async () => {
    const f = fixture({ renderPromise: () => Promise.reject(new Error('fallo de render')) });

    await expect(renderPageForPrint(f.doc, 0, options())).rejects.toThrow('fallo de render');
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  it('una RenderingCancelledException de pdf.js (sin abortar) también devuelve cancelled', async () => {
    const f = fixture({
      renderPromise: () => Promise.reject(new (pdfjs().RenderingCancelledException)('cancelado', 0)),
    });

    expect(await renderPageForPrint(f.doc, 0, options())).toBe('cancelled');
  });
});

describe('renderPageImage', () => {
  const LETTER = { width: 612, height: 792 };

  /** Doble con página de 612×792 pt, lienzo con contexto 2D y registro del orden de llamadas. */
  function imageFixture(options: { readonly annotations?: readonly FakeAnnotation[]; readonly renderPromise?: () => Promise<void> } = {}) {
    const events: string[] = [];
    const storage = new Map<string, object>();
    const cancel = vi.fn();
    const cleanup = vi.fn();
    const context: { fillStyle: string; fillRect: ReturnType<typeof vi.fn> } = {
      fillStyle: '',
      fillRect: vi.fn(() => { events.push(`fillRect:${context.fillStyle}`); }),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: (blob: Blob | null) => void, type: string) => {
        callback(new Blob(['img'], { type }));
      }),
    };
    const annotationStorage = {
      has: (key: string) => storage.has(key),
      get: (key: string) => storage.get(key),
      getRawValue: (key: string) => storage.get(key),
      setValue: (key: string, value: object) => { storage.set(key, value); },
      remove: (key: string) => { storage.delete(key); },
    };
    const renderParams: unknown[] = [];
    const page = {
      getViewport: ({ scale }: { readonly scale: number }) => ({ width: LETTER.width * scale, height: LETTER.height * scale }),
      getAnnotations: vi.fn(() => Promise.resolve(options.annotations ?? ANNOTATIONS)),
      render: vi.fn((params: unknown) => {
        events.push('render');
        renderParams.push(params);
        return { promise: options.renderPromise?.() ?? Promise.resolve(), cancel };
      }),
      cleanup,
    } as unknown as PDFPageProxy;
    const doc = {
      annotationStorage,
      getPage: vi.fn(() => Promise.resolve(page)),
    } as unknown as PDFDocumentProxy;
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    return { doc, storage, events, canvas, cancel, cleanup, renderParams };
  }

  function imageOptions(overrides: Partial<{ dpi: number; type: 'image/png' | 'image/jpeg'; quality: number; withComments: boolean; signal: AbortSignal }> = {}) {
    return {
      dpi: 150,
      withComments: true,
      signal: new AbortController().signal,
      type: 'image/png' as const,
      ...overrides,
    };
  }

  it('a 150 ppp deja el lienzo en 1275×1650 y devuelve tamaño y dpi reales', async () => {
    const f = imageFixture();

    const image = await renderPageImage(f.doc, 0, imageOptions({ dpi: 150 }));

    expect(image).not.toBe('cancelled');
    if (image === 'cancelled') return;
    expect(image.width).toBe(1275);
    expect(image.height).toBe(1650);
    expect(image.dpi).toBe(150);
    expect(image.blob.type).toBe('image/png');
    expect(f.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('en JPEG a 72 ppp rellena de blanco antes de pintar y codifica con calidad 0,92 por defecto', async () => {
    const f = imageFixture();

    const image = await renderPageImage(f.doc, 0, imageOptions({ dpi: 72, type: 'image/jpeg' }));

    expect(image).not.toBe('cancelled');
    if (image === 'cancelled') return;
    expect(image.width).toBe(612);
    expect(image.height).toBe(792);
    expect(image.dpi).toBe(72);
    expect(image.blob.type).toBe('image/jpeg');
    expect(f.events).toEqual(['fillRect:#ffffff', 'render']);
    expect(f.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
  });

  it('en JPEG usa la calidad pedida', async () => {
    const f = imageFixture();

    await renderPageImage(f.doc, 0, imageOptions({ dpi: 72, type: 'image/jpeg', quality: 0.5 }));

    expect(f.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.5);
  });

  it('en PNG no rellena de blanco el lienzo', async () => {
    const f = imageFixture();

    await renderPageImage(f.doc, 0, imageOptions({ dpi: 72 }));

    expect(f.canvas.getContext).not.toHaveBeenCalled();
    expect(f.events).toEqual(['render']);
  });

  it('informa del dpi real cuando printScale recorta la resolución', async () => {
    const f = imageFixture();

    const image = await renderPageImage(f.doc, 0, imageOptions({ dpi: 600 }));

    expect(image).not.toBe('cancelled');
    if (image === 'cancelled') return;
    expect(image.dpi).toBeLessThan(600);
    expect(image.width * image.height).toBeLessThanOrEqual(33_554_432);
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
  });

  it('con withComments false marca noPrint y lo restaura al terminar, como al imprimir', async () => {
    const f = imageFixture();
    f.storage.set('11R', { value: 'Sí' });

    await renderPageImage(f.doc, 0, imageOptions({ withComments: false, type: 'image/jpeg', dpi: 72 }));

    expect(f.storage.has('10R')).toBe(false);
    expect(f.storage.get('11R')).toEqual({ value: 'Sí' });
  });

  it('abortar durante el dibujo devuelve cancelled y deja el lienzo libre', async () => {
    let rejectRender: (reason: unknown) => void = () => undefined;
    const f = imageFixture({ renderPromise: () => new Promise<void>((_, reject) => { rejectRender = reject; }) });
    f.cancel.mockImplementation(() => { rejectRender(new (pdfjs().RenderingCancelledException)('cancelado', 0)); });
    const controller = new AbortController();

    const pending = renderPageImage(f.doc, 0, imageOptions({ type: 'image/jpeg', dpi: 72, signal: controller.signal }));
    await vi.waitFor(() => {
      expect(f.renderParams).toHaveLength(1);
    });
    controller.abort();

    expect(await pending).toBe('cancelled');
    expect(f.canvas.width).toBe(0);
    expect(f.cleanup).toHaveBeenCalledTimes(1);
    expect(f.canvas.toBlob).not.toHaveBeenCalled();
  });
});
