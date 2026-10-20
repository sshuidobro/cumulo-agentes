/**
 * Operaciones `p12-info` y `sign` del Worker (PDF-066): datos del certificado sin exponer la clave, y firma
 * PAdES B-B del PDF devuelta como incremento. La validez de la firma la comprueba `pdfsig`.
 */
import { memorySource, type ByteSource } from '@suite/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import type { OpContext } from '../../../src/core/doc-ops/protocol';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { certFixtures, TEST_CN, TEST_P12_PASSWORD } from '../../support/certs';
import { pdfsig } from '../../support/pdfsig';

const NOW = '2026-10-19T10:00:00.000Z';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function ctx(sources: readonly ByteSource[], aborted = false): OpContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return { sources, signal: controller.signal, progress: () => undefined };
}

function signArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    password: null,
    p12: certFixtures().rsaAes,
    p12Password: TEST_P12_PASSWORD,
    pageIndex: 0,
    rect: null,
    reason: 'Revisado',
    location: '',
    now: NOW,
    ...overrides,
  };
}

describe('operación p12-info', () => {
  it('devuelve los datos del certificado, sin la clave privada', async () => {
    const result = await DOC_OPS['p12-info']?.({ p12: certFixtures().rsaAes, password: TEST_P12_PASSWORD }, ctx([]));
    expect(result).toMatchObject({ ok: true, value: { subject: TEST_CN, issuer: TEST_CN } });
    if (result?.ok !== true) return;
    expect(Object.keys(result.value as object).sort()).toEqual(['issuer', 'serial', 'subject', 'validFrom', 'validTo']);
  });

  it('contraseña incorrecta → p12-wrong-password', async () => {
    const result = await DOC_OPS['p12-info']?.({ p12: certFixtures().rsaAes, password: 'mala' }, ctx([]));
    expect(result).toMatchObject({ ok: false, error: { code: 'p12-wrong-password' } });
  });

  it('argumentos mal formados son un bug: lanza TypeError', async () => {
    await expect(DOC_OPS['p12-info']?.({ p12: 'no es bytes', password: '' }, ctx([]))).rejects.toBeInstanceOf(TypeError);
    await expect(DOC_OPS['p12-info']?.({ p12: new Uint8Array(0) }, ctx([]))).rejects.toBeInstanceOf(TypeError);
  });
});

describe('operación sign', () => {
  it('firma el PDF y devuelve un incremento que pdfsig valida', async () => {
    const original = fixture('basic-5.pdf');
    const result = await DOC_OPS.sign?.(signArgs(), ctx([memorySource(original)]));
    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    const { delta } = result.value as { readonly delta: Uint8Array };
    const signed = new Uint8Array(original.length + delta.length);
    signed.set(original, 0);
    signed.set(delta, original.length);
    expect(pdfsig(signed).output).toContain('Signature Validation: Signature is Valid.');
  });

  it('certificado con contraseña incorrecta → error del certificado, sin firmar', async () => {
    const result = await DOC_OPS.sign?.(signArgs({ p12Password: 'mala' }), ctx([memorySource(fixture('basic-5.pdf'))]));
    expect(result).toMatchObject({ ok: false, error: { code: 'p12-wrong-password' } });
  });

  it('PDF cifrado sin contraseña del documento → error de apertura al guardar', async () => {
    const result = await DOC_OPS.sign?.(signArgs(), ctx([memorySource(fixture('encrypted-aes-256.pdf'))]));
    expect(result).toMatchObject({ ok: false, error: { code: 'save-wrong-password' } });
  });

  it('PDF cifrado con su contraseña → sign-encrypted', async () => {
    const result = await DOC_OPS.sign?.(signArgs({ password: 'usuario' }), ctx([memorySource(fixture('encrypted-aes-256.pdf'))]));
    expect(result).toMatchObject({ ok: false, error: { code: 'sign-encrypted' } });
  });

  it('operación cancelada → cancelled', async () => {
    const result = await DOC_OPS.sign?.(signArgs(), ctx([memorySource(fixture('basic-5.pdf'))], true));
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });

  it('sin documento o con argumentos mal formados es un bug: lanza', async () => {
    await expect(DOC_OPS.sign?.(signArgs(), ctx([]))).rejects.toBeInstanceOf(RangeError);
    await expect(DOC_OPS.sign?.(signArgs({ rect: [1, 2, 3] }), ctx([memorySource(fixture('basic-5.pdf'))]))).rejects.toBeInstanceOf(TypeError);
    await expect(DOC_OPS.sign?.({ password: null }, ctx([memorySource(fixture('basic-5.pdf'))]))).rejects.toBeInstanceOf(TypeError);
    await expect(DOC_OPS.sign?.(signArgs({ pageIndex: -1 }), ctx([memorySource(fixture('basic-5.pdf'))]))).rejects.toBeInstanceOf(TypeError);
  });
});
