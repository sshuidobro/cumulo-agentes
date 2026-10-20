import { verify, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openP12 } from '../../../src/core/signature/digital/p12';
import { certFixtures, TEST_CN, TEST_P12_PASSWORD } from '../../support/certs';

const DATA = new TextEncoder().encode('datos de prueba para la firma');

describe('openP12', () => {
  it('abre un .p12 con AES y da el CN del certificado', () => {
    const result = openP12(certFixtures().rsaAes, TEST_P12_PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.info.subject).toBe(TEST_CN);
    expect(result.value.info.issuer).toBe(TEST_CN);
    expect(result.value.info.serial).toMatch(/^[0-9a-f]+$/);
    expect(new Date(result.value.info.validTo).getTime()).toBeGreaterThan(new Date(result.value.info.validFrom).getTime());
    expect(result.value.chainDer).toHaveLength(0);
  });

  it('abre un .p12 con 3DES heredado y da el mismo CN', () => {
    const result = openP12(certFixtures().rsa3des, TEST_P12_PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.info.subject).toBe(TEST_CN);
  });

  it('la firma RSA PKCS#1 v1.5 con SHA-256 la verifica la clave pública del certificado', () => {
    const result = openP12(certFixtures().rsaAes, TEST_P12_PASSWORD);
    if (!result.ok) throw new Error(result.error.code);
    const signature = result.value.sign(DATA);
    const publicKey = new X509Certificate(result.value.certDer).publicKey;
    expect(verify('sha256', DATA, publicKey, signature)).toBe(true);
    expect(verify('sha256', new TextEncoder().encode('otros datos'), publicKey, signature)).toBe(false);
  });

  it('contraseña incorrecta → p12-wrong-password', () => {
    const result = openP12(certFixtures().rsaAes, 'mala');
    expect(result).toMatchObject({ ok: false, error: { code: 'p12-wrong-password', message: 'La contraseña del certificado no es correcta.' } });
  });

  it('contraseña incorrecta con 3DES → p12-wrong-password', () => {
    const result = openP12(certFixtures().rsa3des, 'mala');
    expect(result).toMatchObject({ ok: false, error: { code: 'p12-wrong-password' } });
  });

  it('bytes que no son un PKCS#12 → p12-invalid', () => {
    const garbage = new TextEncoder().encode('esto no es un p12, ni siquiera ASN.1');
    expect(openP12(garbage, TEST_P12_PASSWORD)).toMatchObject({ ok: false, error: { code: 'p12-invalid' } });
    expect(openP12(new Uint8Array(0), TEST_P12_PASSWORD)).toMatchObject({ ok: false, error: { code: 'p12-invalid' } });
  });

  it('clave EC → p12-unsupported-key', () => {
    expect(openP12(certFixtures().ec, TEST_P12_PASSWORD)).toMatchObject({ ok: false, error: { code: 'p12-unsupported-key' } });
  });

  it('sin clave privada → p12-no-key', () => {
    expect(openP12(certFixtures().certOnly, TEST_P12_PASSWORD)).toMatchObject({ ok: false, error: { code: 'p12-no-key' } });
  });

  it('el certificado del firmante es el de la clave; la CA va en la cadena', () => {
    const result = openP12(certFixtures().chain, TEST_P12_PASSWORD);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.info.subject).toBe(TEST_CN);
    expect(result.value.chainDer).toHaveLength(1);
    const ca = new X509Certificate(result.value.chainDer[0] ?? new Uint8Array());
    expect(ca.subject).toContain('CN=Prueba CA');
    expect(result.value.info.issuer).toBe('Prueba CA');
  });

  it('sin CN, el nombre que se muestra es el DN completo', () => {
    const result = openP12(certFixtures().noCn, TEST_P12_PASSWORD);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.info.subject).toBe('O=Prueba, C=ES');
  });
});
