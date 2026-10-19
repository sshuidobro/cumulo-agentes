import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inProcessDocOps } from '../../../src/state/doc-ops';
import { FIXTURES_DIR } from '../../fixtures/paths';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

describe('operación page-rotations', () => {
  it('basic-5.pdf: las cinco páginas tienen giro 0', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run('page-rotations', { password: null }, [fixture('basic-5.pdf')]);
      expect(result).toEqual({ ok: true, value: [0, 0, 0, 0, 0] });
    } finally {
      client.dispose();
    }
  });

  it('encrypted-aes-256.pdf con la contraseña de usuario: devuelve los 5 giros', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<readonly number[]>('page-rotations', { password: 'usuario' }, [fixture('encrypted-aes-256.pdf')]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([0, 0, 0, 0, 0]);
    } finally {
      client.dispose();
    }
  });

  it('encrypted-aes-256.pdf con contraseña incorrecta: save-wrong-password', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run('page-rotations', { password: 'mala-contraseña' }, [fixture('encrypted-aes-256.pdf')]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('save-wrong-password');
    } finally {
      client.dispose();
    }
  });
});
