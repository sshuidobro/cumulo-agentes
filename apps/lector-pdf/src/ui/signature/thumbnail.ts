/** Miniaturas de las firmas guardadas (PDF-086): URL de imagen para el menú. */
import type { SignatureArt } from '../../core/annotations/model';
import { signatureImageUrl } from '../viewer/signature-image';

type InkArt = Extract<SignatureArt, { readonly kind: 'ink' }>;

/** SVG en data URL con los trazos de una firma dibujada, en la caja de la firma. */
export function inkThumbnailUrl(art: InkArt): string {
  const [width, height] = art.box;
  const paths = art.paths.map((path) => {
    let d = '';
    for (let i = 0; i + 1 < path.length; i += 2) {
      d += `${i === 0 ? 'M' : 'L'}${String(path[i] ?? 0)} ${String(path[i + 1] ?? 0)}`;
    }
    return `<path d="${d}" fill="none" stroke="#000" stroke-width="${String(art.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}">${paths.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Miniatura de cualquier firma; `null` si una firma de imagen no se puede pintar. */
export function signatureThumbnailUrl(art: SignatureArt): string | null {
  return art.kind === 'ink' ? inkThumbnailUrl(art) : signatureImageUrl(art);
}
