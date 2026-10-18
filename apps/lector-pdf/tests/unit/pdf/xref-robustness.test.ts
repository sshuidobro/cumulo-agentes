import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Zlib } from 'fflate';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { decodeStreamData } from '../../../src/core/pdf/filters';
import { PdfSyntaxError, type PdfStream } from '../../../src/core/pdf/objects';
import { readXref } from '../../../src/core/pdf/xref';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { bytes } from './helpers';

/** Comprime `chunks` bloques de `chunkSize` ceros con zlib en streaming (sin reservar el total). */
function zeroBomb(chunkSize: number, chunks: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const z = new Zlib({ level: 9 }, (d) => parts.push(d));
  const zeros = new Uint8Array(chunkSize);
  for (let i = 0; i < chunks; i++) z.push(zeros, i === chunks - 1);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function bombPdf(compressed: Uint8Array): Uint8Array {
  const head = bytes('%PDF-1.7\n');
  const objHead = bytes(`1 0 obj\n<< /Type /XRef /Size 2 /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`);
  const tail = (at: number): Uint8Array => bytes(`\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`);
  const t = tail(head.length);
  const out = new Uint8Array(head.length + objHead.length + compressed.length + t.length);
  out.set(head); out.set(objHead, head.length); out.set(compressed, head.length + objHead.length);
  out.set(t, head.length + objHead.length + compressed.length);
  return out;
}

describe('PDF-026 robustez (QA)', () => {
  // 72 MiB de ceros (> tope absoluto de 64 MiB), generada una sola vez: rapida tambien con cobertura.
  let cachedBomb: Uint8Array | undefined;
  const bomb = (): Uint8Array => (cachedBomb ??= zeroBomb(8 * 1024 * 1024, 9));

  it('una bomba de descompresion (72 MiB de ceros en <100 KB) no agota la memoria: error controlado', async () => {
    const pdf = bombPdf(bomb());
    expect(pdf.length).toBeLessThan(4 * 1024 * 1024);
    await expect(readXref(memorySource(pdf))).rejects.toBeInstanceOf(PdfSyntaxError);
  }, 60_000);

  it('decodeStreamData acota la salida de un flujo Flate malicioso', () => {
    const data = bomb();
    const s = { kind: 'stream', dict: { kind: 'dict', entries: new Map([['Filter', { kind: 'name', value: 'FlateDecode' }]]) }, data } as unknown as PdfStream;
    expect(() => decodeStreamData(s)).toThrow(PdfSyntaxError);
  }, 60_000);

  it('truncar basic-5/compressed/incremental en cualquier punto nunca cuelga ni lanza algo que no sea PdfSyntaxError', async () => {
    for (const name of ['basic-5.pdf', 'compressed.pdf', 'incremental-updates.pdf']) {
      const full = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
      for (let len = 0; len < full.length; len += Math.max(1, Math.floor(full.length / 120))) {
        try { await readXref(memorySource(full.slice(0, len))); } catch (e) { expect(e).toBeInstanceOf(PdfSyntaxError); }
      }
    }
  });

  it('bytes aleatorios corrompidos en las ultimas secciones: solo PdfSyntaxError', async () => {
    let seed = 12345;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (const name of ['basic-5.pdf', 'compressed.pdf', 'incremental-updates.pdf']) {
      const full = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
      for (let i = 0; i < 300; i++) {
        const c = full.slice();
        for (let k = 0; k < 4; k++) c[Math.floor(c.length - 1 - rnd() * Math.min(c.length - 1, 600))] = Math.floor(rnd() * 256);
        try { await readXref(memorySource(c)); } catch (e) { expect(e).toBeInstanceOf(PdfSyntaxError); }
      }
    }
  });

  it('fichero vacio y un solo byte: PdfSyntaxError', async () => {
    await expect(readXref(memorySource(new Uint8Array(0)))).rejects.toBeInstanceOf(PdfSyntaxError);
    await expect(readXref(memorySource(new Uint8Array([37])))).rejects.toBeInstanceOf(PdfSyntaxError);
  });
});
