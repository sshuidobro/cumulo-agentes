import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { buildPdfFromImages, type ImageInput } from '../../src/core/pdf/images-to-pdf';

// Asserts de tiempo de reloj (ADR-0012): solo se ejecutan con `pnpm perf`, nunca en `pnpm test` ni `pnpm coverage`.
// Mismo criterio que `bestOf` de new-document.perf.test.ts: 1 calentamiento, mejor de 3.

const NOW = '2026-10-19T10:00:00.000Z';
const ONE_MB = 1024 * 1024;
const FILE_TIMEOUT = 120_000;

async function bestOf<T>(runs: number, warmup: number, fn: () => Promise<T>): Promise<{ readonly value: T; readonly ms: number }> {
  for (let w = 0; w < warmup; w++) await fn();
  let best = Number.POSITIVE_INFINITY;
  let last: T | null = null;
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    last = await fn();
    best = Math.min(best, performance.now() - start);
  }
  if (last === null) throw new RangeError('bestOf: se requiere runs >= 1');
  return { value: last, ms: best };
}

/** JPEG de unos 1 MB: un JPEG real de canvas con segmentos COM (ignorados por el decodificador) hasta ese tamaño. */
function jpegOfOneMegabyte(): Uint8Array {
  const canvas = createCanvas(64, 64);
  const context = canvas.getContext('2d');
  context.fillStyle = '#884422';
  context.fillRect(0, 0, 64, 64);
  const base = new Uint8Array(canvas.encodeSync('jpeg', 95));
  const segment = 0xffff - 2;
  const padding: number[] = [];
  const segmentsNeeded = Math.ceil((ONE_MB - base.length) / (segment + 2));
  for (let s = 0; s < segmentsNeeded; s++) {
    padding.push(0xff, 0xfe, (segment + 2) >> 8, (segment + 2) & 0xff, ...new Array<number>(segment).fill(0x20));
  }
  return new Uint8Array([...base.subarray(0, 2), ...padding, ...base.subarray(2)]);
}

describe('rendimiento de los PDF desde imágenes (PDF-056)', () => {
  it('200 JPEG de 1 MB (el mismo repetido) tardan menos de 1 500 ms (mejor de 3)', async () => {
    const jpeg = jpegOfOneMegabyte();
    expect(jpeg.length).toBeGreaterThan(ONE_MB * 0.99);
    const images: ImageInput[] = Array.from({ length: 200 }, (_, i) => ({ kind: 'jpeg', name: `foto-${i}.jpg`, bytes: jpeg }));
    const { value, ms } = await bestOf(3, 1, async () => {
      const result = await buildPdfFromImages({ images, pageSize: 'fit', margin: 0, now: NOW });
      if (!result.ok) throw new Error(`buildPdfFromImages falló: ${result.error.code}`);
      return result.value;
    });
    expect(value.pages).toBe(200);
    expect(ms, '200 JPEG de 1 MB').toBeLessThan(1500);
  }, FILE_TIMEOUT);
});
