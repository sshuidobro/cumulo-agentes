import { describe, expect, it } from 'vitest';
import { createAes256Security, ALL_ALLOWED } from '../../../src/core/pdf/crypto/create-security';
import { openSecurity } from '../../../src/core/pdf/crypto/security';

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const id0 = new Uint8Array(16).fill(7);

describe('QA create-security: contraseñas extremas', () => {
  it.each([['😀🔐 clave'], ['مرحبا'], ['con espacios y ñ Ü']])('ida y vuelta y rechazo de otra %#', (pw) => {
    const s = createAes256Security({ userPassword: pw, ownerPassword: pw + 'x', permissions: ALL_ALLOWED, random: rnd });
    expect(openSecurity(s.encrypt, id0, pw).ok).toBe(true);
    expect(openSecurity(s.encrypt, id0, pw + 'zz')).toEqual({ ok: false, error: 'wrong-password' });
  });
  it('contraseña de 300 caracteres: se trunca a 127 bytes y abre', () => {
    const pw = 'a'.repeat(300);
    const s = createAes256Security({ userPassword: pw, ownerPassword: '', permissions: ALL_ALLOWED, random: rnd });
    expect(openSecurity(s.encrypt, id0, pw).ok).toBe(true);
    expect(openSecurity(s.encrypt, id0, 'a'.repeat(127)).ok).toBe(true);
  });
});
