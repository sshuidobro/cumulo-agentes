/**
 * Fechas de PDF (`D:YYYYMMDDHHmmSSOHH'mm'`, ISO 32000 §7.9.4). Todo en UTC.
 */

const PDF_DATE = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)(?:00'00'?)?|([+-])(\d{2})(?:'(\d{2})'?)?)?$/;

/** Fecha PDF → ISO 8601 en UTC; `null` si no es válida. Las partes que faltan valen su mínimo. */
export function parsePdfDate(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const m = PDF_DATE.exec(s);
  if (m === null) return null;
  const [, year = '', month = '01', day = '01', hour = '00', minute = '00', second = '00', , sign, offH = '00', offM = '00'] = m;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  // Desbordamientos (p. ej. 31 de febrero) se detectan comparando con lo pedido.
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offH) > 23 ||
    Number(offM) > 59
  ) {
    return null;
  }
  const offsetMin = sign === undefined ? 0 : (Number(offH) * 60 + Number(offM)) * (sign === '+' ? 1 : -1);
  return new Date(date.getTime() - offsetMin * 60_000).toISOString();
}

/** ISO 8601 → `D:YYYYMMDDHHmmSSZ` (UTC, sin milisegundos). Lanza `RangeError` si la fecha no es válida. */
export function toPdfDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`fecha no válida: ${iso}`);
  const p = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
