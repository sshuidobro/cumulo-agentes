/** Un número de página o un extremo de rango que se puede leer: solo dígitos. */
const PAGE_NUMBER = /^\d+$/;
/** Un rango «a-b», «a–b» o «a-» (hasta el final). Admite espacios alrededor del guion. */
const RANGE = /^(\d+)\s*[-–]\s*(\d*)$/;

/**
 * "1-3, 5, 8-" → índices 0-based ordenados y sin repetir. Admite espacios, «–», y «8-» = hasta el final.
 * Un rango al revés («3–1») se acepta. `null` si hay algo no válido o fuera de [1, numPages].
 */
export function parsePageRange(text: string, numPages: number): readonly number[] | null {
  if (!Number.isSafeInteger(numPages) || numPages < 1) return null;
  if (text.trim() === '') return null;

  const found = new Set<number>();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    const pages = parsePart(part, numPages);
    if (pages === null) return null;
    for (const page of pages) found.add(page);
  }
  return [...found].sort((a, b) => a - b);
}

/** Páginas (0-based) de un elemento de la lista, o `null` si no es válido. */
function parsePart(part: string, numPages: number): readonly number[] | null {
  if (PAGE_NUMBER.test(part)) {
    const page = toPage(part, numPages);
    return page === null ? null : [page];
  }

  const match = RANGE.exec(part);
  if (match === null) return null;
  const from = toPage(match[1] ?? '', numPages);
  // «8-» llega hasta la última página: su índice 0-based es numPages - 1.
  const to = match[2] === '' || match[2] === undefined ? numPages - 1 : toPage(match[2], numPages);
  if (from === null || to === null) return null;

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** Número de página (1-based, dígitos) → índice 0-based, o `null` si está fuera de [1, numPages]. */
function toPage(digits: string, numPages: number): number | null {
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 1 || n > numPages) return null;
  return n - 1;
}
