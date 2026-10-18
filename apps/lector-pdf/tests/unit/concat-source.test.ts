import { describe, expect, it } from 'vitest';
import { memorySource, readAll } from '@suite/platform';
import { concatSource } from '../../src/core/pdf/concat-source';
import { countingSource } from '../helpers/pdfjs-node';

/** Generador pseudoaleatorio con semilla: los tests son deterministas. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bytes(length: number, offset: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + offset) & 0xff);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

describe('concatSource', () => {
  const base = bytes(3000, 7);
  const tail = bytes(500, 101);
  const whole = concat(base, tail);

  it('size es la suma de base y tail', () => {
    expect(concatSource(memorySource(base), tail).size).toBe(3500);
    expect(concatSource(memorySource(new Uint8Array(0)), tail).size).toBe(500);
    expect(concatSource(memorySource(base), new Uint8Array(0)).size).toBe(3000);
  });

  it('readAll devuelve base seguido de tail', async () => {
    expect(await readAll(concatSource(memorySource(base), tail))).toEqual(whole);
  });

  it('1 000 lecturas aleatorias (también las que cruzan el límite) devuelven los bytes del array concatenado', async () => {
    const source = concatSource(memorySource(base), tail);
    const random = seeded(20261018);
    for (let i = 0; i < 1000; i += 1) {
      const begin = Math.floor(random() * whole.byteLength);
      const length = Math.floor(random() * Math.min(1200, whole.byteLength - begin + 1));
      const end = begin + length;
      const got = await source.read(begin, end);
      // Comparación byte a byte (más rápida que toEqual con 1 000 lecturas) y con el rango en el mensaje.
      expect({ range: [begin, end], same: sameBytes(got, whole.subarray(begin, end)) })
        .toEqual({ range: [begin, end], same: true });
    }
  });

  it('una lectura que cruza el límite base/tail combina los dos trozos', async () => {
    const source = concatSource(memorySource(base), tail);
    expect(await source.read(2990, 3010)).toEqual(whole.subarray(2990, 3010));
    expect(await source.read(3000, 3500)).toEqual(tail);
    expect(await source.read(0, 3000)).toEqual(base);
    expect(await source.read(42, 42)).toEqual(new Uint8Array(0));
  });

  it('no pide a base el fichero entero: una lectura pequeña solo le pide esos bytes', async () => {
    const counted = countingSource(memorySource(base));
    const source = concatSource(counted, tail);
    await source.read(100, 110);
    expect(counted.bytesRead).toBe(10);
    await source.read(3100, 3200);
    expect(counted.bytesRead).toBe(10);
  });

  it('un rango fuera de la fuente lanza', async () => {
    const source = concatSource(memorySource(base), tail);
    await expect(source.read(-1, 5)).rejects.toThrow(RangeError);
    await expect(source.read(3400, 3501)).rejects.toThrow(RangeError);
    await expect(source.read(10, 5)).rejects.toThrow(RangeError);
  });

  it('si base devuelve menos bytes de los pedidos, la lectura falla en vez de dar datos incompletos', async () => {
    const broken = { size: 3000, read: () => Promise.resolve(new Uint8Array(3)) };
    const source = concatSource(broken, tail);
    await expect(source.read(0, 10)).rejects.toThrow();
  });
});
