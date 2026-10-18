import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { scanFonts } from '../../src/core/pdf/fonts';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo con `pnpm perf`. Mejor de 3, tras 1 calentamiento.

describe('rendimiento de scanFonts (PDF-088)', () => {
  it('scanFonts de pages-5000.pdf completo tarda menos de 3 s (mejor de 3)', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-5000.pdf')));
    const run = async (): Promise<number> => {
      const reader = await ObjectReader.open(memorySource(data));
      const start = performance.now();
      const result = await scanFonts(reader, 0, 5000, new AbortController().signal);
      const elapsed = performance.now() - start;
      expect(result).not.toBe('cancelled');
      return elapsed;
    };
    await run();
    let best = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 3; r++) best = Math.min(best, await run());
    expect(best).toBeLessThan(3000);
  });
});
