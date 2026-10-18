/**
 * Image XObjects (ISO 32000-1 §8.9) a partir de píxeles RGBA o de un JPEG. Son funciones puras: no
 * escriben nada, devuelven objetos PDF listos para serializar. El canal alfa va a un `/SMask` gris.
 * Un JPEG se incrusta tal cual (`/DCTDecode`), sin decodificar ni recomprimir.
 */
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import { flateEncode } from './filters';
import { name, stream, type PdfRef, type PdfStream, type PdfValue } from './objects';

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Píxeles fila a fila, 4 bytes por píxel (R, G, B, A). `rgba.length === width * height * 4`. */
  readonly rgba: Uint8Array;
}

export interface ImageObjects {
  /** Image XObject RGB con `/SMask` si hay transparencia. */
  readonly image: PdfStream;
  /** Máscara de alfa en gris, o `null` si todos los píxeles son opacos. */
  readonly smask: PdfStream | null;
}

const OPAQUE = 255;

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} no válido: ${value}`);
  }
}

/**
 * Image XObject RGB (FlateDecode) + SMask gris (FlateDecode). Si todos los alfa son 255, `smask` es
 * `null` y la imagen no lleva `/SMask`. `smaskRef` es el número de objeto que el llamante asignará a
 * la máscara cuando la escriba. Lanza `RangeError` si las dimensiones o el tamaño de `rgba` no cuadran
 * (es un bug del llamante).
 */
export function rgbaImageObjects(img: RgbaImage, smaskRef: PdfRef): ImageObjects {
  const { width, height, rgba } = img;
  assertDimension(width, 'ancho');
  assertDimension(height, 'alto');
  const pixels = width * height;
  if (rgba.length !== pixels * 4) {
    throw new RangeError(`rgba.length ${rgba.length} no coincide con ${width}x${height}x4`);
  }

  const color = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let opaque = true;
  for (let p = 0; p < pixels; p++) {
    const src = p * 4;
    const dst = p * 3;
    color[dst] = rgba[src] ?? 0;
    color[dst + 1] = rgba[src + 1] ?? 0;
    color[dst + 2] = rgba[src + 2] ?? 0;
    const a = rgba[src + 3] ?? OPAQUE;
    alpha[p] = a;
    if (a !== OPAQUE) opaque = false;
  }

  const base: Record<string, PdfValue> = {
    Type: name('XObject'),
    Subtype: name('Image'),
    Width: width,
    Height: height,
  };

  if (opaque) {
    const image = stream(
      { ...base, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8, Filter: name('FlateDecode') },
      flateEncode(color),
    );
    return { image, smask: null };
  }

  const image = stream(
    { ...base, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8, Filter: name('FlateDecode'), SMask: smaskRef },
    flateEncode(color),
  );
  const smask = stream(
    { ...base, ColorSpace: name('DeviceGray'), BitsPerComponent: 8, Filter: name('FlateDecode') },
    flateEncode(alpha),
  );
  return { image, smask };
}

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  readonly components: 1 | 3 | 4;
}

const MARKER_PREFIX = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const SOF_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);

/** Marcadores sin longitud: SOI, EOI, TEM (0x01) y RST0-RST7 (0xD0-0xD7). */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || marker === SOI || marker === EOI || (marker >= 0xd0 && marker <= 0xd7);
}

function u16(bytes: Uint8Array, at: number): number | undefined {
  const hi = bytes[at];
  const lo = bytes[at + 1];
  if (hi === undefined || lo === undefined) return undefined;
  return (hi << 8) | lo;
}

/**
 * Dimensiones y número de componentes de un JPEG leyendo su segmento SOF (`FFC0`, `FFC1` o `FFC2`).
 * Devuelve `null` si no es un JPEG válido, si está truncado antes del SOF o si tiene 1, 3 o 4
 * componentes distintos. Nunca lanza.
 */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes[0] !== MARKER_PREFIX || bytes[1] !== SOI) return null;
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== MARKER_PREFIX) return null;
    // Rellenos: varios FF seguidos antes del código de marcador.
    while (bytes[at] === MARKER_PREFIX) at += 1;
    const marker = bytes[at];
    if (marker === undefined) return null;
    at += 1;
    if (marker === EOI || marker === SOS) return null;
    if (isStandalone(marker)) continue;

    const length = u16(bytes, at);
    if (length === undefined || length < 2) return null;
    const segmentEnd = at + length;
    if (segmentEnd > bytes.length) return null;

    if (SOF_MARKERS.has(marker)) {
      // Cuerpo del SOF: [longitud 2][precisión 1][alto 2][ancho 2][componentes 1].
      if (length < 8) return null;
      const height = u16(bytes, at + 3);
      const width = u16(bytes, at + 5);
      const components = bytes[at + 7];
      if (height === undefined || width === undefined || components === undefined) return null;
      if (width === 0 || height === 0) return null;
      if (components !== 1 && components !== 3 && components !== 4) return null;
      return { width, height, components };
    }
    at = segmentEnd;
  }
  return null;
}

/**
 * Image XObject con los bytes JPEG tal cual (`/DCTDecode`). 1 componente → `/DeviceGray`,
 * 3 → `/DeviceRGB`, 4 → `/DeviceCMYK` con `/Decode [1 0 1 0 1 0 1 0]`. Devuelve `invalid-image` si
 * `readJpegInfo` no reconoce el fichero.
 */
export function jpegImageObject(bytes: Uint8Array): Result<PdfStream> {
  const info = readJpegInfo(bytes);
  if (info === null) return err(pdfError('invalid-image'));

  const colorSpace = info.components === 1 ? 'DeviceGray' : info.components === 3 ? 'DeviceRGB' : 'DeviceCMYK';
  const entries: Record<string, PdfValue> = {
    Type: name('XObject'),
    Subtype: name('Image'),
    Width: info.width,
    Height: info.height,
    ColorSpace: name(colorSpace),
    BitsPerComponent: 8,
    Filter: name('DCTDecode'),
  };
  if (info.components === 4) {
    entries.Decode = [1, 0, 1, 0, 1, 0, 1, 0];
  }
  return ok(stream(entries, bytes));
}
