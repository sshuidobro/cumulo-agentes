import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inProcessDocOps } from '../../src/state/doc-ops';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo con `pnpm perf`. Mejor de 3 ejecuciones (ficha PDF-118).

describe('rendimiento de operaciones de documento', () => {
  it('page-rotations sobre pages-100000.pdf por el cliente en el mismo hilo tarda menos de 4 s (mejor de 3)', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-100000.pdf')));
    const client = inProcessDocOps();
    try {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        const result = await client.run<readonly number[]>('page-rotations', { password: null }, [bytes]);
        best = Math.min(best, performance.now() - start);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.length).toBe(100000);
      }
      expect(best).toBeLessThan(4000);
    } finally {
      client.dispose();
    }
  }, 60_000);
});
