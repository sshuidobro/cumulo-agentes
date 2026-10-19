/** Formato de fecha de los comentarios y respuestas (PDF-033, PDF-109). */
const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });

/** Fecha ISO en el formato de los comentarios; cadena vacía si no es una fecha válida. */
export function formatCommentDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : DATE_FORMAT.format(time);
}
