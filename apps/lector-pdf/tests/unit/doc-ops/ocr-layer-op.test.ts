/**
 * Operación `ocr-layer` del Worker (PDF-061): argumentos, fuente 0 y resultado `delta`. La capa en sí se prueba en
 * `tests/unit/ocr/text-layer.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import type { OpContext } from '../../../src/core/doc-ops/protocol';
import { ensureFixtures } from '../../fixtures/ensure.ts';
import { FIXTURES_DIR } from '../../fixtures/paths.ts';

const NOW = '2026-10-20T10:00:00.000Z';

function context(bytes: Uint8Array, signal: AbortSignal = new AbortController().signal): OpContext {
  return { sources: [memorySource(bytes)], signal, progress: () => undefined };
}

function args(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    password: null,
    now: NOW,
    pages: [{ pageIndex: 0, rotate: 0, words: [{ text: 'Factura', box: [72, 700, 150, 712] }] }],
    ...overrides,
  };
}

describe('operación ocr-layer', () => {
  ensureFixtures();
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
  const op = DOC_OPS['ocr-layer'];
  if (op === undefined) throw new Error('falta la operación ocr-layer');

  it('devuelve el delta del incremento sobre la fuente 0', async () => {
    const result = await op(args(), context(bytes));
    if (!result.ok) throw new Error(result.error.code);
    const { delta } = result.value as { delta: Uint8Array };
    expect(delta.length).toBeGreaterThan(0);
  });

  it('una lista de páginas vacía devuelve delta vacío', async () => {
    const result = await op(args({ pages: [] }), context(bytes));
    if (!result.ok) throw new Error(result.error.code);
    expect((result.value as { delta: Uint8Array }).delta.length).toBe(0);
  });

  it('una operación cancelada devuelve cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await op(args(), context(bytes, controller.signal));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cancelled');
  });

  it('argumentos mal formados lanzan TypeError (son un bug de la app)', async () => {
    await expect(op({ password: null, now: NOW }, context(bytes))).rejects.toThrow(TypeError);
    await expect(op(args({ password: 3 }), context(bytes))).rejects.toThrow(TypeError);
    await expect(op(args({ pages: 'x' }), context(bytes))).rejects.toThrow(TypeError);
    await expect(op(args({ pages: [{ pageIndex: 0, rotate: 45, words: [] }] }), context(bytes))).rejects.toThrow(TypeError);
    await expect(op(args({ now: 5 }), context(bytes))).rejects.toThrow(TypeError);
  });

  it('sin fuente 0 lanza RangeError', async () => {
    await expect(op(args(), { sources: [], signal: new AbortController().signal, progress: () => undefined })).rejects.toThrow(RangeError);
  });
});
