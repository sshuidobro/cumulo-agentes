import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource, platformError, type SaveData } from '@suite/platform';
import { err, ok } from '@suite/shared';
import type { DocOpsClient } from '../../src/core/doc-ops/client';
import { openForSave } from '../../src/core/pdf';
import {
  addImages,
  closeImagesDialog,
  createPdfFromImages,
  MAX_IMAGE_BYTES,
  moveImage,
  openImagesDialog,
  removeImage,
  setImagesMargin,
  setImagesPageSize,
  useImagesDialog,
  type ImageItem,
} from '../../src/state/images-pdf-actions';
import { setDocOpsRunner } from '../../src/state/doc-ops';
import { cancelDocOp } from '../../src/state/extract-actions';
import { useViewer } from '../../src/state/viewer-store';
import { imagesMsg } from '../../src/ui/messages-images';
import { openedFile } from '../helpers/fake-platform';
import { setupSaveHarness } from '../helpers/save-harness';

const h = setupSaveHarness();
const OPTIONS_KEY = 'images-pdf-options';

let urlCounter = 0;
let createUrl: ReturnType<typeof vi.spyOn>;
let revokeUrl: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  urlCounter = 0;
  createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    urlCounter += 1;
    return `blob:test-${String(urlCounter)}`;
  });
  revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  useViewer.setState({ notice: null });
});

afterEach(() => {
  setDocOpsRunner(null);
  vi.unstubAllGlobals();
  closeImagesDialog();
  createUrl.mockRestore();
  revokeUrl.mockRestore();
  h.platform.prefs.remove(OPTIONS_KEY);
});

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Un JPEG real y pequeño de un color sólido. */
function jpegBytes(color: string): Uint8Array {
  const canvas = createCanvas(64, 48);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 48);
  return new Uint8Array(canvas.encodeSync('jpeg', 90));
}

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function file(name: string, bytes: Uint8Array): { readonly name: string; readonly bytes: Uint8Array } {
  return { name, bytes };
}

/** Abre el diálogo con estos ficheros elegidos en el selector. */
async function openWith(...files: readonly { readonly name: string; readonly bytes: Uint8Array }[]): Promise<void> {
  vi.mocked(h.platform.importFiles).mockResolvedValueOnce(ok(files));
  await openImagesDialog();
}

function itemsNow(): readonly ImageItem[] {
  return useImagesDialog.getState().items;
}

function noticeText(): string | undefined {
  return useViewer.getState().notice?.text;
}

/** Posición de la primera aparición de `needle` en `haystack`, o -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  return indexOfBytes(haystack, needle) >= 0;
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const reader = await openForSave(memorySource(bytes));
  if (!reader.ok) throw new Error(reader.error.message);
  return reader.value.pageCount();
}

/** Último PDF guardado con «Guardar como» (el segundo argumento de `saveAs` es el de los datos). */
function savedPdf(call = 0): { readonly name: string; readonly bytes: Uint8Array } {
  const [name, , data] = h.saveAs.mock.calls[call] as unknown as [string, unknown, SaveData];
  if (data.kind !== 'bytes') throw new Error('se esperaban bytes');
  return { name, bytes: data.bytes };
}

/** Imitación de `createImageBitmap` y de `OffscreenCanvas` para probar la decodificación sin navegador. */
function stubDecoder(width: number, height: number): void {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: () => undefined })));
  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext(): unknown {
      return {
        drawImage: () => undefined,
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(255),
        }),
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
}

describe('imágenes: la lista', () => {
  it('abrir el diálogo lo muestra vacío con A4 y margen pequeño por defecto, y lanza el selector', async () => {
    await openWith();
    expect(useImagesDialog.getState()).toMatchObject({ open: true, items: [], pageSize: 'a4', margin: 18 });
    expect(h.platform.importFiles).toHaveBeenCalledTimes(1);
  });

  it('añade las imágenes al final en el orden elegido, con una miniatura por imagen', async () => {
    await openWith(file('uno.jpg', jpegBytes('#ff0000')), file('dos.png', PNG_HEADER));
    await addImages();
    // Segunda ronda: la nueva imagen va al final.
    vi.mocked(h.platform.importFiles).mockResolvedValueOnce(ok([file('tres.jpg', jpegBytes('#00ff00'))]));
    await addImages();
    expect(itemsNow().map((item) => item.name)).toEqual(['uno.jpg', 'dos.png', 'tres.jpg']);
    expect(itemsNow().every((item) => item.previewUrl.startsWith('blob:test-'))).toBe(true);
  });

  it('más de 500 imágenes en la lista: aviso y no se añade nada', async () => {
    const many = Array.from({ length: 501 }, (_, i) => file(`f${String(i)}.jpg`, new Uint8Array([1])));
    await openWith(...many);
    expect(itemsNow()).toEqual([]);
    expect(noticeText()).toBe(imagesMsg.tooMany);
  });

  it('una imagen de más de 50 MB: aviso y no se añade nada', async () => {
    const huge = file('enorme.jpg', new Uint8Array(MAX_IMAGE_BYTES + 1));
    await openWith(file('ok.jpg', jpegBytes('#000000')), huge);
    expect(itemsNow()).toEqual([]);
    expect(noticeText()).toBe(imagesMsg.tooBig);
  });

  it('la plataforma rechaza el lote por tamaño: aviso de 50 MB', async () => {
    vi.mocked(h.platform.importFiles).mockResolvedValueOnce(err(platformError('out-of-range')));
    await openImagesDialog();
    expect(itemsNow()).toEqual([]);
    expect(noticeText()).toBe(imagesMsg.tooBig);
  });

  it('subir, bajar y quitar cambian el orden; quitar revoca la miniatura de esa imagen', async () => {
    await openWith(file('a.jpg', jpegBytes('#111111')), file('b.jpg', jpegBytes('#222222')), file('c.jpg', jpegBytes('#333333')));
    const [a, b, c] = itemsNow();
    if (a === undefined || b === undefined || c === undefined) throw new Error('faltan imágenes');
    moveImage(c.id, -1);
    expect(itemsNow().map((item) => item.name)).toEqual(['a.jpg', 'c.jpg', 'b.jpg']);
    moveImage(a.id, -1); // ya es la primera: no hace nada
    expect(itemsNow().map((item) => item.name)).toEqual(['a.jpg', 'c.jpg', 'b.jpg']);
    moveImage(a.id, 1);
    expect(itemsNow().map((item) => item.name)).toEqual(['c.jpg', 'a.jpg', 'b.jpg']);
    removeImage(a.id);
    expect(itemsNow().map((item) => item.name)).toEqual(['c.jpg', 'b.jpg']);
    expect(revokeUrl).toHaveBeenCalledWith(a.previewUrl);
  });

  it('cerrar el diálogo revoca todas las miniaturas', async () => {
    await openWith(file('a.jpg', jpegBytes('#111111')), file('b.jpg', jpegBytes('#222222')));
    const urls = itemsNow().map((item) => item.previewUrl);
    closeImagesDialog();
    expect(useImagesDialog.getState()).toMatchObject({ open: false, items: [] });
    for (const url of urls) expect(revokeUrl).toHaveBeenCalledWith(url);
  });
});

describe('imágenes: preferencias', () => {
  it('el tamaño de página y el margen elegidos se guardan y se recuerdan al abrir de nuevo', async () => {
    await openWith();
    setImagesPageSize('letter');
    setImagesMargin(36);
    expect(h.platform.prefs.get(OPTIONS_KEY, isObject)).toEqual({ pageSize: 'letter', margin: 36 });
    closeImagesDialog();
    await openWith();
    expect(useImagesDialog.getState()).toMatchObject({ pageSize: 'letter', margin: 36 });
  });
});

describe('imágenes: crear el PDF', () => {
  it('JPEG en el orden de la lista: un PDF con una página por imagen y los bytes de cada JPEG intactos', async () => {
    const red = jpegBytes('#ff0000');
    const green = jpegBytes('#00ff00');
    await openWith(file('uno.jpg', red), file('dos.jpeg', green));
    const [first, second] = itemsNow();
    if (first === undefined || second === undefined) throw new Error('faltan imágenes');
    moveImage(second.id, -1);
    h.saveAs.mockImplementationOnce(async (name: string, _filters: unknown, data: SaveData) => {
      if (data.kind !== 'bytes') throw new Error('se esperaban bytes');
      return ok({ kind: 'saved' as const, file: openedFile(name, memorySource(data.bytes)) });
    });

    const outcome = await createPdfFromImages();

    expect(outcome).toBe('saved');
    const pdf = savedPdf();
    expect(pdf.name).toBe('dos.pdf');
    expect(await pageCountOf(pdf.bytes)).toBe(2);
    expect(contains(pdf.bytes, red)).toBe(true);
    expect(contains(pdf.bytes, green)).toBe(true);
    // El orden de las páginas: el JPEG verde (segundo en la lista original, primero tras subirlo) aparece antes.
    expect(indexOfBytes(pdf.bytes, green)).toBeLessThan(indexOfBytes(pdf.bytes, red));
  });

  it('PNG con decodificación simulada: se convierte a píxeles y entra en el PDF', async () => {
    stubDecoder(2, 2);
    await openWith(file('firma.png', PNG_HEADER));
    h.saveAs.mockResolvedValueOnce(ok({ kind: 'downloaded', name: 'firma.pdf' }));

    const outcome = await createPdfFromImages();

    expect(outcome).toBe('downloaded');
    expect(await pageCountOf(savedPdf().bytes)).toBe(1);
    expect(noticeText()).toBe(imagesMsg.created('firma.pdf'));
    expect(useImagesDialog.getState().open).toBe(false);
  });

  it('un PNG corrupto: aviso con su nombre y no se guarda nada', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('datos no válidos');
    }));
    await openWith(file('roto.png', PNG_HEADER), file('ok.jpg', jpegBytes('#000000')));

    const outcome = await createPdfFromImages();

    expect(outcome).toBe('failed');
    expect(noticeText()).toBe(imagesMsg.cannotRead('roto.png'));
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('una imagen con más de 50 millones de píxeles no se puede leer: aviso y nada guardado', async () => {
    stubDecoder(10_000, 10_000);
    await openWith(file('gigante.png', PNG_HEADER));

    expect(await createPdfFromImages()).toBe('failed');
    expect(noticeText()).toBe(imagesMsg.cannotRead('gigante.png'));
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('cancelar mientras el motor trabaja: no se guarda nada', async () => {
    const run = vi.fn(async () => {
      cancelDocOp();
      return ok({ bytes: new Uint8Array([1]) });
    });
    setDocOpsRunner({ run, dispose: () => undefined } as DocOpsClient);
    await openWith(file('a.jpg', jpegBytes('#123456')));

    expect(await createPdfFromImages()).toBe('cancelled');
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('cancelar mientras se preparan las imágenes: no se llega al motor ni se guarda', async () => {
    stubDecoder(2, 2);
    const run = vi.fn();
    setDocOpsRunner({ run, dispose: () => undefined } as unknown as DocOpsClient);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      cancelDocOp();
      return { width: 2, height: 2, close: () => undefined };
    }));
    await openWith(file('a.png', PNG_HEADER));

    expect(await createPdfFromImages()).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('sin imágenes no hace nada', async () => {
    await openWith();
    expect(await createPdfFromImages()).toBe('failed');
    expect(h.saveAs).not.toHaveBeenCalled();
  });

  it('el margen y el tamaño elegidos llegan al motor', async () => {
    const run = vi.fn(async () => ok({ bytes: new Uint8Array([1]) }));
    setDocOpsRunner({ run, dispose: () => undefined } as DocOpsClient);
    await openWith(file('a.jpg', jpegBytes('#654321')));
    setImagesPageSize('letter');
    setImagesMargin(0);

    await createPdfFromImages();

    expect(run).toHaveBeenCalledWith(
      'images-to-pdf',
      expect.objectContaining({ pageSize: 'letter', margin: 0 }),
      [],
      expect.anything(),
    );
  });
});
