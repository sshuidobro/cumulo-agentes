import { memorySource, type ByteSource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { BlockCache } from '../../../src/core/pdf/block-cache';
import { Lru } from '../../../src/core/pdf/lru';
import { countingSource } from '../../helpers/pdfjs-node';

/** Datos de prueba: el byte de la posición `i` es `i % 251`, así cualquier desplazamiento se comprueba. */
function patternData(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = i % 251;
  return out;
}

function expectPattern(bytes: Uint8Array, begin: number): void {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== (begin + i) % 251) throw new Error(`byte ${i} de la lectura desde ${begin} no coincide`);
  }
}

describe('BlockCache', () => {
  it('dos lecturas dentro del mismo bloque hacen una sola llamada a la fuente', async () => {
    const src = countingSource(memorySource(patternData(20_000)));
    const cache = new BlockCache(src);
    expectPattern(await cache.read(0, 10), 0);
    expectPattern(await cache.read(20, 30), 20);
    expect(src.reads).toBe(1);
  });

  it('una lectura que cruza 3 bloques sin cachear hace una sola llamada a la fuente', async () => {
    const src = countingSource(memorySource(patternData(40_000)));
    const cache = new BlockCache(src);
    const bytes = await cache.read(4000, 12_000);
    expect(bytes.length).toBe(8000);
    expectPattern(bytes, 4000);
    expect(src.reads).toBe(1);
  });

  it('con maxBlocks 2 descarta el bloque menos usado recientemente', async () => {
    const src = countingSource(memorySource(patternData(40_000)));
    const cache = new BlockCache(src, { blockSize: 4096, maxBlocks: 2 });
    await cache.read(0, 1); // bloque 0
    await cache.read(4096, 4097); // bloque 1
    await cache.read(0, 1); // toca el bloque 0: ahora el 1 es el menos usado
    await cache.read(8192, 8193); // bloque 2 → descarta el 1
    expect(src.reads).toBe(3);
    await cache.read(10, 11); // bloque 0 sigue en caché
    expect(src.reads).toBe(3);
    expectPattern(await cache.read(4096, 4100), 4096); // bloque 1 hay que volver a pedirlo
    expect(src.reads).toBe(4);
  });

  it('una lectura de 100 KB va directa a la fuente y no ocupa la caché', async () => {
    const src = countingSource(memorySource(patternData(200_000)));
    const cache = new BlockCache(src);
    const bytes = await cache.read(1000, 1000 + 100 * 1024);
    expect(bytes.length).toBe(100 * 1024);
    expectPattern(bytes, 1000);
    expect(src.reads).toBe(1);
    expect(src.bytesRead).toBe(100 * 1024);
    await cache.read(1000, 1010);
    expect(src.reads).toBe(2);
  });

  it('recorta el final al tamaño: read(size - 10, size + 50) devuelve 10 bytes', async () => {
    const data = patternData(5000);
    const cache = new BlockCache(memorySource(data));
    const bytes = await cache.read(data.length - 10, data.length + 50);
    expect(bytes.length).toBe(10);
    expectPattern(bytes, data.length - 10);
  });

  it('un rango vacío o más allá del final devuelve 0 bytes', async () => {
    const cache = new BlockCache(memorySource(patternData(100)));
    expect((await cache.read(50, 50)).length).toBe(0);
    expect((await cache.read(100, 200)).length).toBe(0);
  });

  it('una lectura que cruza bloques cacheados y no cacheados devuelve los bytes correctos', async () => {
    const data = patternData(30_000);
    const src = countingSource(memorySource(data));
    const cache = new BlockCache(src, { blockSize: 1000 });
    await cache.read(2000, 2500); // bloque 2 en caché
    const bytes = await cache.read(1500, 4200);
    expect(bytes.length).toBe(2700);
    expectPattern(bytes, 1500);
    // Bloque 1 (una lectura) y bloques 3-4 (contiguos, otra lectura); el 2 ya estaba en caché.
    expect(src.reads).toBe(3);
  });

  it('una fuente que devuelve menos bytes de los pedidos es un error de fichero', async () => {
    const short: ByteSource = {
      size: 10_000,
      read: async (begin, end) => patternData(10_000).slice(begin, Math.max(begin, end - 1)),
    };
    const cache = new BlockCache(short);
    await expect(cache.read(0, 100)).rejects.toMatchObject({ name: 'PdfSyntaxError', message: 'short-read' });
  });

  it('rechaza un blockSize o un inicio no válidos', async () => {
    expect(() => new BlockCache(memorySource(patternData(10)), { blockSize: 0 })).toThrow(RangeError);
    await expect(new BlockCache(memorySource(patternData(10))).read(-1, 5)).rejects.toThrow(RangeError);
  });
});

describe('Lru', () => {
  it('descarta la entrada menos usada y respeta la renovación por get', () => {
    const lru = new Lru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
    expect(lru.size).toBe(2);
  });

  it('rechaza una capacidad no válida', () => {
    expect(() => new Lru<number, number>(0)).toThrow(RangeError);
  });
});
