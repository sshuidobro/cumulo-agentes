import { linkTargetFromAnnotation, type LinkTarget } from '../core/links';
import type { PDFPageProxy } from './pdfjs';

/** Enlace de una página: rectángulo en puntos PDF `[x1, y1, x2, y2]` y su destino clasificado. */
export interface PageLink {
  readonly rect: readonly [number, number, number, number];
  readonly target: LinkTarget;
}

/**
 * Enlaces de la página (anotaciones `Link` con su aspecto de pantalla). Los enlaces sin rectángulo válido se descartan.
 */
export async function getPageLinks(page: PDFPageProxy): Promise<PageLink[]> {
  const annotations: readonly unknown[] = await page.getAnnotations({ intent: 'display' });
  const links: PageLink[] = [];
  for (const raw of annotations) {
    if (!isRecord(raw) || raw.subtype !== 'Link') continue;
    const rect = rectOf(raw.rect);
    if (rect === null) continue;
    links.push({ rect, target: linkTargetFromAnnotation(raw) });
  }
  return links;
}

function rectOf(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [x1, y1, x2, y2] = value as readonly unknown[];
  if (![x1, y1, x2, y2].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return [x1, y1, x2, y2] as [number, number, number, number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
