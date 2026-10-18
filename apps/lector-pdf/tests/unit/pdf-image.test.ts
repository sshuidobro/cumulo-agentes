import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { PDF_ERROR_MESSAGES } from '../../src/core/errors';
import { decodeStreamData } from '../../src/core/pdf/filters';
import {
  jpegImageObject,
  readJpegInfo,
  rgbaImageObjects,
  type RgbaImage,
} from '../../src/core/pdf/image';
import { dictGet, name, ref, withEntries, type PdfStream } from '../../src/core/pdf/objects';
import { serializeValue } from '../../src/core/pdf/serialize';
import { PdfBuilder } from '../fixtures/pdf-builder';

interface JpegOptions {
  readonly width?: number;
  readonly height?: number;
  readonly components?: number;
  /** Marcador SOF (C0 baseline, C1 extendido, C2 progresivo, C3 sin soporte). */
  readonly marker?: number;
  /** Longitud declarada del segmento SOF; por defecto la correcta (8 + 3 por componente). */
  readonly sofLength?: number;
  /** Antepone FF de relleno y un marcador RST0 (standalone) antes de APP0. */
  readonly fillAndRst?: boolean;
}

/** JPEG mínimo a mano: SOI, [relleno], APP0 de 14 bytes, SOF y EOI. No se puede decodificar, solo leer. */
function jpegBytes(opts: JpegOptions = {}): Uint8Array {
  const width = opts.width ?? 2;
  const height = opts.height ?? 3;
  const components = opts.components ?? 3;
  const sofLength = opts.sofLength ?? 8 + 3 * components;
  const sof: number[] = [
    0xff, opts.marker ?? 0xc0, sofLength >> 8, sofLength & 0xff,
    8, height >> 8, height & 0xff, width >> 8, width & 0xff, components,
  ];
  for (let c = 0; c < components; c++) sof.push(c + 1, 0x11, 0);
  const prefix = opts.fillAndRst === true ? [0xff, 0xff, 0xff, 0xd0] : [];
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...prefix, ...app0, ...sof, 0xff, 0xd9]);
}

/** Fin del SOF del JPEG por defecto: SOI (2) + APP0 (18) = 20 bytes, más un SOF de 19 bytes. */
const DEFAULT_SOF_END = 39;

/** Imagen 4×2: dos rojos opacos, dos transparentes y cuatro con alfa variable. */
const IMG_4X2: RgbaImage = {
  width: 4,
  height: 2,
  rgba: new Uint8Array([
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 9, 9, 9, 0,
    0, 255, 0, 128, 0, 0, 255, 64, 10, 20, 30, 200, 40, 50, 60, 1,
  ]),
};

const SMASK_REF = ref(6);

function decoded(s: PdfStream): Uint8Array {
  return decodeStreamData(s);
}

describe('rgbaImageObjects', () => {
  it('convierte RGBA en RGB de 24 bytes y alfa en SMask de 8 bytes, en orden', () => {
    const { image, smask } = rgbaImageObjects(IMG_4X2, SMASK_REF);

    expect(Array.from(decoded(image))).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0, 0, 9, 9, 9,
      0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60,
    ]);

    expect(smask).not.toBeNull();
    expect(Array.from(decoded(smask as PdfStream))).toEqual([255, 255, 0, 0, 128, 64, 200, 1]);
  });

  it('escribe /SMask con la referencia indicada y el diccionario de imagen correcto', () => {
    const { image, smask } = rgbaImageObjects(IMG_4X2, SMASK_REF);

    expect(dictGet(image.dict, 'SMask')).toEqual(SMASK_REF);
    expect(dictGet(image.dict, 'Type')).toEqual(name('XObject'));
    expect(dictGet(image.dict, 'Subtype')).toEqual(name('Image'));
    expect(dictGet(image.dict, 'Width')).toBe(4);
    expect(dictGet(image.dict, 'Height')).toBe(2);
    expect(dictGet(image.dict, 'ColorSpace')).toEqual(name('DeviceRGB'));
    expect(dictGet(image.dict, 'BitsPerComponent')).toBe(8);
    expect(dictGet(image.dict, 'Filter')).toEqual(name('FlateDecode'));

    expect(dictGet((smask as PdfStream).dict, 'ColorSpace')).toEqual(name('DeviceGray'));
    expect(dictGet((smask as PdfStream).dict, 'Filter')).toEqual(name('FlateDecode'));
    expect(dictGet((smask as PdfStream).dict, 'SMask')).toBeUndefined();
  });

  it('si todos los alfa son 255, smask es null y la imagen no lleva /SMask', () => {
    const opaque: RgbaImage = {
      width: 2,
      height: 1,
      rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
    };
    const { image, smask } = rgbaImageObjects(opaque, SMASK_REF);

    expect(smask).toBeNull();
    expect(dictGet(image.dict, 'SMask')).toBeUndefined();
    expect(Array.from(decoded(image))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('un único píxel transparente basta para crear la SMask', () => {
    const almostOpaque: RgbaImage = {
      width: 1,
      height: 1,
      rgba: new Uint8Array([10, 10, 10, 254]),
    };
    const { image, smask } = rgbaImageObjects(almostOpaque, SMASK_REF);

    expect(smask).not.toBeNull();
    expect(dictGet(image.dict, 'SMask')).toEqual(SMASK_REF);
    expect(Array.from(decoded(smask as PdfStream))).toEqual([254]);
  });

  it('lanza RangeError si las dimensiones no son enteros positivos', () => {
    const base = { rgba: new Uint8Array(4) };
    expect(() => rgbaImageObjects({ ...base, width: 0, height: 1 }, SMASK_REF)).toThrow(RangeError);
    expect(() => rgbaImageObjects({ ...base, width: 1, height: -1 }, SMASK_REF)).toThrow(RangeError);
    expect(() => rgbaImageObjects({ ...base, width: 1.5, height: 1 }, SMASK_REF)).toThrow(RangeError);
    expect(() => rgbaImageObjects({ ...base, width: 1, height: Number.NaN }, SMASK_REF)).toThrow(RangeError);
  });

  it('lanza RangeError si rgba no mide width × height × 4', () => {
    expect(() => rgbaImageObjects({ width: 2, height: 2, rgba: new Uint8Array(15) }, SMASK_REF)).toThrow(RangeError);
    expect(() => rgbaImageObjects({ width: 2, height: 2, rgba: new Uint8Array(17) }, SMASK_REF)).toThrow(RangeError);
  });
});

describe('readJpegInfo', () => {
  it('lee ancho, alto y componentes del SOF', () => {
    expect(readJpegInfo(jpegBytes())).toEqual({ width: 2, height: 3, components: 3 });
  });

  it('reconoce 1 y 4 componentes y los SOF extendido y progresivo', () => {
    expect(readJpegInfo(jpegBytes({ components: 1 }))).toEqual({ width: 2, height: 3, components: 1 });
    expect(readJpegInfo(jpegBytes({ components: 4, width: 640, height: 480 }))).toEqual({
      width: 640,
      height: 480,
      components: 4,
    });
    expect(readJpegInfo(jpegBytes({ marker: 0xc1 }))).toEqual({ width: 2, height: 3, components: 3 });
    expect(readJpegInfo(jpegBytes({ marker: 0xc2 }))).toEqual({ width: 2, height: 3, components: 3 });
  });

  it('salta rellenos FF y marcadores sin longitud antes del SOF', () => {
    expect(readJpegInfo(jpegBytes({ fillAndRst: true }))).toEqual({ width: 2, height: 3, components: 3 });
  });

  it('devuelve null para un PNG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    expect(readJpegInfo(png)).toBeNull();
  });

  it('devuelve null para cualquier prefijo truncado antes del final del SOF y nunca lanza', () => {
    const full = jpegBytes();
    for (let k = 0; k < DEFAULT_SOF_END; k++) {
      expect(readJpegInfo(full.subarray(0, k))).toBeNull();
    }
    expect(readJpegInfo(full.subarray(0, DEFAULT_SOF_END))).toEqual({ width: 2, height: 3, components: 3 });
  });

  it('devuelve null con componentes distintos de 1, 3 o 4', () => {
    expect(readJpegInfo(jpegBytes({ components: 2 }))).toBeNull();
  });

  it('devuelve null con dimensiones 0 o un SOF de longitud insuficiente', () => {
    expect(readJpegInfo(jpegBytes({ width: 0 }))).toBeNull();
    expect(readJpegInfo(jpegBytes({ height: 0 }))).toBeNull();
    expect(readJpegInfo(jpegBytes({ sofLength: 6 }))).toBeNull();
  });

  it('devuelve null si no empieza por SOI, si hay EOI o SOS antes del SOF y si un segmento es inválido', () => {
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([]))).toBeNull();
  });
});

describe('jpegImageObject', () => {
  it('JPEG RGB: /DCTDecode, /DeviceRGB y los bytes originales', () => {
    const bytes = jpegBytes();
    const result = jpegImageObject(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.value;
    expect(dictGet(s.dict, 'Filter')).toEqual(name('DCTDecode'));
    expect(dictGet(s.dict, 'ColorSpace')).toEqual(name('DeviceRGB'));
    expect(dictGet(s.dict, 'Width')).toBe(2);
    expect(dictGet(s.dict, 'Height')).toBe(3);
    expect(dictGet(s.dict, 'Decode')).toBeUndefined();
    expect(s.data).toEqual(bytes);
  });

  it('JPEG en gris: /DeviceGray', () => {
    const result = jpegImageObject(jpegBytes({ components: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dictGet(result.value.dict, 'ColorSpace')).toEqual(name('DeviceGray'));
  });

  it('JPEG CMYK: /DeviceCMYK con /Decode [1 0 1 0 1 0 1 0] y datos sin recomprimir', () => {
    const bytes = jpegBytes({ components: 4, width: 5, height: 7 });
    const result = jpegImageObject(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.value;
    expect(dictGet(s.dict, 'ColorSpace')).toEqual(name('DeviceCMYK'));
    expect(dictGet(s.dict, 'Decode')).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(s.data).toEqual(bytes);
    expect(dictGet(s.dict, 'Length')).toBe(bytes.length);
  });

  it('devuelve invalid-image con el mensaje en español si no es un JPEG válido', () => {
    const result = jpegImageObject(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid-image', message: PDF_ERROR_MESSAGES['invalid-image'] },
    });
    expect(PDF_ERROR_MESSAGES['invalid-image']).toBe(
      'La imagen no es válida o no está en un formato admitido (PNG o JPEG).',
    );
  });
});

/** Diccionario de un objeto serializado como texto, sin `/Length` (lo añade `PdfBuilder.addStream`). */
function dictText(stream: PdfStream): string {
  return Buffer.from(serializeValue(withEntries(stream.dict, { Length: undefined }))).toString('latin1');
}

/** PDF de una página que pinta la imagen RGBA 4×2 (con SMask) estirada a 400×200 puntos. */
function pdfWithRgbaImage(): Uint8Array {
  const { image, smask } = rgbaImageObjects(IMG_4X2, SMASK_REF);
  if (smask === null) throw new Error('la imagen de prueba debe tener transparencia');

  const builder = new PdfBuilder();
  const catalog = builder.alloc();
  const pages = builder.alloc();
  const page = builder.alloc();
  // Numeración: contenido 4, imagen 5 y SMask 6 (= SMASK_REF), en el orden en que se añaden.
  const content = builder.addStream('<< >>', 'q 400 0 0 200 0 100 cm /Im1 Do Q');
  const imageNum = builder.addStream(dictText(image), image.data);
  const smaskNum = builder.addStream(dictText(smask), smask.data);
  expect([content, imageNum, smaskNum]).toEqual([4, 5, SMASK_REF.num]);

  builder.setObject(catalog, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.setObject(pages, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.setObject(
    page,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R ' +
      '/Resources << /XObject << /Im1 5 0 R >> >> >>',
  );
  return builder.build({ root: catalog });
}

describe('PDF con la imagen RGBA', () => {
  it('pasa qpdf --check y pdf.js lee la página sin error', async () => {
    const bytes = pdfWithRgbaImage();

    const dir = mkdtempSync(join(tmpdir(), 'pdf-image ñ-'));
    const path = join(dir, 'imagen rgba.pdf');
    writeFileSync(path, bytes);
    execFileSync('qpdf', ['--check', path], { stdio: 'pipe' });

    const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const operators = await page.getOperatorList();
      expect(operators.fnArray).toContain(OPS.paintImageXObject);
    } finally {
      await task.destroy();
    }
  });
});
