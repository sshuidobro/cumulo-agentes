import { describe, expect, it } from 'vitest';
import { toWinAnsi } from '../../../src/core/annotations/winansi';

describe('toWinAnsi', () => {
  it('codifica € y ñ, y sustituye Ж y el dígito de la prueba por ?', () => {
    expect([...toWinAnsi('€ñ–Ж')]).toEqual([0x80, 0xf1, 0x96, 0x3f]);
  });

  it('deja el ASCII imprimible y el Latin-1 tal cual', () => {
    expect([...toWinAnsi('Hola, ñandú ¿qué?')]).toEqual([
      0x48, 0x6f, 0x6c, 0x61, 0x2c, 0x20, 0xf1, 0x61, 0x6e, 0x64, 0xfa, 0x20, 0xbf, 0x71, 0x75, 0xe9, 0x3f,
    ]);
    expect([...toWinAnsi(' ÿ')]).toEqual([0xa0, 0xff]);
  });

  it('mapea los 27 caracteres de 0x80-0x9F de Windows-1252', () => {
    const chars =
      '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
    const codes = [...chars].map((c) => toWinAnsi(c)[0]);
    expect(chars.length).toBe(27);
    expect(codes).toEqual([
      0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e,
      0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
    ]);
  });

  it('sustituye por ? los puntos de código sin representación, incluidos los emoji', () => {
    expect([...toWinAnsi('😀')]).toEqual([0x3f]);
    expect([...toWinAnsi('\u0001\u0081')]).toEqual([0x3f, 0x3f]);
  });

  it('devuelve bytes vacíos para la cadena vacía', () => {
    expect(toWinAnsi('')).toHaveLength(0);
  });
});
