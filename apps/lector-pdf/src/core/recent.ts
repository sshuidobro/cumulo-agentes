/** Cuántos recientes se muestran en la pantalla de inicio y en el menú «Abrir recientes» (PDF-049). */
export const RECENT_SHOWN = 10;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Fecha relativa de un reciente, en hora local: «hoy, 10:42», «ayer», «12 oct» (con el año si no es este).
 * Una fecha futura (reloj desviado) se trata como de hoy.
 */
export function formatRecentDate(openedAt: number, now: number): string {
  const opened = new Date(openedAt);
  const current = new Date(now);
  const days = Math.round((startOfDay(current) - startOfDay(opened)) / DAY_MS);
  if (days <= 0) {
    return `hoy, ${String(opened.getHours()).padStart(2, '0')}:${String(opened.getMinutes()).padStart(2, '0')}`;
  }
  if (days === 1) return 'ayer';
  const month = MONTHS[opened.getMonth()] ?? '';
  const day = String(opened.getDate());
  return opened.getFullYear() === current.getFullYear() ? `${day} ${month}` : `${day} ${month} ${String(opened.getFullYear())}`;
}

/**
 * Carpeta de una ruta absoluta (Windows o POSIX), sin el nombre del fichero.
 * Una ruta sin carpeta (o vacía) devuelve cadena vacía.
 */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (cut < 0) return '';
  // Un fichero en la raíz («/a.pdf») conserva el separador como carpeta: «/».
  return cut === 0 ? path.slice(0, 1) : path.slice(0, cut);
}
