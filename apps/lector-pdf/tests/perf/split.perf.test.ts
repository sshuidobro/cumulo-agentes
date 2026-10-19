import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { DOC_OPS } from '../../src/core/doc-ops/ops';
import type { OpContext } from '../../src/core/doc-ops/protocol';
import { FIXTURES_DIR } from '../fixtures/paths';

// Asserts de tiempo de reloj (ADR-0012): solo con `pnpm perf`. Mismo criterio que new-document.perf.test.ts:
// 1 calentamiento y la mejor de 3 pasadas, cada una con la operación completa `split` (PDF-054).

const NOW = '2026-10-19T10:00:00.000Z';

const split = DOC_OPS.split;
if (split === undefined) throw new Error('la operación split no está registrada');
const BUDGET_MS = 5_000;

describe('perf: split (PDF-054)', () => {
  it('pages-5000.pdf cada 100 páginas (50 partes) < 5 000 ms', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'pages-5000.pdf')));
    const run = async (): Promise<number> => {
      const ctx: OpContext = {
        sources: [memorySource(bytes)],
        signal: new AbortController().signal,
        progress: () => undefined,
      };
      const result = await split({ password: null, mode: { kind: 'pages', every: 100 }, baseName: 'pages', now: NOW }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return 0;
      return (result.value as { readonly parts: number }).parts;
    };
    await run();
    let best = Number.POSITIVE_INFINITY;
    let parts = 0;
    for (let r = 0; r < 3; r++) {
      const start = performance.now();
      parts = await run();
      best = Math.min(best, performance.now() - start);
    }
    expect(parts).toBe(50);
    expect(best).toBeLessThan(BUDGET_MS);
  }, 300_000);
});
