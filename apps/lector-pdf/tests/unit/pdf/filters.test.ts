import { describe, expect, it } from 'vitest';
import { decodeStreamData, flateEncode } from '../../../src/core/pdf/filters';
import { dict, name, PdfSyntaxError, stream, type PdfValue } from '../../../src/core/pdf/objects';
import { raw } from './helpers';

/** Flujo con los filtros y parámetros dados; los datos ya están codificados. */
function flowWith(entries: Record<string, PdfValue>, data: Uint8Array) {
  return stream(entries, data);
}

/** Codificación PNG con filtro Up (2) en todas las filas, para `columns` bytes por fila. */
function encodePngUp(data: Uint8Array, rowLength: number): Uint8Array {
  const rows = data.length / rowLength;
  const out = new Uint8Array(rows * (rowLength + 1));
  for (let r = 0; r < rows; r++) {
    out[r * (rowLength + 1)] = 2;
    for (let x = 0; x < rowLength; x++) {
      const above = r > 0 ? (data[(r - 1) * rowLength + x] ?? 0) : 0;
      out[r * (rowLength + 1) + 1 + x] = ((data[r * rowLength + x] ?? 0) - above) & 0xff;
    }
  }
  return out;
}

function sample(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
}

describe('decodeStreamData · sin filtro', () => {
  it('devuelve los datos tal cual cuando no hay /Filter', () => {
    const data = raw([1, 2, 3, 4]);
    expect(decodeStreamData(flowWith({}, data))).toBe(data);
  });

  it('acepta /Filter como array vacío sin decodificar', () => {
    const data = raw([9, 8]);
    expect(decodeStreamData(flowWith({ Filter: [] }, data))).toBe(data);
  });
});

describe('decodeStreamData · FlateDecode', () => {
  it('descomprime /FlateDecode como nombre y como array de un elemento', () => {
    const original = sample(500);
    const encoded = flateEncode(original);
    expect(decodeStreamData(flowWith({ Filter: name('FlateDecode') }, encoded))).toEqual(original);
    expect(decodeStreamData(flowWith({ Filter: [name('FlateDecode')] }, encoded))).toEqual(original);
  });

  it('decodifica deflate crudo cuando la cabecera zlib no es válida', () => {
    const original = sample(300);
    const zlib = flateEncode(original);
    const rawDeflate = zlib.slice(2, zlib.length - 4);
    expect(decodeStreamData(flowWith({ Filter: name('FlateDecode') }, rawDeflate))).toEqual(original);
  });

  it('lanza PdfSyntaxError si los datos Flate están dañados', () => {
    const truncated = flateEncode(sample(500)).slice(0, 20);
    expect(() => decodeStreamData(flowWith({ Filter: name('FlateDecode') }, truncated))).toThrow(
      new PdfSyntaxError('Flujo FlateDecode dañado', 0),
    );
  });

  it('rechaza filtros no soportados con el nombre del filtro', () => {
    const data = raw([1, 2, 3]);
    expect(() => decodeStreamData(flowWith({ Filter: name('LZWDecode') }, data))).toThrow(
      new PdfSyntaxError('Filtro no soportado: LZWDecode', 0),
    );
    expect(() => decodeStreamData(flowWith({ Filter: name('DCTDecode') }, data))).toThrow('Filtro no soportado: DCTDecode');
  });

  it('rechaza una cadena de varios filtros', () => {
    const data = flateEncode(sample(10));
    expect(() => decodeStreamData(flowWith({ Filter: [name('ASCIIHexDecode'), name('FlateDecode')] }, data))).toThrow(
      PdfSyntaxError,
    );
  });
});

describe('decodeStreamData · predictores', () => {
  it('invierte el predictor PNG Up (12) con /Columns 7', () => {
    const original = sample(7 * 5);
    const encoded = flateEncode(encodePngUp(original, 7));
    const parms = dict({ Predictor: 12, Columns: 7 });
    const decoded = decodeStreamData(flowWith({ Filter: name('FlateDecode'), DecodeParms: parms }, encoded));
    expect(decoded).toEqual(original);
  });

  it('invierte los predictores PNG Sub (1), Average (3) y Paeth (4) con cálculo hecho a mano', () => {
    // Columnas 4, 1 byte por píxel. Fila 1 (Sub) → 10 20 30 40. Fila 2 (Average, up = fila 1) → 6 14 23 32.
    // Fila 3 (Paeth, up = fila 2, sin residuo) → 6 14 23 32.
    const encoded = raw([
      1, 10, 10, 10, 10,
      3, 1, 1, 1, 1,
      4, 0, 0, 0, 0,
    ]);
    const decoded = decodeStreamData(
      flowWith({ Filter: name('FlateDecode'), DecodeParms: dict({ Predictor: 15, Columns: 4 }) }, flateEncode(encoded)),
    );
    expect(decoded).toEqual(raw([10, 20, 30, 40, 6, 14, 23, 32, 6, 14, 23, 32]));
  });

  it('rechaza un byte de filtro de fila desconocido', () => {
    const encoded = flateEncode(raw([7, 1, 2, 3]));
    expect(() =>
      decodeStreamData(flowWith({ Filter: name('FlateDecode'), DecodeParms: dict({ Predictor: 12, Columns: 3 }) }, encoded)),
    ).toThrow(PdfSyntaxError);
  });

  it('aplica el predictor TIFF (2) con 8 bits por componente', () => {
    // Dos píxeles RGB por fila: cada componente se suma al del píxel anterior.
    const encoded = flateEncode(raw([10, 20, 30, 1, 2, 3]));
    const decoded = decodeStreamData(
      flowWith({ Filter: name('FlateDecode'), DecodeParms: dict({ Predictor: 2, Colors: 3, Columns: 2 }) }, encoded),
    );
    expect(decoded).toEqual(raw([10, 20, 30, 11, 22, 33]));
  });

  it('rechaza el predictor TIFF con otros bits por componente', () => {
    const encoded = flateEncode(raw([1, 2]));
    expect(() =>
      decodeStreamData(
        flowWith({ Filter: name('FlateDecode'), DecodeParms: dict({ Predictor: 2, BitsPerComponent: 16, Columns: 1 }) }, encoded),
      ),
    ).toThrow(PdfSyntaxError);
  });

  it('acepta /DecodeParms como array de un diccionario', () => {
    const original = sample(14);
    const encoded = flateEncode(encodePngUp(original, 7));
    const decoded = decodeStreamData(
      flowWith({ Filter: [name('FlateDecode')], DecodeParms: [dict({ Predictor: 12, Columns: 7 })] }, encoded),
    );
    expect(decoded).toEqual(original);
  });

  it('round-trip: decodeStreamData(flate(x)) === x sin predictor', () => {
    const original = sample(4096);
    expect(decodeStreamData(flowWith({ Filter: name('FlateDecode') }, flateEncode(original)))).toEqual(original);
  });

  it('rechaza un predictor no soportado', () => {
    const encoded = flateEncode(raw([1, 2, 3]));
    expect(() =>
      decodeStreamData(flowWith({ Filter: name('FlateDecode'), DecodeParms: dict({ Predictor: 5 }) }, encoded)),
    ).toThrow('Predictor no soportado: 5');
  });
});
