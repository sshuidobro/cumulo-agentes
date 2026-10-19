import type { ByteSource } from '@suite/platform';

/** `[begin, end)` cabe dentro de `[0, size]`: `end` es exclusivo. */
export function isValidRange(begin: number, end: number, size: number): boolean {
  return Number.isInteger(begin) && Number.isInteger(end) && 0 <= begin && begin <= end && end <= size;
}

/**
 * Fuente sobre bytes en memoria. Equivale a `memorySource` de `@suite/platform`, pero sin importar ese paquete:
 * el Worker no debe arrastrar su código de plataforma (ADR-0034).
 */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    read(begin, end) {
      if (!isValidRange(begin, end, bytes.byteLength)) {
        return Promise.reject(new RangeError('Lectura fuera del fichero.'));
      }
      return Promise.resolve(bytes.slice(begin, end));
    },
  };
}

/**
 * Buffers que se pueden transferir sin dejar al emisor un búfer vacío: solo los que ocupa entero el `Uint8Array`.
 * Lo que no se transfiere se copia al enviar, así que nunca se pierde nada.
 */
export function transferableBuffers(candidates: Iterable<unknown>): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const candidate of candidates) {
    if (
      candidate instanceof Uint8Array &&
      candidate.buffer instanceof ArrayBuffer &&
      candidate.byteOffset === 0 &&
      candidate.byteLength === candidate.buffer.byteLength
    ) {
      buffers.add(candidate.buffer);
    }
  }
  return [...buffers];
}

/** Búferes de un resultado: el propio valor si es `Uint8Array`, o sus propiedades de primer nivel. */
export function resultBuffers(value: unknown): Transferable[] {
  if (value instanceof Uint8Array) return transferableBuffers([value]);
  if (typeof value === 'object' && value !== null) return transferableBuffers(Object.values(value));
  return [];
}
