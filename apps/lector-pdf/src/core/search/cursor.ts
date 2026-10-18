/** Coincidencia actual: página (0-based) y posición dentro de las coincidencias de esa página. */
export interface MatchCursor {
  readonly page: number;
  readonly index: number;
}

/**
 * Siguiente (`direction` 1) o anterior (`-1`) coincidencia en orden global (página, posición), con vuelta al
 * principio o al final. `pages` son las páginas con coincidencias, ordenadas de menor a mayor; `countOf` da
 * el número de coincidencias de una página. Sin coincidencia actual, la siguiente es la primera y la anterior
 * la última. Devuelve `null` si no hay ninguna coincidencia.
 */
export function stepCursor(
  pages: readonly number[],
  countOf: (page: number) => number,
  current: MatchCursor | null,
  direction: 1 | -1,
): MatchCursor | null {
  const count = pages.length;
  if (count === 0) return null;

  const pos = current === null ? -1 : pages.indexOf(current.page);
  if (current === null || pos < 0) {
    const page = direction === 1 ? pages[0] : pages[count - 1];
    if (page === undefined) return null;
    return direction === 1 ? { page, index: 0 } : { page, index: Math.max(0, countOf(page) - 1) };
  }

  if (direction === 1) {
    if (current.index + 1 < countOf(current.page)) return { page: current.page, index: current.index + 1 };
    const page = pages[(pos + 1) % count];
    return page === undefined ? null : { page, index: 0 };
  }

  if (current.index > 0) return { page: current.page, index: current.index - 1 };
  const page = pages[(pos - 1 + count) % count];
  return page === undefined ? null : { page, index: Math.max(0, countOf(page) - 1) };
}

/** Número de orden (1-based) de la coincidencia `cursor` en el recorrido global de `pages`. 0 si no existe. */
export function matchOrdinal(pages: readonly number[], countOf: (page: number) => number, cursor: MatchCursor): number {
  let before = 0;
  for (const page of pages) {
    if (page === cursor.page) {
      return cursor.index < countOf(page) ? before + cursor.index + 1 : 0;
    }
    if (page > cursor.page) return 0;
    before += countOf(page);
  }
  return 0;
}
