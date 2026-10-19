/**
 * Operaciones `protect`, `unprotect` y `rewrite` del Worker (PDF-131). Se comprueban con pdf.js (abre o pide
 * contraseña) y con qpdf (`--check`, `--show-encryption`). Fixtures de `tests/fixtures/catalog.ts`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type PDFDocumentProxy } from '../../../src/engine';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import type { DocOpRegistry } from '../../../src/core/doc-ops/protocol';
import type { DocOpsClient } from '../../../src/core/doc-ops/client';
import { inProcessDocOps } from '../../../src/state/doc-ops';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck, run } from '../../support/qpdf';

const NOW = '2026-10-19T10:00:00.000Z';
const assetBaseUrl = nodeAssetBase();
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function tempFile(bytes: Uint8Array, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'protect-ops-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

async function withPdf<T>(bytes: Uint8Array, fn: (doc: PDFDocumentProxy) => Promise<T>, password?: string): Promise<T> {
  const opened = await loadPdf(memorySource(bytes), password === undefined ? { assetBaseUrl } : { assetBaseUrl, password });
  if (!opened.ok) throw new Error(`loadPdf falló: ${opened.error.code}`);
  try {
    return await fn(opened.value.doc);
  } finally {
    await opened.value.destroy();
  }
}

async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

const PROTECT_ARGS = {
  password: null,
  userPassword: 'abc',
  ownerPassword: 'propietario',
  permissions: { print: 'high', modify: true, copy: false, annotate: true, fillForms: true, assemble: true },
  now: NOW,
};

/** Operación registrada: el registro de ops siempre tiene estas claves (lo fija el propio código). */
function op(name: 'protect' | 'unprotect' | 'rewrite'): NonNullable<DocOpRegistry[string]> {
  const registered = DOC_OPS[name];
  if (registered === undefined) throw new Error(`la operación ${name} no está registrada`);
  return registered;
}

let client: DocOpsClient | null = null;
function ops(): DocOpsClient {
  client ??= inProcessDocOps();
  return client;
}

afterAll(() => {
  client?.dispose();
});

describe('operación protect (PDF-131)', () => {
  it('basic-5.pdf con usuario abc, propietario y sin copiar: pdf.js pide contraseña y abre con abc', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>('protect', PROTECT_ARGS, [fixture('basic-5.pdf')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.value.bytes;

    const withoutPassword = await loadPdf(memorySource(bytes), { assetBaseUrl });
    expect(withoutPassword.ok).toBe(false);
    if (withoutPassword.ok) return;
    expect(withoutPassword.error.code).toBe('password-required');

    expect(await withPdf(bytes, async (doc) => doc.numPages, 'abc')).toBe(5);
    expect(await withPdf(bytes, async (doc) => pageText(doc, 1), 'abc')).toContain('Página 1 de 5');
  });

  it('qpdf: R = 6, AESv3 y extracción no permitida; --check con la contraseña es 0', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>('protect', PROTECT_ARGS, [fixture('basic-5.pdf')]);
    if (!result.ok) throw new Error(result.error.code);
    const file = tempFile(result.value.bytes, 'protegido.pdf');
    const shown = run(['--show-encryption', '--password=abc', file]);
    expect(shown.status).toBe(0);
    expect(shown.stdout).toContain('R = 6');
    expect(shown.stdout).toContain('AESv3');
    expect(shown.stdout).toContain('extract for any purpose: not allowed');
    expect(qpdfCheck(file, 'abc').code).toBe(0);
  });

  it('argumentos mal formados son un bug: lanza TypeError', async () => {
    const protect = op('protect');
    const ctx = { sources: [], signal: new AbortController().signal, progress: () => undefined };
    await expect(protect({ password: null, now: NOW }, ctx)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('operación unprotect (PDF-131)', () => {
  it('encrypted-aes-256.pdf abierto con propietario → sin cifrar y legible', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>(
      'unprotect',
      { password: 'propietario', now: NOW },
      [fixture('encrypted-aes-256.pdf')],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.value.bytes;
    expect((await ObjectReader.open(memorySource(bytes))).encryptRef).toBeNull();
    expect(qpdfCheck(tempFile(bytes, 'sin-cifrar.pdf')).code).toBe(0);
    expect(await withPdf(bytes, async (doc) => doc.numPages)).toBe(5);
  });

  it('encrypted-aes-256.pdf abierto con usuario (permisos completos) → también se quita', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>(
      'unprotect',
      { password: 'usuario', now: NOW },
      [fixture('encrypted-aes-256.pdf')],
    );
    expect(result.ok).toBe(true);
  });

  it('encrypted-owner-only.pdf abierto con contraseña vacía (usuario con restricciones) → owner-password-required', async () => {
    const result = await ops().run('unprotect', { password: null, now: NOW }, [fixture('encrypted-owner-only.pdf')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('owner-password-required');
    expect(result.error.message).toBe('Para quitar la protección hace falta la contraseña de permisos.');
  });

  it('encrypted-owner-only.pdf abierto con propietario → sin cifrar', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>(
      'unprotect',
      { password: 'propietario', now: NOW },
      [fixture('encrypted-owner-only.pdf')],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await ObjectReader.open(memorySource(result.value.bytes))).encryptRef).toBeNull();
  });

  it('basic-5.pdf sin cifrar → not-protected', async () => {
    const result = await ops().run('unprotect', { password: null, now: NOW }, [fixture('basic-5.pdf')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-protected');
    expect(result.error.message).toBe('Este PDF no tiene contraseña.');
  });

  it('contraseña incorrecta → error de guardado, no se escribe nada', async () => {
    const result = await ops().run('unprotect', { password: 'mal', now: NOW }, [fixture('encrypted-aes-256.pdf')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('save-wrong-password');
  });
});

describe('operación rewrite (PDF-131)', () => {
  it('encrypted-aes-128.pdf con usuario → sigue cifrado y abre con usuario y propietario', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>('rewrite', { password: 'usuario', now: NOW }, [
      fixture('encrypted-aes-128.pdf'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.value.bytes;
    const file = tempFile(bytes, 'reescrito.pdf');
    expect(qpdfCheck(file, 'usuario').code).toBe(0);
    expect(qpdfCheck(file, 'propietario').code).toBe(0);
    expect(await withPdf(bytes, async (doc) => doc.numPages, 'usuario')).toBe(5);
  });

  it('basic-5.pdf sin cifrar → sigue sin cifrar', async () => {
    const result = await ops().run<{ readonly bytes: Uint8Array }>('rewrite', { password: null, now: NOW }, [fixture('basic-5.pdf')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await ObjectReader.open(memorySource(result.value.bytes))).encryptRef).toBeNull();
  });
});
