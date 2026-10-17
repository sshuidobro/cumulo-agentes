/**
 * Filtros de flujos PDF (ISO 32000-1 §7.4): FlateDecode con predictores TIFF (2) y PNG (10-15).
 * Cualquier otro filtro se rechaza con `PdfSyntaxError`; no se inventan datos.
 */
import { inflateSync, unzlibSync, zlibSync } from 'fflate';
import { dictGet, PdfSyntaxError, type PdfDict, type PdfStream, type PdfValue } from './objects';

const FLATE_DECODE = 'FlateDecode';

function isName(v: PdfValue | undefined): v is { readonly kind: 'name'; readonly value: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name';
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isArray(v: PdfValue | undefined): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function unsupported(names: readonly string[]): PdfSyntaxError {
  return new PdfSyntaxError(`Filtro no soportado: ${names.join(', ')}`, 0);
}

/** Nombres de `/Filter` (nombre suelto o array). Ausente → lista vacía. */
function filterNames(v: PdfValue | undefined): string[] {
  if (v === undefined || v === null) return [];
  if (isName(v)) return [v.value];
  if (isArray(v)) {
    return v.map((item) => {
      if (isName(item)) return item.value;
      throw new PdfSyntaxError('/Filter no válido: se esperaban nombres', 0);
    });
  }
  throw new PdfSyntaxError('/Filter no válido: se esperaban nombres', 0);
}

/** `/DecodeParms` puede ser un diccionario o un array con un diccionario (un único filtro). */
function decodeParms(v: PdfValue | undefined): PdfDict | null {
  if (isDict(v)) return v;
  if (isArray(v) && isDict(v[0])) return v[0];
  return null;
}

function intParm(parms: PdfDict | null, key: string, fallback: number): number {
  const v = parms === null ? undefined : dictGet(parms, key);
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) return v;
  throw new PdfSyntaxError(`/DecodeParms /${key} no válido`, 0);
}

/** Descomprime zlib; si la cabecera no es válida, reintenta con deflate crudo. */
function inflate(data: Uint8Array): Uint8Array {
  try {
    return unzlibSync(data);
  } catch {
    try {
      return inflateSync(data);
    } catch {
      throw new PdfSyntaxError('Flujo FlateDecode dañado', 0);
    }
  }
}

/** Predictor TIFF (/Predictor 2), solo 8 bits por componente: diferencias horizontales por componente. */
function unpredictTiff(data: Uint8Array, colors: number, columns: number): Uint8Array {
  const rowLength = colors * columns;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const x = i % rowLength;
    const left = x >= colors ? (out[i - colors] ?? 0) : 0;
    out[i] = ((data[i] ?? 0) + left) & 0xff;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Predictor PNG (/Predictor 10-15): cada fila empieza con un byte de filtro (0 None, 1 Sub,
 * 2 Up, 3 Average, 4 Paeth). Una última fila incompleta se decodifica con los bytes que hay.
 */
function unpredictPng(data: Uint8Array, colors: number, bitsPerComponent: number, columns: number): Uint8Array {
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((columns * colors * bitsPerComponent) / 8);
  const rows = Math.ceil(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let inPos = 0;
  let outLength = 0;
  for (let row = 0; row < rows; row++) {
    const filter = data[inPos] ?? 0;
    inPos += 1;
    const rowStart = row * rowLength;
    const count = Math.min(rowLength, data.length - inPos);
    for (let x = 0; x < count; x++) {
      const raw = data[inPos + x] ?? 0;
      const left = x >= bytesPerPixel ? (out[rowStart + x - bytesPerPixel] ?? 0) : 0;
      const up = row > 0 ? (out[rowStart - rowLength + x] ?? 0) : 0;
      const upLeft = row > 0 && x >= bytesPerPixel ? (out[rowStart - rowLength + x - bytesPerPixel] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + ((left + up) >> 1); break;
        case 4: value = raw + paeth(left, up, upLeft); break;
        default: throw new PdfSyntaxError(`Predictor PNG no válido: ${filter}`, 0);
      }
      out[rowStart + x] = value & 0xff;
    }
    inPos += count;
    outLength = rowStart + count;
    if (count < rowLength) break;
  }
  return out.slice(0, outLength);
}

function unpredict(data: Uint8Array, parms: PdfDict | null): Uint8Array {
  const predictor = intParm(parms, 'Predictor', 1);
  if (predictor === 1) return data;
  const colors = intParm(parms, 'Colors', 1);
  const bitsPerComponent = intParm(parms, 'BitsPerComponent', 8);
  const columns = intParm(parms, 'Columns', 1);
  if (predictor === 2) {
    if (bitsPerComponent !== 8) {
      throw new PdfSyntaxError('Predictor TIFF solo admite 8 bits por componente', 0);
    }
    return unpredictTiff(data, colors, columns);
  }
  if (predictor >= 10 && predictor <= 15) return unpredictPng(data, colors, bitsPerComponent, columns);
  throw new PdfSyntaxError(`Predictor no soportado: ${predictor}`, 0);
}

/**
 * Datos decodificados de un flujo: sin `/Filter` se devuelven tal cual; con `/FlateDecode`
 * (único filtro) se descomprimen y se les aplica el predictor de `/DecodeParms`.
 */
export function decodeStreamData(s: PdfStream): Uint8Array {
  const names = filterNames(dictGet(s.dict, 'Filter'));
  if (names.length === 0) return s.data;
  if (names.length !== 1 || names[0] !== FLATE_DECODE) throw unsupported(names);
  const inflated = inflate(s.data);
  return unpredict(inflated, decodeParms(dictGet(s.dict, 'DecodeParms')));
}

/** Comprime con zlib (nivel 6) para escribir flujos FlateDecode. */
export function flateEncode(data: Uint8Array): Uint8Array {
  return zlibSync(data, { level: 6 });
}
