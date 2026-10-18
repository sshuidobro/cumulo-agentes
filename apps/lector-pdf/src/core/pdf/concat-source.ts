import type { ByteSource } from '@suite/platform';

/**
 * `base` seguido de `tail` (en memoria). Lee por rangos: solo pide a `base` los bytes del rango pedido,
 * sin copiarlo entero. Los rangos fuera de [0, size] son un bug de quien llama y lanzan.
 */
export function concatSource(base: ByteSource, tail: Uint8Array): ByteSource {
  const baseSize = base.size;
  const size = baseSize + tail.byteLength;

  return {
    size,
    async read(begin, end) {
      if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || begin > end || end > size) {
        throw new RangeError(`rango fuera de la fuente: ${String(begin)}-${String(end)} de ${String(size)}`);
      }
      const fromBase = begin < baseSize ? await readBase(base, begin, Math.min(end, baseSize)) : null;
      const fromTail = end > baseSize ? tail.subarray(Math.max(begin, baseSize) - baseSize, end - baseSize) : null;
      if (fromBase === null) return fromTail === null ? new Uint8Array(0) : fromTail.slice();
      if (fromTail === null) return fromBase;

      const out = new Uint8Array(fromBase.byteLength + fromTail.byteLength);
      out.set(fromBase, 0);
      out.set(fromTail, fromBase.byteLength);
      return out;
    },
  };
}

async function readBase(base: ByteSource, begin: number, end: number): Promise<Uint8Array> {
  const bytes = await base.read(begin, end);
  if (bytes.byteLength !== end - begin) {
    throw new Error(`la fuente base devolvió ${String(bytes.byteLength)} bytes de ${String(end - begin)} pedidos`);
  }
  return bytes;
}
