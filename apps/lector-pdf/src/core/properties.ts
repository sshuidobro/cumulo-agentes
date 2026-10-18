import { parsePdfDate } from './pdf-date';

/** Lo que devuelve el motor sin interpretar: diccionario /Info, título XMP y si el documento está etiquetado. */
export interface RawProperties {
  readonly info: Readonly<Record<string, unknown>>;
  readonly xmpTitle: string | null;
  readonly tagged: boolean | null;
}

/** Tamaño de página en puntos PDF, ya con /Rotate aplicado (en vertical o apaisado según la página). */
export interface PageSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

/** Datos del fichero y de la apertura que no vienen del diccionario /Info. */
export interface FileFacts {
  readonly fileName: string;
  readonly path: string | null;
  readonly fileSize: number;
  readonly pageCount: number;
  readonly pageSize: PageSize;
}

/** Propiedades del documento listas para mostrar (PDF-045). Las cadenas vacías se muestran como «—». */
export interface DocumentProperties {
  readonly fileName: string;
  readonly path: string | null;
  readonly fileSize: number;
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: string;
  readonly creator: string;
  readonly producer: string;
  /** Fecha de creación en ISO 8601 (UTC), o null si no existe o no es válida. */
  readonly created: string | null;
  /** Fecha de modificación en ISO 8601 (UTC), o null si no existe o no es válida. */
  readonly modified: string | null;
  readonly pdfVersion: string;
  readonly pageCount: number;
  readonly pageSize: PageSize;
  /** `null` si el documento no declara si está etiquetado. */
  readonly tagged: boolean | null;
  /** Vista web rápida: el PDF está linealizado. */
  readonly fastWebView: boolean;
  readonly encrypted: boolean;
  /** Tiene campos de formulario (AcroForm o XFA). */
  readonly hasForm: boolean;
}

const PT_PER_MM = 72 / 25.4;

/** Tamaños de papel estándar en milímetros, lado corto y lado largo. */
const STANDARD_SIZES: readonly { readonly name: string; readonly shortMm: number; readonly longMm: number }[] = [
  { name: 'A3', shortMm: 297, longMm: 420 },
  { name: 'A4', shortMm: 210, longMm: 297 },
  { name: 'A5', shortMm: 148, longMm: 210 },
  { name: 'Carta', shortMm: 215.9, longMm: 279.4 },
  { name: 'Legal', shortMm: 215.9, longMm: 355.6 },
];

/** Tolerancia en milímetros para reconocer un tamaño de papel estándar. */
const SIZE_TOLERANCE_MM = 1;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' ? parsePdfDate(value) : null;
}

/**
 * Une los datos crudos con los del fichero. Título: `/Title` y, si está vacío, el título XMP.
 * Las fechas pasan por `parsePdfDate`; lo que no se entiende queda como ausente.
 */
export function buildProperties(raw: RawProperties, facts: FileFacts): DocumentProperties {
  const info = raw.info;
  const infoTitle = text(info.Title);
  const encryptFilter = text(info.EncryptFilterName);
  return {
    fileName: facts.fileName,
    path: facts.path,
    fileSize: facts.fileSize,
    title: infoTitle !== '' ? infoTitle : (raw.xmpTitle ?? '').trim(),
    author: text(info.Author),
    subject: text(info.Subject),
    keywords: text(info.Keywords),
    creator: text(info.Creator),
    producer: text(info.Producer),
    created: isoDate(info.CreationDate),
    modified: isoDate(info.ModDate),
    pdfVersion: text(info.PDFFormatVersion),
    pageCount: facts.pageCount,
    pageSize: facts.pageSize,
    tagged: raw.tagged,
    fastWebView: info.IsLinearized === true,
    encrypted: encryptFilter !== '',
    hasForm: info.IsAcroFormPresent === true || info.IsXFAPresent === true,
  };
}

/** Milímetros con una decimal y coma, sin ceros sobrantes: 210 → «210», 70,5556 → «70,6», 215,9 → «215,9». */
function formatMm(mm: number): string {
  return String(Math.round(mm * 10) / 10).replace('.', ',');
}

/**
 * Tamaño de página legible: «A4 (210 × 297 mm)» en vertical, «A4 (297 × 210 mm)» apaisado, o las medidas
 * en mm si no es un tamaño estándar («70,6 × 35,3 mm»). Una página sin tamaño válido muestra «—».
 */
export function formatPageSize(widthPt: number, heightPt: number): string {
  if (!(widthPt > 0) || !(heightPt > 0)) return '—';
  const widthMm = widthPt / PT_PER_MM;
  const heightMm = heightPt / PT_PER_MM;
  const shortMm = Math.min(widthMm, heightMm);
  const longMm = Math.max(widthMm, heightMm);
  const landscape = widthPt > heightPt;
  const standard = STANDARD_SIZES.find(
    (s) => Math.abs(shortMm - s.shortMm) <= SIZE_TOLERANCE_MM && Math.abs(longMm - s.longMm) <= SIZE_TOLERANCE_MM,
  );
  if (standard !== undefined) {
    const first = landscape ? standard.longMm : standard.shortMm;
    const second = landscape ? standard.shortMm : standard.longMm;
    return `${standard.name} (${formatMm(first)} × ${formatMm(second)} mm)`;
  }
  return `${formatMm(widthMm)} × ${formatMm(heightMm)} mm`;
}

const BINARY_UNITS = ['KB', 'MB', 'GB'] as const;

/** Miles con punto, como en español: 1775941 → «1.775.941». */
function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Tamaño de fichero con unidades binarias: «1,7 MB (1.775.941 bytes)», «820 KB (839.680 bytes)»;
 * por debajo de 1 KB, «512 bytes».
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  const shown = value.toFixed(digits).replace('.', ',');
  return `${shown} ${BINARY_UNITS[unit] ?? 'GB'} (${groupThousands(bytes)} bytes)`;
}
