import { describe, expect, it } from 'vitest';
import { bytesString, dict, name, ref, stream } from '../../../src/core/pdf/objects';
import { serializeIndirect, serializeValue } from '../../../src/core/pdf/serialize';
import { bytes, latin1, raw } from './helpers';

const text = (v: Parameters<typeof serializeValue>[0]): string => latin1(serializeValue(v));

describe('serializeValue · números', () => {
  it('escribe enteros sin decimales y reales con 4 decimales como máximo sin ceros finales', () => {
    expect(text(42)).toBe('42');
    expect(text(-12.25)).toBe('-12.25');
    expect(text(0.5)).toBe('0.5');
    expect(text(1.23456)).toBe('1.2346');
    expect(text(12.5)).toBe('12.5');
  });

  it('0.1 + 0.2 da 0.3', () => {
    expect(text(0.1 + 0.2)).toBe('0.3');
  });

  it('-0 se escribe como 0 y reales que se redondean a cero también', () => {
    expect(text(-0)).toBe('0');
    expect(text(-0.00001)).toBe('0');
  });

  it('1e21 no usa exponente', () => {
    expect(text(1e21)).toBe('1000000000000000000000');
    expect(text(-1e21)).toBe('-1000000000000000000000');
  });

  it.each([NaN, Infinity, -Infinity])('%s lanza RangeError', (n) => {
    expect(() => serializeValue(n)).toThrow(RangeError);
  });
});

describe('serializeValue · nombres', () => {
  it('escapa espacios, # y delimitadores con #XX', () => {
    expect(text(name('N a'))).toBe('/N#20a');
    expect(text(name('#'))).toBe('/#23');
    expect(text(name('(x)'))).toBe('/#28x#29');
    expect(text(name('a/b%c'))).toBe('/a#2Fb#25c');
  });

  it('escribe el nombre vacío como "/" y los caracteres UTF-8 con #XX', () => {
    expect(text(name(''))).toBe('/');
    expect(text(name('ñ'))).toBe('/#C3#B1');
  });

  it('deja sin escapar los caracteres imprimibles normales', () => {
    expect(text(name('Type-1_2.0'))).toBe('/Type-1_2.0');
  });
});

describe('serializeValue · cadenas', () => {
  it('escribe cadenas literales escapando ( ) \\ y bytes fuera de 0x20-0x7E en octal', () => {
    expect(text(bytesString(raw([0x61, 0x28, 0x29, 0x5c, 0x0a, 0xe9, 0x20])))).toBe('(a\\(\\)\\\\\\012\\351 )');
  });

  it('escribe cadenas hexadecimales en mayúsculas', () => {
    expect(text(bytesString(raw([0x4e, 0x6f]), true))).toBe('<4E6F>');
    expect(text(bytesString(raw([0x0a, 0xff]), true))).toBe('<0AFF>');
  });

  it('escribe la cadena vacía', () => {
    expect(text(bytesString(new Uint8Array(0)))).toBe('()');
  });
});

describe('serializeValue · estructuras', () => {
  it('escribe diccionarios como << /K v /K2 v2 >>', () => {
    expect(text(dict({ Type: name('Annot'), Rect: [0, 0, 10, 5] }))).toBe('<< /Type /Annot /Rect [0 0 10 5] >>');
  });

  it('escribe diccionarios y arrays vacíos', () => {
    expect(text(dict({}))).toBe('<< >>');
    expect(text([])).toBe('[]');
  });

  it('escribe referencias, booleanos y null', () => {
    expect(text(ref(12, 0))).toBe('12 0 R');
    expect(text([true, false, null])).toBe('[true false null]');
  });

  it('escribe un flujo como diccionario, stream, datos sin cambios y endstream', () => {
    const data = raw([0x00, 0x0a, 0xff]);
    const expected = new Uint8Array([...bytes('<< /Length 3 >>\nstream\n'), ...data, ...bytes('\nendstream')]);
    expect(serializeValue(stream({}, data))).toEqual(expected);
  });

  it('serializa lo mismo dos veces (determinista)', () => {
    const v = dict({ A: [1, 2.5, name('x')], B: bytesString(raw([1, 2, 3])) });
    expect(serializeValue(v)).toEqual(serializeValue(v));
  });
});

describe('serializeIndirect', () => {
  it('escribe "num gen obj", el valor y "endobj" en líneas propias', () => {
    expect(latin1(serializeIndirect(1, 0, dict({})))).toBe('1 0 obj\n<< >>\nendobj\n');
  });

  it('un flujo se escribe completo dentro del objeto', () => {
    const out = serializeIndirect(4, 0, stream({}, raw([0x41, 0x42])));
    expect(latin1(out)).toBe('4 0 obj\n<< /Length 2 >>\nstream\nAB\nendstream\nendobj\n');
  });
});
