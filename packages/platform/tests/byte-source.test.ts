import { describe, expect, it } from 'vitest';
import { PlatformIoError, blobSource, memorySource, readAll } from '../src/index';
import type { ByteSource } from '../src/index';

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('la promesa debía rechazar');
}

const bytes = Uint8Array.of(1, 2, 3, 4, 5);

describe('memorySource', () => {
  it('devuelve el rango pedido con end exclusivo', async () => {
    const source = memorySource(bytes);
    expect(source.size).toBe(5);
    expect(Array.from(await source.read(1, 4))).toEqual([2, 3, 4]);
  });

  it('devuelve una copia: modificarla no cambia la fuente', async () => {
    const source = memorySource(bytes);
    const part = await source.read(0, 2);
    part[0] = 99;
    expect(Array.from(await source.read(0, 2))).toEqual([1, 2]);
  });

  it('read(0,0) devuelve un rango vacío', async () => {
    expect((await memorySource(bytes).read(0, 0)).byteLength).toBe(0);
  });

  it.each([
    ['begin mayor que end', 3, 2],
    ['begin negativo', -1, 2],
    ['end fuera del fichero', 0, 6],
    ['begin no entero', 0.5, 2],
    ['end no entero', 0, 2.5],
    ['NaN', Number.NaN, 2],
  ])('rechaza con out-of-range si %s', async (_caso, begin, end) => {
    const error = await rejectionOf(memorySource(bytes).read(begin, end));
    expect(error).toBeInstanceOf(PlatformIoError);
    expect((error as PlatformIoError).code).toBe('out-of-range');
  });
});

describe('blobSource', () => {
  it('devuelve los mismos rangos que memorySource', async () => {
    const fromBlob = blobSource(new Blob([bytes]));
    const fromMemory = memorySource(bytes);
    expect(fromBlob.size).toBe(fromMemory.size);
    for (const [begin, end] of [[0, 5], [1, 4], [2, 2], [4, 5]] as const) {
      expect(Array.from(await fromBlob.read(begin, end)))
        .toEqual(Array.from(await fromMemory.read(begin, end)));
    }
  });

  it('rechaza con out-of-range los rangos inválidos', async () => {
    const error = await rejectionOf(blobSource(new Blob([bytes])).read(0, 6));
    expect((error as PlatformIoError).code).toBe('out-of-range');
  });

  it('si arrayBuffer rechaza, lanza PlatformIoError con code io y cause original', async () => {
    const cause = new Error('disco desconectado');
    const brokenBlob = {
      size: 5,
      slice: () => ({ arrayBuffer: () => Promise.reject(cause) }),
    } as unknown as Blob;
    const error = await rejectionOf(blobSource(brokenBlob).read(0, 5));
    expect(error).toBeInstanceOf(PlatformIoError);
    expect((error as PlatformIoError).code).toBe('io');
    expect((error as PlatformIoError).cause).toBe(cause);
  });
});

describe('readAll', () => {
  it('lee los bytes exactos en trozos de chunkSize 2', async () => {
    expect(Array.from(await readAll(memorySource(bytes), 2))).toEqual([1, 2, 3, 4, 5]);
  });

  it('lee los bytes exactos desde un Blob con el tamaño por defecto', async () => {
    expect(Array.from(await readAll(blobSource(new Blob([bytes]))))).toEqual([1, 2, 3, 4, 5]);
  });

  it('una fuente vacía devuelve un array vacío sin leer', async () => {
    let reads = 0;
    const empty: ByteSource = {
      size: 0,
      read: () => { reads += 1; return Promise.resolve(new Uint8Array(0)); },
    };
    expect((await readAll(empty)).byteLength).toBe(0);
    expect(reads).toBe(0);
  });
});
