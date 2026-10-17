import { PlatformIoError } from './errors';
import type { ByteSource } from './types';

function assertRange(begin: number, end: number, size: number): void {
  const valid = Number.isInteger(begin) && Number.isInteger(end)
    && 0 <= begin && begin <= end && end <= size;
  if (!valid) throw new PlatformIoError('out-of-range');
}

/** Fuente sobre bytes en memoria. Cada lectura devuelve una copia. */
export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    read(begin, end) {
      try {
        assertRange(begin, end, bytes.byteLength);
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.resolve(bytes.slice(begin, end));
    },
  };
}

/** Fuente sobre un Blob (p. ej. File de <input type=file>). */
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(begin, end) {
      assertRange(begin, end, blob.size);
      try {
        return new Uint8Array(await blob.slice(begin, end).arrayBuffer());
      } catch (cause) {
        throw new PlatformIoError('io', { cause });
      }
    },
  };
}

/** Lee la fuente completa en trozos de `chunkSize` bytes. */
export async function readAll(source: ByteSource, chunkSize = 4 * 1024 * 1024): Promise<Uint8Array> {
  const out = new Uint8Array(source.size);
  for (let offset = 0; offset < source.size; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, source.size);
    out.set(await source.read(offset, end), offset);
  }
  return out;
}
