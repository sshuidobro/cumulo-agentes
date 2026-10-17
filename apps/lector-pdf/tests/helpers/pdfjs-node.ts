import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { memorySource, type ByteSource } from '@suite/platform';
import { FIXTURES_DIR } from '../fixtures/paths';

/** Carpeta de recursos de pdf.js para Node (cmaps/, standard_fonts/...), con barra final. */
export function nodeAssetBase(): string {
  const require = createRequire(import.meta.url);
  return `${dirname(require.resolve('pdfjs-dist/package.json'))}/`;
}

/** Fuente sobre un fixture generado (tests/fixtures/ensure.ts). */
export function fixtureSource(name: string): ByteSource {
  return memorySource(new Uint8Array(readFileSync(join(FIXTURES_DIR, name))));
}

/** Envuelve una fuente y cuenta las lecturas y los bytes pedidos. */
export function countingSource(inner: ByteSource): ByteSource & { readonly reads: number; readonly bytesRead: number } {
  let reads = 0;
  let bytesRead = 0;
  return {
    get size() { return inner.size; },
    get reads() { return reads; },
    get bytesRead() { return bytesRead; },
    read(begin, end) {
      reads += 1;
      bytesRead += end - begin;
      return inner.read(begin, end);
    },
  };
}
