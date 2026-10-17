import { describe, expect, it, vi } from 'vitest';
import { parseIndirectObject, parseValue } from '../../../src/core/pdf/parser';
import {
  bytesString,
  dict,
  dictGet,
  name,
  PdfSyntaxError,
  ref,
  stream,
  type PdfDict,
  type PdfValue,
} from '../../../src/core/pdf/objects';
import { serializeValue } from '../../../src/core/pdf/serialize';
import { bytes, latin1, raw } from './helpers';

function asDict(v: PdfValue): PdfDict {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict') return v;
  throw new Error('se esperaba un diccionario');
}

function parsed(text: string): PdfValue {
  return parseValue(bytes(text), 0).value;
}

describe('parseValue · valores', () => {
  it('lee un diccionario de anotación válido con cada tipo de objeto y el orden de claves', () => {
    const src = '<< /Type /Annot /Rect [0 0 10.5 -3] /C [1 0 0] /P 12 0 R /T (Ana \\(x\\)) /N /a#20b /H <4E6F> /O true /Z null >>';
    const d = asDict(parsed(src));
    expect([...d.entries.keys()]).toEqual(['Type', 'Rect', 'C', 'P', 'T', 'N', 'H', 'O', 'Z']);
    expect(dictGet(d, 'Type')).toEqual(name('Annot'));
    expect(dictGet(d, 'Rect')).toEqual([0, 0, 10.5, -3]);
    expect(dictGet(d, 'C')).toEqual([1, 0, 0]);
    expect(dictGet(d, 'P')).toEqual(ref(12, 0));
    expect(dictGet(d, 'T')).toEqual(bytesString(bytes('Ana (x)')));
    expect(dictGet(d, 'N')).toEqual(name('a b'));
    expect(dictGet(d, 'H')).toEqual(bytesString(raw([0x4e, 0x6f]), true));
    expect(dictGet(d, 'O')).toBe(true);
    expect(dictGet(d, 'Z')).toBeNull();
  });

  it('un nombre con #20 dentro de un diccionario se decodifica como espacio', () => {
    expect(dictGet(asDict(parsed('<< /N#20a 1 >>')), 'N a')).toBe(1);
  });

  it('rechaza el texto literal de la ficha "/N#20a /H <4E6F>": tras la clave /N#20a, <4E6F> no es un nombre', () => {
    // La ficha PDF-025 pide "/N#20a /H <4E6F>" como entrada válida, pero <4E6F> ocupa una posición de clave.
    // Se documenta como duda en el Registro; no se inventa una interpretación.
    expect(() => parsed('<< /N#20a /H <4E6F> >>')).toThrow(PdfSyntaxError);
  });

  it('lee cadenas literales con escapes, continuaciones y fin de línea normalizado', () => {
    const v = parsed('(a\\nb\\\\c\\051\\\nd(e)f)');
    expect(typeof v === 'object' && v !== null && 'bytes' in v ? Array.from(v.bytes) : []).toEqual(
      Array.from(bytes('a\nb\\c)d(e)f')),
    );
  });

  it('separa el número de una referencia solo si va seguido de "R"', () => {
    expect(parsed('[1 0 R 2 3]')).toEqual([ref(1, 0), 2, 3]);
    expect(parsed('[1 0 3]')).toEqual([1, 0, 3]);
  });

  it('lee arrays y diccionarios vacíos y anidados', () => {
    expect(parsed('[]')).toEqual([]);
    expect(asDict(parsed('<< >>')).entries.size).toBe(0);
    expect(parsed('[[1] [2 [3]]]')).toEqual([[1], [2, [3]]]);
  });

  it('una clave repetida conserva la primera posición y el último valor', () => {
    const d = asDict(parsed('<< /A 1 /B 2 /A 3 >>'));
    expect([...d.entries]).toEqual([['A', 3], ['B', 2]]);
  });

  it('lee un diccionario seguido de stream como flujo y usa /Length directo', () => {
    const v = parsed('<< /Length 5 >>\nstream\nhello\nendstream');
    expect(v).toEqual(stream({ Length: 5 }, bytes('hello')));
  });

  it('acepta stream con fin de línea CRLF', () => {
    const v = parsed('<< /Length 2 >>\r\nstream\r\nhi\r\nendstream');
    expect(v).toEqual(stream({ Length: 2 }, bytes('hi')));
  });

  it('parseValue devuelve el offset final de cada valor para leer valores seguidos', () => {
    const text = '<< /A 1 >>\n[1 2]  42';
    const first = parseValue(bytes(text), 0);
    const second = parseValue(bytes(text), first.end);
    const third = parseValue(bytes(text), second.end);
    expect(second.value).toEqual([1, 2]);
    expect(third.value).toBe(42);
    expect(third.end).toBe(text.length);
  });
});

describe('parseValue · errores', () => {
  it.each([
    ['diccionario sin cerrar', '<< /A'],
    ['array sin cerrar', '[1 2'],
    ['cadena sin cerrar', '(abc'],
    ['valor ausente', '<< /A >>'],
    ['clave que no es nombre', '<< 1 2 >>'],
    ['palabra clave desconocida', 'endobj'],
    ['corchete de cierre suelto', ']'],
    ['vacío', ''],
    ['más de 100 niveles', '['.repeat(101) + ']'.repeat(101)],
  ])('lanza PdfSyntaxError: %s', (_label, text) => {
    expect(() => parseValue(bytes(text), 0)).toThrow(PdfSyntaxError);
  }, 2000);

  it('el error lleva el offset del problema', () => {
    try {
      parseValue(bytes('[1 2 >>'), 0);
      expect.unreachable('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(PdfSyntaxError);
      expect(e instanceof PdfSyntaxError ? e.offset : -1).toBe(5);
    }
  });

  it('acepta exactamente 100 niveles de anidamiento', () => {
    const text = '['.repeat(100) + ']'.repeat(100);
    expect(() => parseValue(bytes(text), 0)).not.toThrow();
  });

  it('un flujo sin endstream es un error', () => {
    expect(() => parseValue(bytes('<< >>\nstream\nabc'), 0)).toThrow(PdfSyntaxError);
  });

  it('un stream sin fin de línea tras la palabra clave es un error', () => {
    expect(() => parseValue(bytes('<< >>stream abc endstream'), 0)).toThrow(PdfSyntaxError);
  });
});

describe('parseIndirectObject', () => {
  it('lee un objeto con número y generación', () => {
    const r = parseIndirectObject(bytes('7 2 obj\n<< /K [1] >>\nendobj\n'), 0);
    expect(r.num).toBe(7);
    expect(r.gen).toBe(2);
    expect(asDict(r.value).entries.get('K')).toEqual([1]);
    expect(r.end).toBe('7 2 obj\n<< /K [1] >>\nendobj'.length);
  });

  it('exige "obj" y "endobj"', () => {
    expect(() => parseIndirectObject(bytes('7 0 << >> endobj'), 0)).toThrow(PdfSyntaxError);
    expect(() => parseIndirectObject(bytes('7 0 obj << >>'), 0)).toThrow(PdfSyntaxError);
  });

  it('usa resolveLength para /Length indirecto', () => {
    const resolve = vi.fn((r: { readonly num: number }) => (r.num === 5 ? 5 : null));
    const src = '1 0 obj\n<< /Length 5 0 R >>\nstream\nhello\nendstream\nendobj';
    const r = parseIndirectObject(bytes(src), 0, resolve);
    expect(resolve).toHaveBeenCalledWith(ref(5, 0));
    expect(r.value).toMatchObject({ kind: 'stream', dict: { kind: 'dict' } });
    const value = r.value;
    expect(value !== null && typeof value === 'object' && 'dict' in value ? dictGet(value.dict, 'Length') : null).toEqual(ref(5, 0));
    expect(r.value).toMatchObject({ data: bytes('hello') });
    expect(r.end).toBe(src.length);
  });

  it('con /Length erróneo recupera los datos buscando endstream y recorta el fin de línea', () => {
    const src = '1 0 obj\n<< /Length 99 >>\nstream\nhello\nendstream\nendobj';
    const r = parseIndirectObject(bytes(src), 0);
    expect(r.value).toMatchObject({ kind: 'stream' });
    const data = r.value !== null && typeof r.value === 'object' && 'data' in r.value ? r.value.data : new Uint8Array();
    expect(latin1(data)).toBe('hello');
  });

  it('con /Length menor que los datos recupera el flujo completo', () => {
    const src = '1 0 obj\n<< /Length 2 >>\nstream\nhello\nendstream\nendobj';
    const r = parseIndirectObject(bytes(src), 0);
    const data = r.value !== null && typeof r.value === 'object' && 'data' in r.value ? r.value.data : new Uint8Array();
    expect(latin1(data)).toBe('hello');
  });

  it('si resolveLength devuelve null se busca endstream', () => {
    const src = '1 0 obj\n<< /Length 5 0 R >>\nstream\nabc\r\nendstream\nendobj';
    const r = parseIndirectObject(bytes(src), 0, () => null);
    const data = r.value !== null && typeof r.value === 'object' && 'data' in r.value ? r.value.data : new Uint8Array();
    expect(latin1(data)).toBe('abc');
  });
});

describe('ida y vuelta (serializar y volver a leer)', () => {
  const values: PdfValue[] = [
    null,
    true,
    false,
    0,
    42,
    -12.25,
    0.5,
    1e21,
    name('Type'),
    name('a b#c/d(e)'),
    name(''),
    name('Niño'),
    bytesString(raw([0, 1, 40, 41, 92, 127, 128, 255])),
    bytesString(raw([0x4e, 0x6f]), true),
    bytesString(new Uint8Array(0)),
    ref(3, 2),
    [],
    [1, [2, [3, []]]],
    dict({}),
    dict({ A: [name('x'), ref(1)], B: dict({ C: null, 'D#': bytesString(raw([10, 13])) }) }),
    stream({ Filter: name('FlateDecode') }, raw([1, 2, 3, 10, 13, 0xff, 0])),
  ];

  it.each(values.map((v, i) => [i, v] as const))('valor %i se conserva', (_i, v) => {
    expect(parseValue(serializeValue(v), 0).value).toEqual(v);
  });
});

describe('comportamiento con muchos objetos', () => {
  it('analiza 10 000 diccionarios de anotación concatenados', () => {
    // Variante válida del diccionario de la ficha (la literal no lo es; ver el test de rechazo).
    const one = '<< /Type /Annot /Rect [0 0 10.5 -3] /C [1 0 0] /P 12 0 R /T (Ana \\(x\\)) /N /a#20b /H <4E6F> /O true /Z null >>\n';
    const text = one.repeat(10_000);
    const input = bytes(text);
    let offset = 0;
    let count = 0;
    while (count < 10_000) {
      const r = parseValue(input, offset);
      expect(r.value).toMatchObject({ kind: 'dict' });
      offset = r.end;
      count++;
    }
    expect(count).toBe(10_000);
  });
});
