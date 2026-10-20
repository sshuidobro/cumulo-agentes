import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import type { OpContext } from '../../../src/core/doc-ops/protocol';
import {
  buildPdfFromImages,
  FIT_DPI,
  jpegDensity,
  type ImageInput,
  type ImagesToPdfInput,
} from '../../../src/core/pdf/images-to-pdf';
import type { RgbaImage } from '../../../src/core/pdf/image';
import { qpdfCheck, qpdfObjects } from '../../support/qpdf';

const NOW = '2026-10-19T10:00:00.000Z';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'images-to-pdf-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** JPEG real de `width × height` con un color de relleno; el codificador de canvas no pone EXIF. */
function jpegOf(width: number, height: number, fill = '#3366cc'): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.encodeSync('jpeg', 90));
}

/** Inserta un APP1 «Exif» con una etiqueta de orientación (orden Intel) justo tras el SOI. */
function withExif(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = 2 + exif.length;
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...exif];
  return new Uint8Array([0xff, 0xd8, ...app1, ...jpeg.subarray(2)]);
}

/** RGBA de `width × height`; con `alpha` los píxeles alternan opaco y semitransparente. */
function rgbaOf(width: number, height: number, alpha: boolean): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = (p * 7) % 256;
    rgba[p * 4 + 1] = (p * 13) % 256;
    rgba[p * 4 + 2] = 90;
    rgba[p * 4 + 3] = alpha && p % 2 === 1 ? 128 : 255;
  }
  return { width, height, rgba };
}

function input(images: readonly ImageInput[], extra: Partial<ImagesToPdfInput> = {}): ImagesToPdfInput {
  return { images, pageSize: 'fit', margin: 0, now: NOW, ...extra };
}

/** Escribe el PDF en la carpeta temporal del test y devuelve su ruta. */
function write(bytes: Uint8Array, file: string): string {
  const path = join(dir, file);
  writeFileSync(path, bytes);
  return path;
}

/** Texto del fichero sin descomprimir: los diccionarios y los contenidos sin filtro quedan legibles. */
function asText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/** Números de la matriz `cm` del contenido de la página (sin filtro): `q a b c d e f cm /Im0 Do Q`. */
function cmMatrix(bytes: Uint8Array): number[] {
  const match = /q ([-\d. ]+) cm \/Im0 Do Q/.exec(asText(bytes));
  if (match?.[1] === undefined) throw new Error('no hay contenido de página reconocible');
  return match[1].trim().split(' ').map(Number);
}

async function pagesOf(bytes: Uint8Array): Promise<{ readonly numPages: number; readonly sizes: readonly (readonly [number, number])[]; readonly title: unknown }> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    const sizes: [number, number][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push([round(viewport.width), round(viewport.height)]);
    }
    const meta = await doc.getMetadata();
    return { numPages: doc.numPages, sizes, title: (meta.info as { Title?: unknown }).Title };
  } finally {
    await task.destroy();
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function build(images: readonly ImageInput[], extra: Partial<ImagesToPdfInput> = {}): Promise<Uint8Array> {
  const result = await buildPdfFromImages(input(images, extra));
  if (!result.ok) throw new Error(`buildPdfFromImages falló: ${result.error.code}`);
  return result.value.bytes;
}

describe('buildPdfFromImages: criterio original', () => {
  it('10 imágenes (6 JPEG y 4 RGBA) dan 10 páginas válidas y cada JPEG se incrusta byte a byte', async () => {
    const jpegs = Array.from({ length: 6 }, (_, i) => jpegOf(20 + i * 4, 16 + i * 3, `hsl(${i * 50} 60% 50%)`));
    const images: ImageInput[] = [
      ...jpegs.map((bytes, i) => ({ kind: 'jpeg' as const, name: `foto-${i}.jpg`, bytes })),
      ...Array.from({ length: 4 }, (_, i) => ({ kind: 'rgba' as const, name: `png-${i}.png`, image: rgbaOf(12 + i, 10, i % 2 === 0) })),
    ];
    const result = await buildPdfFromImages(input(images));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pages).toBe(10);

    const path = write(result.value.bytes, 'diez.pdf');
    expect(qpdfCheck(path).code).toBe(0);

    const dctNums = Object.entries(qpdfObjects(path))
      .filter(([, object]) => (object.stream?.dict as Record<string, unknown> | undefined)?.['/Filter'] === '/DCTDecode')
      .map(([key]) => Number(key.replace(/^obj:/, '').split(' ')[0]))
      .sort((a, b) => a - b);
    expect(dctNums).toHaveLength(6);
    for (const [i, num] of dctNums.entries()) {
      const raw = execFileSync('qpdf', [`--show-object=${num}`, '--raw-stream-data', path], { maxBuffer: 10_000_000 });
      expect(new Uint8Array(raw)).toEqual(jpegs[i]);
    }

    const pdf = await pagesOf(result.value.bytes);
    expect(pdf.numPages).toBe(10);
  });
});

describe('buildPdfFromImages: tamaño y matriz', () => {
  it('JPEG con EXIF 6 de 40×20 px en fit: página 9,6 × 19,2 pt y matriz [0 -19.2 9.6 0 0 19.2]', async () => {
    const bytes = await build([{ kind: 'jpeg', name: 'retrato.jpg', bytes: withExif(jpegOf(40, 20), 6) }]);
    expect(cmMatrix(bytes)).toEqual([0, -19.2, 9.6, 0, 0, 19.2]);
    const pdf = await pagesOf(bytes);
    expect(pdf.sizes).toEqual([[9.6, 19.2]]);
  });

  it.each([
    [1, [19.2, 0, 0, 9.6, 0, 0]],
    [2, [-19.2, 0, 0, 9.6, 19.2, 0]],
    [3, [-19.2, 0, 0, -9.6, 19.2, 9.6]],
    [4, [19.2, 0, 0, -9.6, 0, 9.6]],
    [5, [0, -19.2, -9.6, 0, 9.6, 19.2]],
    [6, [0, -19.2, 9.6, 0, 0, 19.2]],
    [7, [0, 19.2, 9.6, 0, 0, 0]],
    [8, [0, 19.2, -9.6, 0, 9.6, 0]],
  ])('orientación EXIF %i: matriz de la tabla de la ficha para un 40×20 px en fit', async (orientation, expected) => {
    const bytes = await build([{ kind: 'jpeg', name: 'orientada.jpg', bytes: withExif(jpegOf(40, 20), orientation) }]);
    expect(cmMatrix(bytes)).toEqual(expected);
  });

  it('más de 32 páginas se reparten en un árbol /Pages con nodos intermedios', async () => {
    const images: ImageInput[] = Array.from({ length: 33 }, (_, i) => ({ kind: 'rgba', name: `p-${i}.png`, image: rgbaOf(2, 2, false) }));
    const bytes = await build(images);
    const path = write(bytes, 'treinta-y-tres.pdf');
    expect(qpdfCheck(path).code).toBe(0);
    expect((await pagesOf(bytes)).numPages).toBe(33);
  });

  it('una imagen apaisada en A4 da página 841,89 × 595,28 y la centra dentro de los márgenes', async () => {
    const bytes = await build(
      [{ kind: 'rgba', name: 'paisaje.png', image: rgbaOf(3000, 1000, false) }],
      { pageSize: 'a4', margin: 36 },
    );
    const pdf = await pagesOf(bytes);
    expect(pdf.sizes).toEqual([[841.89, 595.28]]);

    const [a, , , d, e, f] = cmMatrix(bytes);
    const w = a ?? 0;
    const h = d ?? 0;
    const x = e ?? 0;
    const y = f ?? 0;
    expect(x).toBeGreaterThanOrEqual(36);
    expect(x + w).toBeLessThanOrEqual(841.89 - 36 + 0.001);
    expect(y).toBeGreaterThanOrEqual(36);
    expect(y + h).toBeLessThanOrEqual(595.28 - 36 + 0.001);
    expect(x - 36).toBeCloseTo(841.89 - 36 - (x + w), 3);
    expect(y - 36).toBeCloseTo(595.28 - 36 - (y + h), 3);
    // Imagen de 3000 px: se escala para caber en el ancho disponible (841,89 - 2 × 36 pt = 769,89 pt).
    expect(w).toBeCloseTo(769.89, 2);
  });

  it('en A4 no se amplía la imagen por encima de 150 ppp', async () => {
    const bytes = await build([{ kind: 'rgba', name: 'pequeña.png', image: rgbaOf(150, 100, false) }], { pageSize: 'a4', margin: 0 });
    const [a, , , d] = cmMatrix(bytes);
    expect(a).toBeCloseTo(150 * 72 / FIT_DPI, 4);
    expect(d).toBeCloseTo(100 * 72 / FIT_DPI, 4);
  });

  it('en Carta una imagen vertical da página 612 × 792', async () => {
    const bytes = await build([{ kind: 'rgba', name: 'vertical.png', image: rgbaOf(100, 300, false) }], { pageSize: 'letter', margin: 0 });
    expect((await pagesOf(bytes)).sizes).toEqual([[612, 792]]);
  });
});

describe('buildPdfFromImages: transparencia y título', () => {
  it('un RGBA con alfa lleva /SMask y uno opaco no', async () => {
    const withAlpha = await build([{ kind: 'rgba', name: 'a.png', image: rgbaOf(4, 2, true) }]);
    const opaque = await build([{ kind: 'rgba', name: 'o.png', image: rgbaOf(4, 2, false) }]);
    expect(asText(withAlpha)).toContain('/SMask');
    expect(asText(opaque)).not.toContain('/SMask');
  });

  it('el título de /Info es el nombre de la primera imagen sin extensión', async () => {
    const bytes = await build([
      { kind: 'rgba', name: 'escaneo-1.png', image: rgbaOf(2, 2, false) },
      { kind: 'rgba', name: 'otra.png', image: rgbaOf(2, 2, false) },
    ]);
    expect((await pagesOf(bytes)).title).toBe('escaneo-1');
  });

  it('informa del progreso por imagen y termina en (total, total)', async () => {
    const calls: [number, number][] = [];
    await build(
      [
        { kind: 'rgba', name: 'a.png', image: rgbaOf(2, 2, false) },
        { kind: 'rgba', name: 'b.png', image: rgbaOf(2, 2, false) },
        { kind: 'rgba', name: 'c.png', image: rgbaOf(2, 2, false) },
      ],
      { onProgress: (done, total) => calls.push([done, total]) },
    );
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});

describe('buildPdfFromImages: errores', () => {
  it('JPEG corrupto da invalid-image', async () => {
    const result = await buildPdfFromImages(input([{ kind: 'jpeg', name: 'roto.jpg', bytes: new Uint8Array([0xff, 0xd8, 0x00, 0x01]) }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-image');
  });

  it('RGBA que no cuadra con sus dimensiones da invalid-image', async () => {
    const result = await buildPdfFromImages(input([{ kind: 'rgba', name: 'x.png', image: { width: 2, height: 2, rgba: new Uint8Array(4) } }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-image');
  });

  it('lista vacía o con más de 500 imágenes da organize-invalid', async () => {
    const empty = await buildPdfFromImages(input([]));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('organize-invalid');

    const one: ImageInput = { kind: 'rgba', name: 'x.png', image: rgbaOf(1, 1, false) };
    const many = await buildPdfFromImages(input(Array.from({ length: 501 }, () => one)));
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error.code).toBe('organize-invalid');
  });

  it('una señal abortada da cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await buildPdfFromImages(input([{ kind: 'rgba', name: 'x.png', image: rgbaOf(1, 1, false) }], { signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cancelled');
  });

  it('un margen o un tamaño de página fuera de rango es un bug del llamante', async () => {
    const image: ImageInput = { kind: 'rgba', name: 'x.png', image: rgbaOf(1, 1, false) };
    await expect(buildPdfFromImages(input([image], { margin: 100 }))).rejects.toThrow(RangeError);
    await expect(buildPdfFromImages(input([image], { pageSize: 'a5' as 'a4' }))).rejects.toThrow(RangeError);
  });
});

describe('jpegDensity', () => {
  /** JPEG mínimo con APP0 JFIF y las unidades y densidades indicadas, seguido de SOF0 de 1×1. */
  function jfif(units: number, x: number, y: number, identifier = [0x4a, 0x46, 0x49, 0x46, 0]): Uint8Array {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...identifier, 1, 1, units, x >> 8, x & 0xff, y >> 8, y & 0xff, 0, 0];
    const sof = [0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0];
    return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
  }

  it('densidad en pulgadas dentro de [72, 1200]', () => {
    expect(jpegDensity(jfif(1, 300, 300))).toBe(300);
  });

  it('densidad en centímetros se convierte a pulgadas', () => {
    expect(jpegDensity(jfif(2, 118, 118))).toBeCloseTo(118 * 2.54, 6);
  });

  it('densidad fuera de rango, sin unidades o sin JFIF da null', () => {
    expect(jpegDensity(jfif(1, 50, 50))).toBeNull();
    expect(jpegDensity(jfif(1, 2000, 2000))).toBeNull();
    expect(jpegDensity(jfif(0, 300, 300))).toBeNull();
    expect(jpegDensity(jfif(1, 300, 300, [0x45, 0x78, 0x69, 0x66, 0]))).toBeNull();
  });

  it('un fichero que no es JPEG da null', () => {
    expect(jpegDensity(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('un JPEG sin densidad usa FIT_DPI para fit: 1 px = 72 / 150 pt', async () => {
    const bytes = await build([{ kind: 'jpeg', name: 'sin-densidad.jpg', bytes: jfif(0, 1, 1) }]);
    const pdf = await pagesOf(bytes);
    const expected = round((1 * 72) / FIT_DPI);
    expect(pdf.sizes).toEqual([[expected, expected]]);
  });
});

describe('DOC_OPS images-to-pdf', () => {
  it('crea el PDF con los argumentos de la app y devuelve bytes y páginas', async () => {
    const ctx: OpContext = {
      sources: [],
      signal: new AbortController().signal,
      progress: () => undefined,
    };
    const result = await DOC_OPS['images-to-pdf']?.({
      images: [{ kind: 'rgba', name: 'op.png', image: rgbaOf(3, 3, false) }],
      pageSize: 'fit',
      margin: 0,
      now: NOW,
    }, ctx);
    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    const value = result.value as { bytes: Uint8Array; pages: number };
    expect(value.pages).toBe(1);
    expect(Buffer.from(value.bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('argumentos mal formados son un TypeError (bug de la app)', async () => {
    const ctx: OpContext = { sources: [], signal: new AbortController().signal, progress: () => undefined };
    await expect(DOC_OPS['images-to-pdf']?.({ images: [] }, ctx)).rejects.toThrow(TypeError);
  });
});
