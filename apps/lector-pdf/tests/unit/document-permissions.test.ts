import { describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSION_FLAG,
  cipherKindOf,
  permissionsFrom,
} from '../../src/core/permissions';
import type { SecurityHandler } from '../../src/core/pdf/crypto';
import { readPermissions } from '../../src/engine/permissions';
import type { PDFDocumentProxy } from '../../src/engine';

/** Manejador de seguridad de prueba: lo que devuelve `openSecurity` tras autenticarse. */
function handler(over: Partial<SecurityHandler>): SecurityHandler {
  return {
    revision: 4,
    fileKey: new Uint8Array(16),
    stringMethod: 'aes128',
    streamMethod: 'aes128',
    encryptMetadata: true,
    permissions: -4,
    authenticatedAs: 'owner',
    ...over,
  };
}

describe('permissionsFrom (PDF-048)', () => {
  it('sin restricciones (null) lo permite todo', () => {
    expect(permissionsFrom(null)).toEqual(ALL_PERMISSIONS);
  });

  it('solo impresión: imprime a 150 ppp, no copia ni comenta', () => {
    expect(permissionsFrom(new Set([4]))).toEqual({
      copy: false,
      print: true,
      printHighQuality: false,
      annotate: false,
      fillForms: false,
      assemble: false,
      modify: false,
    });
  });

  it('la alta calidad exige su bandera propia', () => {
    const flags = new Set<number>([PERMISSION_FLAG.PRINT, PERMISSION_FLAG.PRINT_HIGH_QUALITY]);
    expect(permissionsFrom(flags).printHighQuality).toBe(true);
  });

  it('rellenar formularios se permite con la bandera 256 o con la de comentar (32)', () => {
    expect(permissionsFrom(new Set([256])).fillForms).toBe(true);
    expect(permissionsFrom(new Set([32])).fillForms).toBe(true);
    expect(permissionsFrom(new Set([32])).annotate).toBe(true);
    expect(permissionsFrom(new Set([256])).annotate).toBe(false);
  });

  it('copiar, montar y modificar leen sus banderas', () => {
    const p = permissionsFrom(new Set([16, 1024, 8]));
    expect(p.copy).toBe(true);
    expect(p.assemble).toBe(true);
    expect(p.modify).toBe(true);
    expect(p.print).toBe(false);
  });
});

describe('cipherKindOf (PDF-048)', () => {
  it('sin manejador (sin /Encrypt) es ninguno', () => {
    expect(cipherKindOf(null)).toBe('none');
  });

  it('AES de 256 bits (R6) y de 128 bits (R4)', () => {
    expect(cipherKindOf(handler({ revision: 6, stringMethod: 'aes256', streamMethod: 'aes256', fileKey: new Uint8Array(32) }))).toBe('aes-256');
    expect(cipherKindOf(handler({}))).toBe('aes-128');
  });

  it('RC4 de 40 bits con clave de 5 bytes y de 128 bits con clave de 16', () => {
    const rc4 = { revision: 2 as const, stringMethod: 'rc4' as const, streamMethod: 'rc4' as const };
    expect(cipherKindOf(handler({ ...rc4, fileKey: new Uint8Array(5) }))).toBe('rc4-40');
    expect(cipherKindOf(handler({ ...rc4, revision: 3, fileKey: new Uint8Array(16) }))).toBe('rc4-128');
  });
});

describe('readPermissions (PDF-048)', () => {
  it('devuelve las banderas que da pdf.js', async () => {
    const doc = { getPermissions: vi.fn(() => Promise.resolve(new Set([4, 16]))) } as unknown as PDFDocumentProxy;
    expect(await readPermissions(doc)).toEqual(new Set([4, 16]));
  });

  it('sin restricciones (null) o si falla la lectura, devuelve null y no lanza', async () => {
    const none = { getPermissions: () => Promise.resolve(null) } as unknown as PDFDocumentProxy;
    const broken = {
      getPermissions: () => Promise.reject(new Error('fallo')),
    } as unknown as PDFDocumentProxy;
    expect(await readPermissions(none)).toBeNull();
    expect(await readPermissions(broken)).toBeNull();
  });
});
