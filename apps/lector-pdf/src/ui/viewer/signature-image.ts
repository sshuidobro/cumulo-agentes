/**
 * URL de la imagen de una firma para la capa SVG (ADR-0020). Un JPEG va tal cual como data URL. Una firma
 * `rgba-deflate` se descomprime y se pinta en un canvas para obtener un PNG. El resultado se cachea por
 * objeto de firma: el dibujo de la capa no repite el trabajo en cada render.
 */
import { useMemo } from 'react';
import { fromBase64 } from '../../core/base64';
import type { SignatureArt } from '../../core/annotations/model';
import { inflateSync } from 'fflate';

type ImageArt = Extract<SignatureArt, { readonly kind: 'image' }>;

/** `null` en la caché = no se pudo pintar (datos no decodificables o sin canvas). */
const urlCache = new WeakMap<ImageArt, string | null>();

/** URL de la imagen de la firma, o `null` si no se puede obtener (datos dañados o sin canvas en el entorno). */
export function signatureImageUrl(art: ImageArt): string | null {
  const cached = urlCache.get(art);
  if (cached !== undefined) return cached;
  const url = computeImageUrl(art);
  urlCache.set(art, url);
  return url;
}

/** URL de la imagen de una firma; para firmas dibujadas (`ink`) no hay imagen y devuelve `null`. */
export function useSignatureImageUrl(art: SignatureArt): string | null {
  return useMemo(() => (art.kind === 'image' ? signatureImageUrl(art) : null), [art]);
}

function computeImageUrl(art: ImageArt): string | null {
  if (art.format === 'jpeg') return `data:image/jpeg;base64,${art.data}`;
  const bytes = fromBase64(art.data);
  if (bytes === null) return null;
  let rgba: Uint8Array;
  try {
    rgba = inflateSync(bytes);
  } catch {
    return null;
  }
  const { pixelWidth: width, pixelHeight: height } = art;
  if (rgba.length !== width * height * 4) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const pixels = ctx.createImageData(width, height);
  pixels.data.set(rgba);
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
