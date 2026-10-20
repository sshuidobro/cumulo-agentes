/**
 * Redacción de imágenes parcialmente cubiertas (PDF-136): los píxeles de la zona se ponen a negro en una copia de la
 * imagen que usa solo esa página, sin convertir la página en imagen. Los PDF se construyen en el test.
 */
import { memorySource } from '@suite/platform';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { interpretPage } from '../../../src/core/content';
import { concatSource } from '../../../src/core/pdf/concat-source';
import { effectiveResources } from '../../../src/core/pdf/page-content';
import { decodeStreamData } from '../../../src/core/pdf/filters';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from '../../../src/core/pdf/objects';
import { rewriteDocument } from '../../../src/core/pdf/rewrite';
import { buildRedactionUpdate, planRedaction, type RedactArea } from '../../../src/core/redact/apply';
import { PdfBuilder } from '../../fixtures/pdf-builder';

const NOW = '2026-10-20T10:00:00.000Z';
/** Página de 612 × 792 pt con una imagen en el origen (`cm` según el caso) y un texto. */
const TEXT_OPS = 'BT /F1 24 Tf 72 700 Td (Texto) Tj ET';

/** Redacta `data` con `areas` y `replacements` y devuelve el PDF reescrito completo. */
async function redact(
  data: Uint8Array,
  areas: readonly RedactArea[],
  replacements = new Map<string, Uint8Array>(),
): Promise<Uint8Array> {
  const source = memorySource(data);
  const reader = await ObjectReader.open(source);
  const built = await buildRedactionUpdate({ source, reader, areas, rasterPages: new Map(), imageReplacements: replacements, now: NOW });
  if (!built.ok) throw new Error(built.error.code);
  const reopened = await ObjectReader.open(concatSource(source, built.value.delta));
  const written = await rewriteDocument({ reader: reopened, encryption: null, keepEncryption: true, now: NOW });
  if (!written.ok) throw new Error(written.error.code);
  return written.value.bytes;
}

/** Imagen RGB de `width`×`height` con un color distinto por píxel (ningún canal vale 0). */
function rgbGradient(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      out[at] = (x % 250) + 1;
      out[at + 1] = (y % 250) + 1;
      out[at + 2] = 200;
    }
  }
  return out;
}

/** Página con `content` y un XObject `Im0` de imagen `flate` RGB (`width`×`height`, con `extra` en su diccionario). */
function flatePage(content: string, width: number, height: number, pixels: Uint8Array, extra = ''): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const image = b.addStream(
    `<< /Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${extra} >>`,
    pixels,
    { compress: true },
  );
  const contents = b.addStream('<< >>', content);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
  b.setObject(
    page,
    `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${String(font)} 0 R >> /XObject << /Im0 ${String(image)} 0 R >> >> ` +
      `/Contents ${String(contents)} 0 R >>`,
  );
  return b.build({ root: catalog });
}

/** Dos páginas que dibujan la misma imagen JPEG `Im0` (en las dos el mismo objeto). Las dos tienen texto. */
function sharedJpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page1 = b.alloc();
  const page2 = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const image = b.addStream(
    `<< /Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`,
    jpeg,
  );
  const resources = `<< /Font << /F1 ${String(font)} 0 R >> /XObject << /Im0 ${String(image)} 0 R >> >>`;
  const draw = 'q 300 0 0 300 0 0 cm /Im0 Do Q ' + TEXT_OPS;
  const content1 = b.addStream('<< >>', draw);
  const content2 = b.addStream('<< >>', draw);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${String(page1)} 0 R ${String(page2)} 0 R] /Count 2 >>`);
  for (const [page, contents] of [[page1, content1], [page2, content2]] as const) {
    b.setObject(
      page,
      `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${String(contents)} 0 R >>`,
    );
  }
  return b.build({ root: catalog });
}

/** JPEG RGB de `width`×`height` (fondo blanco) con `paint` dibujado encima. */
function jpegOf(width: number, height: number, paint: (ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>) => void): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  paint(ctx);
  const encoded = canvas.encodeSync('jpeg', 90);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

function asDict(value: PdfValue | undefined): PdfDict {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && value.kind === 'dict') return value;
  throw new Error('se esperaba un diccionario');
}

function asRef(value: PdfValue | undefined): PdfRef {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && value.kind === 'ref') return value;
  throw new Error('se esperaba una referencia');
}

function asStream(value: PdfValue): PdfStream {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && value.kind === 'stream') return value;
  throw new Error('se esperaba un flujo');
}

/** Referencia del XObject `name` de la página `index` (recursos efectivos). */
async function xobjectRef(reader: ObjectReader, index: number, name: string): Promise<PdfRef> {
  const pageDict = await reader.getDict(await reader.pageRef(index));
  if (pageDict === null) throw new Error('página ilegible');
  const resources = await effectiveResources(reader, pageDict);
  return asRef(asDict(dictGet(resources, 'XObject')).entries.get(name));
}

/** Pixeles RGB descomprimidos del flujo de imagen que referencia `ref`. */
async function pixelsOf(reader: ObjectReader, ref: PdfRef): Promise<Uint8Array> {
  return decodeStreamData(asStream(await reader.get(ref)));
}

describe('redacción de imágenes Flate parcialmente cubiertas', () => {
  it('pone a negro solo los píxeles de la zona y la página conserva su texto', async () => {
    const width = 100;
    const height = 100;
    const original = rgbGradient(width, height);
    const data = flatePage(`q 200 0 0 200 0 0 cm /Im0 Do Q ${TEXT_OPS}`, width, height, original, '');
    // Cuarto superior izquierdo de la imagen: x ∈ [0, 100), y ∈ [100, 200) de la página (la imagen ocupa 200×200).
    const out = await redact(data, [{ pageIndex: 0, rect: [0, 100, 100, 200] }]);

    const reader = await ObjectReader.open(memorySource(out));
    const ref = await xobjectRef(reader, 0, 'Im0');
    const pixels = await pixelsOf(reader, ref);
    expect(pixels.length).toBe(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 3;
        // Zona de la prueba: píxeles [0, 50) × [0, 50) de la imagen.
        const inZone = x < 50 && y < 50;
        const expected = inZone ? [0, 0, 0] : [original[at], original[at + 1], original[at + 2]];
        expect([pixels[at], pixels[at + 1], pixels[at + 2]]).toEqual(expected);
      }
    }

    const pageDict = await reader.getDict(await reader.pageRef(0));
    if (pageDict === null) throw new Error('página ilegible');
    const interpreted = await interpretPage(reader, pageDict);
    expect(interpreted.glyphs.length).toBeGreaterThan(0);
    expect(interpreted.images.length).toBe(1);
  });

  it('un segundo uso de la imagen fuera de la zona no añade píxeles a redactar', async () => {
    const width = 100;
    const height = 100;
    const data = flatePage(
      `q 200 0 0 200 0 0 cm /Im0 Do Q q 50 0 0 50 300 300 cm /Im0 Do Q`,
      width,
      height,
      rgbGradient(width, height),
    );
    const reader = await ObjectReader.open(memorySource(data));
    const plan = await planRedaction(reader, [{ pageIndex: 0, rect: [0, 100, 100, 200] }]);
    expect(plan).toEqual({
      ok: true,
      value: [
        {
          pageIndex: 0,
          raster: false,
          partialImages: [{ name: 'Im0', kind: 'flate', width, height, pixelRects: [[0, 0, 50, 50]] }],
        },
      ],
    });
  });
});

describe('redacción de imágenes JPEG compartidas', () => {
  const width = 200;
  const height = 200;
  const original = jpegOf(width, height, () => undefined);
  const painted = jpegOf(width, height, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width / 2, height);
  });

  it('la página con la zona usa un objeto nuevo con el JPEG dado; la otra sigue con el original', async () => {
    const data = sharedJpegPdf(original, width, height);
    // Zona en la mitad izquierda de la imagen, solo en la página 1 (índice 0). El reescrito renumera los objetos,
    // así que se compara el contenido de cada imagen y que las dos páginas apuntan a objetos distintos.
    const out = await redact(data, [{ pageIndex: 0, rect: [0, 0, 150, 300] }], new Map([['0:Im0', painted]]));

    const reader = await ObjectReader.open(memorySource(out));
    const newRef = await xobjectRef(reader, 0, 'Im0');
    const sharedRef = await xobjectRef(reader, 1, 'Im0');
    expect(newRef.num).not.toBe(sharedRef.num);
    expect(asStream(await reader.get(newRef)).data).toEqual(painted);
    expect(asStream(await reader.get(sharedRef)).data).toEqual(original);
    expect(Buffer.from(out).includes(Buffer.from(painted))).toBe(true);
  });

  it('falta el JPEG pintado de una imagen parcialmente cubierta → organize-invalid', async () => {
    const source = memorySource(sharedJpegPdf(original, width, height));
    const reader = await ObjectReader.open(source);
    const built = await buildRedactionUpdate({
      source,
      reader,
      areas: [{ pageIndex: 0, rect: [0, 0, 150, 300] }],
      rasterPages: new Map(),
      imageReplacements: new Map(),
      now: NOW,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe('organize-invalid');
  });

  it('la imagen JPEG parcial se planifica como jpeg con sus bytes y sus zonas', async () => {
    const reader = await ObjectReader.open(memorySource(sharedJpegPdf(original, width, height)));
    const plan = await planRedaction(reader, [{ pageIndex: 0, rect: [0, 0, 150, 300] }]);
    expect(plan).toEqual({
      ok: true,
      value: [
        {
          pageIndex: 0,
          raster: false,
          partialImages: [{ name: 'Im0', kind: 'jpeg', width, height, pixelRects: [[0, 0, 100, 200]], jpeg: original }],
        },
      ],
    });
  });
});

describe('imágenes que obligan a convertir la página en imagen', () => {
  const pixels = rgbGradient(4, 4);

  it('una imagen girada 90° por la CTM marca la página como imagen', async () => {
    const data = flatePage('q 0 200 -200 0 200 0 cm /Im0 Do Q', 4, 4, pixels);
    const reader = await ObjectReader.open(memorySource(data));
    expect(await planRedaction(reader, [{ pageIndex: 0, rect: [0, 0, 100, 100] }])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: true, partialImages: [] }],
    });
  });

  it('una imagen con /SMask marca la página como imagen', async () => {
    const data = flatePage('q 200 0 0 200 0 0 cm /Im0 Do Q', 4, 4, pixels, '/SMask 99 0 R');
    const reader = await ObjectReader.open(memorySource(data));
    expect(await planRedaction(reader, [{ pageIndex: 0, rect: [0, 100, 100, 200] }])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: true, partialImages: [] }],
    });
  });
});

describe('pixelRects', () => {
  it('imagen colocada con desplazamiento y escala no uniforme: recorte y redondeo hacia fuera', async () => {
    // Imagen de 60×40 píxeles en x ∈ [10, 310), y ∈ [20, 120) (escala 300 × 100 pt, desplazada a (10, 20)).
    const data = flatePage('q 300 0 0 100 10 20 cm /Im0 Do Q', 60, 40, rgbGradient(60, 40));
    const reader = await ObjectReader.open(memorySource(data));
    // Zona x ∈ [40, 130), y ∈ [60, 120): en la imagen, u ∈ [0.1, 0.4] → columnas [6, 24); v ∈ [0.4, 1] → filas [0, 24).
    const plan = await planRedaction(reader, [{ pageIndex: 0, rect: [40, 60, 130, 120] }]);
    expect(plan).toEqual({
      ok: true,
      value: [
        {
          pageIndex: 0,
          raster: false,
          partialImages: [{ name: 'Im0', kind: 'flate', width: 60, height: 40, pixelRects: [[6, 0, 24, 24]] }],
        },
      ],
    });
  });

  it('una zona que solo roza la imagen no produce píxeles', async () => {
    const data = flatePage('q 200 0 0 200 0 0 cm /Im0 Do Q', 4, 4, rgbGradient(4, 4));
    const reader = await ObjectReader.open(memorySource(data));
    // Zona que cruza el borde derecho de la imagen (x = 200) pero solo entra 1e-12 pt.
    const plan = await planRedaction(reader, [{ pageIndex: 0, rect: [199.999999999999, 0, 300, 300] }]);
    expect(plan).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: false, partialImages: [{ name: 'Im0', kind: 'flate', width: 4, height: 4, pixelRects: [] }] }],
    });
  });
});
