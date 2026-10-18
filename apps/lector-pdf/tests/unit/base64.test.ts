import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../../src/core/base64';

const bytesOf = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('toBase64', () => {
  it('codifica los ejemplos canónicos de RFC 4648 con sus rellenos', () => {
    const text = (s: string): Uint8Array => new TextEncoder().encode(s);
    expect(toBase64(text(''))).toBe('');
    expect(toBase64(text('f'))).toBe('Zg==');
    expect(toBase64(text('fo'))).toBe('Zm8=');
    expect(toBase64(text('foo'))).toBe('Zm9v');
    expect(toBase64(text('foob'))).toBe('Zm9vYg==');
    expect(toBase64(text('fooba'))).toBe('Zm9vYmE=');
    expect(toBase64(text('foobar'))).toBe('Zm9vYmFy');
  });

  it('usa los caracteres + y / para los índices 62 y 63', () => {
    expect(toBase64(bytesOf(0xfb, 0xff))).toBe('+/8=');
  });

  it('codifica bytes arbitrarios incluidos 0x00 y 0xff', () => {
    expect(toBase64(bytesOf(0, 0, 0))).toBe('AAAA');
    expect(toBase64(bytesOf(255, 255, 255))).toBe('////');
  });
});

describe('fromBase64', () => {
  it('decodifica el inverso de toBase64 para todas las longitudes de 0 a 40 bytes', () => {
    for (let n = 0; n <= 40; n++) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
      expect(fromBase64(toBase64(data))).toEqual(data);
    }
  });

  it('acepta el alfabeto completo y el relleno de uno y dos signos', () => {
    expect(fromBase64('+/8=')).toEqual(bytesOf(0xfb, 0xff));
    expect(fromBase64('Zg==')).toEqual(bytesOf(0x66));
    expect(fromBase64('Zm8=')).toEqual(bytesOf(0x66, 0x6f));
    expect(fromBase64('')).toEqual(new Uint8Array(0));
  });

  it('devuelve null si la longitud no es múltiplo de 4', () => {
    expect(fromBase64('Zm9')).toBeNull();
    expect(fromBase64('Zm9vY')).toBeNull();
  });

  it('devuelve null con caracteres fuera del alfabeto', () => {
    expect(fromBase64('Zm9v!A==')).toBeNull();
    expect(fromBase64('Zm 9')).toBeNull();
    expect(fromBase64('Zm-_')).toBeNull();
  });

  it('devuelve null si el relleno aparece antes del final', () => {
    expect(fromBase64('Z=8=')).toBeNull();
    expect(fromBase64('====')).toBeNull();
    expect(fromBase64('Zg=A')).toBeNull();
  });

  it('no lanza con texto arbitrario', () => {
    expect(() => fromBase64('constructor')).not.toThrow();
    expect(fromBase64('__proto__')).toBeNull();
  });
});
