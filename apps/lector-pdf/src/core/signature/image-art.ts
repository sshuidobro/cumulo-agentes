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
