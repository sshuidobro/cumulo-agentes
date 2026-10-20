import { describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { needsUserPassword } from '../../src/core/pdf';
import { fixtureSource } from '../helpers/pdfjs-node';

describe('needsUserPassword (PDF-148, sondeo previo)', () => {
  it('un PDF cifrado con AES-256 de contraseña de usuario necesita contraseña', async () => {
    await expect(needsUserPassword(fixtureSource('encrypted-aes-256.pdf'))).resolves.toBe(true);
  });

  it('un PDF cifrado con AES-128 de contraseña de usuario necesita contraseña', async () => {
    await expect(needsUserPassword(fixtureSource('encrypted-aes-128.pdf'))).resolves.toBe(true);
  });

  it('un PDF solo con contraseña de propietario no necesita contraseña', async () => {
    await expect(needsUserPassword(fixtureSource('encrypted-owner-only.pdf'))).resolves.toBe(false);
  });

  it('un PDF sin cifrar no necesita contraseña', async () => {
    await expect(needsUserPassword(fixtureSource('basic-5.pdf'))).resolves.toBe(false);
  });

  it('un fichero que no es PDF devuelve false sin lanzar', async () => {
    const src = memorySource(new TextEncoder().encode('no es un pdf'));
    await expect(needsUserPassword(src)).resolves.toBe(false);
  });
});
