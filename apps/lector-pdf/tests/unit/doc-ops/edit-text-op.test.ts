/**
 * Operaciones del Worker `edit-text-probe` y `edit-text` (PDF-145): forma de los argumentos, sondeo de líneas,
 * reescritura completa con cifrado conservado y errores como `Result`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import type { OpContext } from '../../../src/core/doc-ops/protocol';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import { ensureFixtures } from '../../fixtures/ensure.ts';
import { FIXTURES_DIR } from '../../fixtures/paths.ts';

const BASIC = 'basic-5.pdf';
const ENCRYPTED = 'encrypted-aes-256.pdf';
const NOW = '2026-10-20T10:00:00.000Z';
const SEARCH_HINT: readonly [number, number, number, number] = [71, 674, 500, 687];
const SEARCH_NEW = 'Texto de búsqueda en la hoja dos.';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Texto de una página con `pdftotext` (poppler) sobre un fichero temporal. */
function pdftotextOf(data: Uint8Array, page: number, password?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'suite-edit-text-op-'));
  try {
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, data);
    const args = ['-f', String(page), '-l', String(page), ...(password === undefined ? [] : ['-upw', password]), file, '-'];
    const result = spawnSync('pdftotext', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`pdftotext falló: ${result.stderr}`);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function context(data: Uint8Array, signal = new AbortController().signal): OpContext {
  return { sources: [memorySource(data)], signal, progress: () => undefined };
}

function opNamed(name: string): NonNullable<(typeof DOC_OPS)[string]> {
  const op = DOC_OPS[name];
  if (op === undefined) throw new Error(`falta la operación ${name}`);
  return op;
}

describe('operación edit-text-probe', () => {
  ensureFixtures();

  it('la línea de basic-5.pdf (página 2) devuelve su origen [72, 676]', async () => {
    const result = await opNamed('edit-text-probe')({ password: null, pageIndex: 1, hint: SEARCH_HINT }, context(fixture(BASIC)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const probe = result.value as { readonly line?: { readonly origin: readonly number[]; readonly pageIndex: number } };
    expect(probe.line?.origin).toEqual([72, 676]);
    expect(probe.line?.pageIndex).toBe(1);
  });

  it('una zona vacía devuelve { issue: "no-text" }', async () => {
    const result = await opNamed('edit-text-probe')(
      { password: null, pageIndex: 1, hint: [300, 300, 400, 320] },
      context(fixture(BASIC)),
    );
    expect(result).toEqual({ ok: true, value: { issue: 'no-text' } });
  });

  it('contraseña incorrecta → error como Result', async () => {
    const result = await opNamed('edit-text-probe')(
      { password: 'mal', pageIndex: 0, hint: SEARCH_HINT },
      context(fixture(ENCRYPTED)),
    );
    expect(result.ok).toBe(false);
  });

  it('argumentos mal formados lanzan TypeError', async () => {
    const op = opNamed('edit-text-probe');
    const ctx = context(fixture(BASIC));
    await expect(op(null, ctx)).rejects.toThrow(TypeError);
    await expect(op({ password: 1, pageIndex: 0, hint: SEARCH_HINT }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ password: null, pageIndex: '1', hint: SEARCH_HINT }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ password: null, pageIndex: 0, hint: [1, 2, 3] }, ctx)).rejects.toThrow(TypeError);
  });

  it('señal abortada → cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await opNamed('edit-text-probe')(
      { password: null, pageIndex: 1, hint: SEARCH_HINT },
      context(fixture(BASIC), controller.signal),
    );
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });
});

describe('operación edit-text', () => {
  ensureFixtures();

  it('basic-5.pdf: reemplaza la línea y el resultado valida con pdftotext', async () => {
    const result = await opNamed('edit-text')(
      { password: null, now: NOW, edits: [{ pageIndex: 1, hint: SEARCH_HINT, text: SEARCH_NEW }] },
      context(fixture(BASIC)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = (result.value as { readonly bytes: Uint8Array }).bytes;
    expect(pdftotextOf(bytes, 2)).toContain(SEARCH_NEW);
  });

  it('encrypted-aes-256.pdf con «usuario»: resultado cifrado', async () => {
    const result = await opNamed('edit-text')(
      { password: 'usuario', now: NOW, edits: [{ pageIndex: 1, hint: SEARCH_HINT, text: SEARCH_NEW }] },
      context(fixture(ENCRYPTED)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = (result.value as { readonly bytes: Uint8Array }).bytes;
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Encrypt');
    expect(pdftotextOf(bytes, 2, 'usuario')).toContain(SEARCH_NEW);
  });

  it('sin ediciones devuelve el documento reescrito sin cambios de texto', async () => {
    const result = await opNamed('edit-text')({ password: null, now: NOW, edits: [] }, context(fixture(BASIC)));
    expect(result.ok).toBe(true);
  });

  it('argumentos mal formados lanzan TypeError', async () => {
    const op = opNamed('edit-text');
    const ctx = context(fixture(BASIC));
    const base = { password: null, now: NOW, edits: [] };
    await expect(op(null, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, password: 3 }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, now: 3 }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, edits: 'no' }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, edits: [null] }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, edits: [{ pageIndex: 0, hint: SEARCH_HINT }] }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, edits: [{ pageIndex: '0', hint: SEARCH_HINT, text: 'a' }] }, ctx)).rejects.toThrow(TypeError);
    await expect(op({ ...base, edits: [{ pageIndex: 0, hint: [1], text: 'a' }] }, ctx)).rejects.toThrow(TypeError);
  });

  it('texto no representable → edit-text-invalid como Result', async () => {
    const result = await opNamed('edit-text')(
      { password: null, now: NOW, edits: [{ pageIndex: 1, hint: SEARCH_HINT, text: 'Hola 😀' }] },
      context(fixture(BASIC)),
    );
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'edit-text-invalid' }) });
  });

  it('señal abortada → cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await opNamed('edit-text')(
      { password: null, now: NOW, edits: [{ pageIndex: 1, hint: SEARCH_HINT, text: 'a' }] },
      context(fixture(BASIC), controller.signal),
    );
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });
});
