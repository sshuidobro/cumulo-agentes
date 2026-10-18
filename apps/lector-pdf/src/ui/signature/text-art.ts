/**
 * Firma escrita (PDF-086): el texto se dibuja con Dancing Script a 4× y se convierte en píxeles RGBA.
 * La fuente va incluida en el bundle (`@fontsource`), no se pide a ninguna red.
 */
import type { SignatureArt } from '../../core/annotations/model';
import { rgbaArt } from '../../core/signature/image-art';

export const SIGNATURE_FONT_FAMILY = 'Dancing Script';
/** Tamaño de la letra de la firma en píxeles de la vista previa (la rasterización usa 4× esa cifra). */
export const SIGNATURE_TEXT_PREVIEW_PX = 48;
const RASTER_SCALE = 4;
/** Margen alrededor del texto, en píxeles de la rasterización. */
const PAD = 16;

/** Firma `rgba-deflate` del texto, o `null` si el texto está vacío o no hay canvas en el entorno. */
export async function rasterizeSignatureText(text: string): Promise<SignatureArt | null> {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const font = `${String(SIGNATURE_TEXT_PREVIEW_PX * RASTER_SCALE)}px "${SIGNATURE_FONT_FAMILY}"`;
  await document.fonts.load(font, trimmed);

  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (measure === null) return null;
  measure.font = font;
  const metrics = measure.measureText(trimmed);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent);
  const width = Math.ceil(metrics.width) + 2 * PAD;
  const height = ascent + descent + 2 * PAD;

  // Redimensionar el lienzo borra su contexto: el texto se dibuja después.
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.font = font;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(trimmed, PAD, PAD + ascent);
  const pixels = ctx.getImageData(0, 0, width, height);
  return rgbaArt(new Uint8Array(pixels.data.buffer), width, height);
}
