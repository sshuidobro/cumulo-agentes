/**
 * Nombres y modos de las partes de «Dividir» y «Extraer» (PDF-054). Módulo sin imports: la interfaz lo carga en el
 * arranque y no debe arrastrar el motor PDF (`split.ts`, solo usado por el Worker).
 */

export type SplitMode =
  | { readonly kind: 'pages'; readonly every: number }
  | { readonly kind: 'bookmarks' }
  | { readonly kind: 'size'; readonly maxBytes: number };

/** Tamaños de parte que ofrece la interfaz, en MB. */
export const SPLIT_SIZES_MB = [1, 2, 5, 10, 25, 50, 100] as const;

/** «informe-parte-01.pdf»… con cifras = max(2, cifras de `count`). */
export function splitPartNames(base: string, count: number): readonly string[] {
  const width = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_, i) => `${base}-parte-${String(i + 1).padStart(width, '0')}.pdf`);
}

/**
 * Páginas 0-based → «informe-paginas-3-7.pdf» si son consecutivas, «informe-paginas-3.pdf» si es una,
 * «informe-extracto.pdf» si no.
 */
export function extractFileName(base: string, pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return `${base}-extracto.pdf`;
  if (!pages.every((page, i) => page === first + i)) return `${base}-extracto.pdf`;
  if (pages.length === 1) return `${base}-paginas-${first + 1}.pdf`;
  return `${base}-paginas-${first + 1}-${last + 1}.pdf`;
}

/** «informe-partes.zip». */
export function splitZipName(base: string): string {
  return `${base}-partes.zip`;
}
