/**
 * Firma de imagen (PDF-086, ADR-0020): decisiones puras sobre el formato y el tamaño. La decodificación
 * (`createImageBitmap`, canvas) está en la UI.
 */
import { deflateSync } from 'fflate';
import type { SignatureArt } from '../annotations/model';
import { toBase64 } from '../base64';

/** Ancho máximo, en píxeles, de la imagen de una firma. */
export const MAX_SIGNATURE_IMAGE_WIDTH = 1200;

/** Un JPEG empieza por FF D8 FF. */
export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Orientación EXIF (etiqueta 0x0112, 1..8) de un JPEG. Vale 1 si no hay bloque EXIF, la etiqueta falta o los datos
 * están truncados. Solo recorre las cabeceras hasta el primer marcador de datos (SOS) o de fin (EOI).
 */
export function jpegExifOrientation(bytes: Uint8Array): number {
  if (!isJpegBytes(bytes)) return 1;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1;
    const marker = bytes[p + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = readU16(bytes, p + 2, false) ?? 0;
    if (length < 2) return 1;
    const end = p + 2 + length;
    if (marker === 0xe1 && isExifHeader(bytes, p + 4)) return exifOrientationOf(bytes, p + 10, Math.min(end, bytes.length));
    p = end;
  }
  return 1;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const TAG_ORIENTATION = 0x0112;

function isExifHeader(bytes: Uint8Array, at: number): boolean {
  return EXIF_HEADER.every((b, i) => bytes[at + i] === b);
}

/** Lee la orientación de la cabecera TIFF que empieza en `tiff` y termina en `end` (sin incluirlo). */
function exifOrientationOf(bytes: Uint8Array, tiff: number, end: number): number {
  const byteOrder = bytes[tiff];
  if (byteOrder !== 0x49 && byteOrder !== 0x4d) return 1;
  const little = byteOrder === 0x49;
  if (readU16(bytes, tiff + 2, little) !== 0x2a) return 1;
  const ifd = tiff + (readU32(bytes, tiff + 4, little) ?? 0);
  const count = readU16(bytes, ifd, little) ?? 0;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (readU16(bytes, entry, little) !== TAG_ORIENTATION) continue;
    const value = readU16(bytes, entry + 8, little) ?? 1;
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

function readU16(bytes: Uint8Array, at: number, little: boolean): number | null {
  const a = bytes[at];
  const b = bytes[at + 1];
  if (a === undefined || b === undefined) return null;
  return little ? a | (b << 8) : (a << 8) | b;
}

function readU32(bytes: Uint8Array, at: number, little: boolean): number | null {
  const first = readU16(bytes, at, little);
  const second = readU16(bytes, at + 2, little);
  if (first === null || second === null) return null;
  return little ? first | (second << 16) : (first << 16) | second;
}

/** Un JPEG se guarda tal cual solo si no supera el ancho máximo. */
export function keepsJpeg(width: number): boolean {
  return width <= MAX_SIGNATURE_IMAGE_WIDTH;
}

/** Tamaño reducido a `maxWidth` de ancho conservando la proporción; sin cambios si ya cabe. */
export function fitWidth(width: number, height: number, maxWidth: number): { readonly width: number; readonly height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/** Firma `rgba-deflate` a partir de píxeles RGBA. `null` si el número de bytes no cuadra con el tamaño. */
export function rgbaArt(rgba: Uint8Array, width: number, height: number): SignatureArt | null {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) return null;
  return {
    kind: 'image',
    format: 'rgba-deflate',
    data: toBase64(deflateSync(rgba)),
    pixelWidth: width,
    pixelHeight: height,
  };
}

/** Firma `jpeg` con los bytes del fichero tal cual. */
export function jpegArt(bytes: Uint8Array, width: number, height: number): SignatureArt {
  return { kind: 'image', format: 'jpeg', data: toBase64(bytes), pixelWidth: width, pixelHeight: height };
}
