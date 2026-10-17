/**
 * Caché de bloques alineados sobre un `ByteSource` (ADR-0014). Objetos vecinos del árbol de
 * páginas caen en los mismos bloques, así que no se vuelven a pedir bytes a la fuente.
 * Sin lógica de PDF: solo E/S por rangos.
 */
import type { ByteSource } from '@suite/platform';
import { Lru } from './lru';
import { PdfSyntaxError } from './objects';

const DEFAULT_BLOCK_SIZE = 4096;
const DEFAULT_MAX_BLOCKS = 256;
/** Lecturas más grandes que esto no pasan por la caché. */
const DIRECT_READ_LIMIT = 64 * 1024;

export interface BlockCacheOptions {
  /** Tamaño de bloque en bytes (por defecto 4096). */
  readonly blockSize?: number;
  /** Número máximo de bloques retenidos (por defecto 256, LRU). */
  readonly maxBlocks?: number;
}

export class BlockCache implements ByteSource {
  readonly size: number;
  private readonly src: ByteSource;
  private readonly blockSize: number;
  private readonly blocks: Lru<number, Uint8Array>;

  constructor(src: ByteSource, opts: BlockCacheOptions = {}) {
    const blockSize = opts.blockSize ?? DEFAULT_BLOCK_SIZE;
    const maxBlocks = opts.maxBlocks ?? DEFAULT_MAX_BLOCKS;
    if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
      throw new RangeError(`BlockCache: blockSize debe ser un entero >= 1 (recibido ${blockSize})`);
    }
    this.src = src;
    this.size = src.size;
    this.blockSize = blockSize;
    this.blocks = new Lru<number, Uint8Array>(maxBlocks);
  }

  /** Bytes `[begin, end)`; `end` se recorta al tamaño. Un rango vacío devuelve 0 bytes. */
  async read(begin: number, end: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(begin) || begin < 0) {
      throw new RangeError(`BlockCache: inicio no válido (${begin})`);
    }
    const stop = Math.min(end, this.size);
    if (stop <= begin) return new Uint8Array(0);
    if (stop - begin > DIRECT_READ_LIMIT) return this.src.read(begin, stop);

    const bs = this.blockSize;
    const first = Math.floor(begin / bs);
    const last = Math.floor((stop - 1) / bs);
    const parts: (Uint8Array | undefined)[] = new Array<Uint8Array | undefined>(last - first + 1);

    let k = first;
    while (k <= last) {
      const cached = this.blocks.get(k);
      if (cached !== undefined) {
        parts[k - first] = cached;
        k++;
        continue;
      }
      // Bloques que faltan y son contiguos: una sola lectura de la fuente.
      let m = k;
      while (m < last && this.blocks.get(m + 1) === undefined) m++;
      const runBegin = k * bs;
      const runEnd = Math.min((m + 1) * bs, this.size);
      const data = await this.src.read(runBegin, runEnd);
      if (data.length !== runEnd - runBegin) {
        throw new PdfSyntaxError('short-read', runBegin);
      }
      for (let j = k; j <= m; j++) {
        const from = (j - k) * bs;
        const block = data.subarray(from, Math.min(from + bs, data.length));
        parts[j - first] = block;
        this.blocks.set(j, block);
      }
      k = m + 1;
    }

    // Se ensambla con las referencias guardadas en `parts`: la caché puede haber descartado algún bloque.
    const out = new Uint8Array(stop - begin);
    for (let j = first; j <= last; j++) {
      const block = parts[j - first];
      if (block === undefined) throw new Error('bug: bloque sin cargar en BlockCache.read');
      const blockStart = j * bs;
      const from = Math.max(begin, blockStart) - blockStart;
      const to = Math.min(stop, blockStart + block.length) - blockStart;
      out.set(block.subarray(from, to), blockStart + from - begin);
    }
    return out;
  }
}
