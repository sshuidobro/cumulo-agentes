/**
 * Anchos y altura de glifos de una fuente de página (ISO 32000-1 §9.2, §9.6.2 y §9.7.4). Solo soporta fuentes simples
 * (`Type1`, `MMType1`, `TrueType`) y `Type0` con `/Identity-H`. Lo demás se devuelve como `null` (no medido).
 */
import { HELVETICA_WIDTHS } from '../annotations/helvetica-widths';
import type { ObjectReader } from '../pdf/object-reader';
import { dictGet, type PdfDict, type PdfValue } from '../pdf/objects';

export interface FontMetrics {
  readonly bytesPerCode: 1 | 2;
  /** Ancho del código en milésimas de unidad de texto. */
  width(code: number): number;
  /** Altura mínima y máxima del glifo en milésimas (descendente negativo). */
  readonly descent: number;
  readonly ascent: number;
}

/** Ancho de Courier (monoespaciada) en milésimas. */
const COURIER_WIDTH = 600;
/** Ancho por defecto de `/DW` en CIDFonts (ISO 32000-1 §9.7.4.3). */
const DEFAULT_DW = 1000;
/** Ancho usado para un código WinAnsi sin entrada en la tabla de Helvetica: se prefiere tapar de más. */
const UNKNOWN_WIDTH = 1000;
/** Altura mínima por debajo y máxima por encima de la línea de base (milésimas). */
const MIN_DESCENT = -250;
const MAX_ASCENT = 750;
const WIN_ANSI = new TextDecoder('windows-1252');
const HELVETICA_NAME = /^(Helvetica|Arial)(MT)?([-,][A-Za-z]+)?$/;
const COURIER_NAME = /^Courier(New)?(PS)?(MT)?([-,][A-Za-z]+)?$/;
const SUBSET_PREFIX = /^[A-Z]{6}\+/;

interface Range {
  readonly first: number;
  readonly last: number;
  readonly width: number;
}

/** null = fuente no soportada (Type3, Type0 con CMap distinta de /Identity-H, o simple sin /Widths y no estándar). */
export async function loadFontMetrics(reader: ObjectReader, font: PdfDict): Promise<FontMetrics | null> {
  const subtype = nameOf(await reader.resolve(dictGet(font, 'Subtype')));
  if (subtype === 'Type0') return type0Metrics(reader, font);
  if (subtype === 'Type1' || subtype === 'MMType1' || subtype === 'TrueType') return simpleMetrics(reader, font);
  return null;
}

async function simpleMetrics(reader: ObjectReader, font: PdfDict): Promise<FontMetrics | null> {
  const descriptor = await dictOf(reader, dictGet(font, 'FontDescriptor'));
  const heights = heightsOf(await numberOf(reader, descriptor, 'Descent'), await numberOf(reader, descriptor, 'Ascent'));
  const widths = await reader.resolve(dictGet(font, 'Widths'));
  if (Array.isArray(widths)) {
    const first = (await numberOf(reader, font, 'FirstChar')) ?? 0;
    const missing = (await numberOf(reader, descriptor, 'MissingWidth')) ?? 0;
    const values: number[] = [];
    for (const item of widths) values.push((await numberOfValue(reader, item)) ?? missing);
    return {
      bytesPerCode: 1,
      width: (code) => {
        const value = values[code - first];
        return code >= first && value !== undefined ? value : missing;
      },
      ...heights,
    };
  }
  const base = baseFontName(await reader.resolve(dictGet(font, 'BaseFont')));
  if (base === null) return null;
  if (HELVETICA_NAME.test(base)) {
    return { bytesPerCode: 1, width: helveticaWidth, ...heights };
  }
  if (COURIER_NAME.test(base)) {
    return { bytesPerCode: 1, width: () => COURIER_WIDTH, ...heights };
  }
  return null;
}

async function type0Metrics(reader: ObjectReader, font: PdfDict): Promise<FontMetrics | null> {
  if (nameOf(await reader.resolve(dictGet(font, 'Encoding'))) !== 'Identity-H') return null;
  const descendants = await reader.resolve(dictGet(font, 'DescendantFonts'));
  const first = Array.isArray(descendants) ? await dictOf(reader, descendants[0]) : null;
  if (first === null) return null;
  const descriptor = await dictOf(reader, dictGet(first, 'FontDescriptor'));
  const heights = heightsOf(await numberOf(reader, descriptor, 'Descent'), await numberOf(reader, descriptor, 'Ascent'));
  const defaultWidth = (await numberOf(reader, first, 'DW')) ?? DEFAULT_DW;
  const { exact, ranges } = await parseW(reader, await reader.resolve(dictGet(first, 'W')));
  return {
    bytesPerCode: 2,
    width: (code) => {
      const exactWidth = exact.get(code);
      if (exactWidth !== undefined) return exactWidth;
      const range = ranges.find((r) => code >= r.first && code <= r.last);
      return range?.width ?? defaultWidth;
    },
    ...heights,
  };
}

/** Formatos de `/W`: `c [w1 w2 …]` y `c1 c2 w` (ISO 32000-1 §9.7.4.3). */
async function parseW(
  reader: ObjectReader,
  w: PdfValue | undefined,
): Promise<{ readonly exact: ReadonlyMap<number, number>; readonly ranges: readonly Range[] }> {
  const exact = new Map<number, number>();
  const ranges: Range[] = [];
  if (!Array.isArray(w)) return { exact, ranges };
  let i = 0;
  while (i < w.length) {
    const start = await numberOfValue(reader, w[i]);
    const second = await reader.resolve(w[i + 1]);
    if (start === null) break;
    if (Array.isArray(second)) {
      for (let k = 0; k < second.length; k += 1) {
        const width = await numberOfValue(reader, second[k]);
        if (width !== null) exact.set(start + k, width);
      }
      i += 2;
      continue;
    }
    const last = await numberOfValue(reader, second);
    const width = await numberOfValue(reader, w[i + 2]);
    if (last === null || width === null) break;
    ranges.push({ first: start, last, width });
    i += 3;
  }
  return { exact, ranges };
}

/** Anchos de Helvetica por código WinAnsi (tabla de `annotations/helvetica-widths`). */
function helveticaWidth(code: number): number {
  const char = WIN_ANSI.decode(Uint8Array.of(code & 0xff));
  return HELVETICA_WIDTHS[char] ?? UNKNOWN_WIDTH;
}

/** Descendente y ascendente ampliados: como mínimo -250 y 750. */
function heightsOf(descent: number | null, ascent: number | null): { readonly descent: number; readonly ascent: number } {
  return {
    descent: Math.min(descent ?? 0, MIN_DESCENT),
    ascent: Math.max(ascent ?? 0, MAX_ASCENT),
  };
}

/** Nombre base sin prefijo de subconjunto (`ABCDEF+`). */
function baseFontName(value: PdfValue | undefined): string | null {
  const name = nameOf(value);
  return name === null ? null : name.replace(SUBSET_PREFIX, '');
}

function nameOf(value: PdfValue | undefined): string | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && value.kind === 'name'
    ? value.value
    : null;
}

async function dictOf(reader: ObjectReader, value: PdfValue | undefined): Promise<PdfDict | null> {
  const resolved = await reader.resolve(value);
  return typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved) && 'kind' in resolved && resolved.kind === 'dict'
    ? resolved
    : null;
}

async function numberOf(reader: ObjectReader, dict: PdfDict | null, key: string): Promise<number | null> {
  return dict === null ? null : numberOfValue(reader, dictGet(dict, key));
}

async function numberOfValue(reader: ObjectReader, value: PdfValue | undefined): Promise<number | null> {
  const resolved = await reader.resolve(value);
  return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : null;
}
