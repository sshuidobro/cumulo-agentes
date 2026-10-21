import { describe, expect, it, vi } from 'vitest';
import type { PageRotation } from '../../src/core/pdf/page-tree';
import type { OcrEngine, OcrWordPx } from '../../src/engine/ocr';
import { OCR_DPI, pageHasText, recognizePage } from '../../src/engine/ocr-page';
import type { PDFDocumentProxy } from '../../src/engine/pdfjs';
import { renderPageImage } from '../../src/engine/print-render';
import { createPageTextSource } from '../../src/engine/search-source';

vi.mock('../../src/engine/print-render', () => ({ renderPageImage: vi.fn() }));
vi.mock('../../src/engine/search-source', () => ({ createPageTextSource: vi.fn() }));

/** Página de `width`×`height` puntos (sin girar) con /Rotate `rotate`. Registra la escala pedida. */
function fakeDoc(rotate: PageRotation, width: number, height: number, scales: number[]): PDFDocumentProxy {
  const quarter = rotate === 90 || rotate === 270;
  return {
    getPage: () =>
      Promise.resolve({
        rotate,
        getViewport: ({ scale }: { readonly scale: number }) => {
          scales.push(scale);
          return {
            width: (quarter ? height : width) * scale,
            height: (quarter ? width : height) * scale,
            // Píxeles de la imagen (origen arriba-izquierda, a `scale`) → puntos del espacio de usuario.
            // Sin giro: y crece hacia arriba desde la base. Con giro de 90° horario: el eje y de la pantalla es el x de la página.
            convertToPdfPoint: (x: number, y: number) =>
              rotate === 0 ? [x / scale, height - y / scale] : [y / scale, x / scale],
          };
        },
        cleanup: () => undefined,
      }),
  } as unknown as PDFDocumentProxy;
}

/** Motor que devuelve siempre las mismas palabras. */
function engineWith(words: readonly OcrWordPx[]): OcrEngine {
  return {
    recognize: vi.fn(() => Promise.resolve(words)),
    terminate: vi.fn(() => Promise.resolve()),
  };
}

const WORD: OcrWordPx = { text: 'FACTURA', confidence: 95, bbox: { x0: 10, y0: 20, x1: 30, y1: 40 } };

describe('recognizePage · cajas de píxeles a puntos', () => {
  it('sin giro, la caja se convierte con el viewport del dibujo (y crece hacia arriba)', async () => {
    const scales: number[] = [];
    vi.mocked(renderPageImage).mockResolvedValue({ blob: new Blob(['png']), width: 1, height: 1, dpi: OCR_DPI });
    const page = await recognizePage(fakeDoc(0, 100, 200, scales), 0, engineWith([WORD]), new AbortController().signal);

    const scale = scales[scales.length - 1] ?? 0;
    expect(page).toEqual({
      pageIndex: 0,
      rotate: 0,
      words: [{ text: 'FACTURA', box: [10 / scale, 200 - 40 / scale, 30 / scale, 200 - 20 / scale] }],
    });
  });

  it('con giro de 90°, los ejes del viewport se intercambian', async () => {
    const scales: number[] = [];
    vi.mocked(renderPageImage).mockResolvedValue({ blob: new Blob(['png']), width: 1, height: 1, dpi: OCR_DPI });
    const page = await recognizePage(fakeDoc(90, 100, 200, scales), 3, engineWith([WORD]), new AbortController().signal);

    const scale = scales[scales.length - 1] ?? 0;
    expect(page).toEqual({
      pageIndex: 3,
      rotate: 90,
      words: [{ text: 'FACTURA', box: [20 / scale, 10 / scale, 40 / scale, 30 / scale] }],
    });
  });

  it('dibuja a OCR_DPI, sin comentarios y como PNG', async () => {
    vi.mocked(renderPageImage).mockResolvedValue({ blob: new Blob(['png']), width: 1, height: 1, dpi: OCR_DPI });
    const signal = new AbortController().signal;
    await recognizePage(fakeDoc(0, 100, 200, []), 1, engineWith([]), signal);

    expect(renderPageImage).toHaveBeenLastCalledWith(expect.anything(), 1, {
      dpi: 300,
      withComments: false,
      signal,
      type: 'image/png',
    });
  });

  it('abortado antes de empezar devuelve cancelled sin dibujar', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(renderPageImage).mockClear();

    const result = await recognizePage(fakeDoc(0, 100, 200, []), 0, engineWith([WORD]), controller.signal);

    expect(result).toBe('cancelled');
    expect(renderPageImage).not.toHaveBeenCalled();
  });

  it('si el dibujo se cancela, devuelve cancelled y no reconoce', async () => {
    const controller = new AbortController();
    const engine = engineWith([WORD]);
    vi.mocked(renderPageImage).mockResolvedValue('cancelled');

    const result = await recognizePage(fakeDoc(0, 100, 200, []), 0, engine, controller.signal);

    expect(result).toBe('cancelled');
    expect(engine.recognize).not.toHaveBeenCalled();
  });
});

describe('pageHasText', () => {
  it('true si hay algún carácter no blanco', async () => {
    vi.mocked(createPageTextSource).mockReturnValue({
      getPageItems: () => Promise.resolve([{ str: '  ', hasEOL: false }, { str: 'Hola', hasEOL: false }]),
    });

    expect(await pageHasText({} as PDFDocumentProxy, 0)).toBe(true);
  });

  it('false si la capa de texto está vacía o solo tiene blancos', async () => {
    vi.mocked(createPageTextSource).mockReturnValue({
      getPageItems: () => Promise.resolve([{ str: ' ', hasEOL: true }]),
    });

    expect(await pageHasText({} as PDFDocumentProxy, 0)).toBe(false);
  });
});
