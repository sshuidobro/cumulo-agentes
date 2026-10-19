import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { unzipSync } from 'fflate';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadPdf, type PDFDocumentProxy } from '../../../src/engine';
import { pdfError } from '../../../src/core/errors';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import type { OpContext } from '../../../src/core/doc-ops/protocol';
import { inProcessDocOps } from '../../../src/state/doc-ops';
import type * as NewDocumentModule from '../../../src/core/pdf/new-document';
import { buildNewDocument } from '../../../src/core/pdf/new-document';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck } from '../../support/qpdf';

// Espía sobre buildNewDocument: por defecto se comporta igual; el test de la red de seguridad fuerza una parte grande.
vi.mock('../../../src/core/pdf/new-document', async (importOriginal) => {
  const actual = await importOriginal<typeof NewDocumentModule>();
  return { ...actual, buildNewDocument: vi.fn(actual.buildNewDocument) };
});

const NOW = '2026-10-19T10:00:00.000Z';

const split = DOC_OPS.split;
if (split === undefined) throw new Error('la operación split no está registrada');
const assetBaseUrl = nodeAssetBase();
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function tempFile(bytes: Uint8Array, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'split-ops-'));
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

/** Número de páginas de un PDF en memoria (lector sin contraseña). */
async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await ObjectReader.open(memorySource(bytes))).pageCount();
}

describe('operación extract', () => {
  it('outline.pdf páginas [2..6] (base 0): 5 páginas que dicen «Página 3 de 30»…«Página 7 de 30»', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<{ readonly bytes: Uint8Array }>(
        'extract',
        { password: null, pages: [2, 3, 4, 5, 6], now: NOW, title: 'Extracto' },
        [fixture('outline.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const bytes = result.value.bytes;
      expect(await pageCountOf(bytes)).toBe(5);
      await withPdf(bytes, async (doc) => {
        expect(doc.numPages).toBe(5);
        expect(await pageText(doc, 1)).toContain('Página 3 de 30');
        expect(await pageText(doc, 5)).toContain('Página 7 de 30');
      });
      expect(qpdfCheck(tempFile(bytes, 'extract.pdf')).code).toBe(0);
    } finally {
      client.dispose();
    }
  });

  it('encrypted-aes-256.pdf con la contraseña de usuario: PDF sin cifrar y legible', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<{ readonly bytes: Uint8Array }>(
        'extract',
        { password: 'usuario', pages: [0, 1], now: NOW, title: '' },
        [fixture('encrypted-aes-256.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const bytes = result.value.bytes;
      expect(new TextDecoder('latin1').decode(bytes)).not.toContain('/Encrypt');
      expect(await pageCountOf(bytes)).toBe(2);
      await withPdf(bytes, async (doc) => {
        expect(doc.numPages).toBe(2);
      });
    } finally {
      client.dispose();
    }
  });

  it('contraseña incorrecta: save-wrong-password', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run('extract', { password: 'mala', pages: [0], now: NOW, title: 'x' }, [
        fixture('encrypted-aes-256.pdf'),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('save-wrong-password');
    } finally {
      client.dispose();
    }
  });

  it('una página que no existe: organize-invalid', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run('extract', { password: null, pages: [0, 99], now: NOW, title: 'x' }, [fixture('basic-5.pdf')]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('organize-invalid');
    } finally {
      client.dispose();
    }
  });

  it('argumentos mal formados: el Worker no los acepta (bug de la app, no del usuario)', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run('extract', { password: null, pages: ['a'], now: NOW, title: 'x' }, [fixture('basic-5.pdf')]);
      expect(result.ok).toBe(false);
    } finally {
      client.dispose();
    }
  });
});

interface SplitZip {
  readonly zip: Uint8Array;
  readonly parts: number;
  readonly oversized: number;
}

describe('operación split', () => {
  it('outline.pdf por marcadores: ZIP con 4 PDF de 10, 10, 9 y 1 páginas, todos válidos para qpdf', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<SplitZip>(
        'split',
        { password: null, mode: { kind: 'bookmarks' }, baseName: 'outline', now: NOW },
        [fixture('outline.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.parts).toBe(4);
      expect(result.value.oversized).toBe(0);
      const entries = unzipSync(result.value.zip);
      expect(Object.keys(entries)).toEqual(['outline-parte-01.pdf', 'outline-parte-02.pdf', 'outline-parte-03.pdf', 'outline-parte-04.pdf']);
      const counts: number[] = [];
      for (const [name, bytes] of Object.entries(entries)) {
        counts.push(await pageCountOf(bytes));
        expect(qpdfCheck(tempFile(bytes, name)).code).toBe(0);
      }
      expect(counts).toEqual([10, 10, 9, 1]);
    } finally {
      client.dispose();
    }
  });

  it('basic-5.pdf por marcadores: split-no-bookmarks', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run('split', { password: null, mode: { kind: 'bookmarks' }, baseName: 'basic', now: NOW }, [
        fixture('basic-5.pdf'),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('split-no-bookmarks');
    } finally {
      client.dispose();
    }
  });

  it('pages-5000.pdf por tamaño de 100 000 bytes: la suma de páginas de las partes es 5000 y no hay páginas sueltas oversized', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<SplitZip>(
        'split',
        { password: null, mode: { kind: 'size', maxBytes: 100_000 }, baseName: 'pages', now: NOW },
        [fixture('pages-5000.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.oversized).toBe(0);
      const entries = Object.values(unzipSync(result.value.zip));
      expect(entries.length).toBe(result.value.parts);
      let pages = 0;
      for (const bytes of entries) {
        expect(bytes.length).toBeLessThanOrEqual(100_000);
        pages += await pageCountOf(bytes);
      }
      expect(pages).toBe(5000);
    } finally {
      client.dispose();
    }
  }, 120_000);

  it('modo size: si una parte escrita supera el máximo, la red de seguridad la parte en dos mitades', async () => {
    // El estimador no ve la parte grande; se simula con la primera escritura (fingida, de 200 000 bytes).
    // Las dos mitades se escriben de verdad y deben caber.
    vi.mocked(buildNewDocument).mockClear();
    vi.mocked(buildNewDocument).mockImplementationOnce(async () => ({ ok: true, value: { bytes: new Uint8Array(200_000), pageCount: 30 } }));
    const client = inProcessDocOps();
    try {
      const result = await client.run<SplitZip>('split', { password: null, mode: { kind: 'size', maxBytes: 100_000 }, baseName: 'outline', now: NOW }, [
        fixture('outline.pdf'),
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(vi.mocked(buildNewDocument)).toHaveBeenCalledTimes(3);
      expect(result.value.parts).toBe(2);
      expect(result.value.oversized).toBe(0);
      const entries = Object.entries(unzipSync(result.value.zip));
      expect(entries.map(([name]) => name)).toEqual(['outline-parte-01.pdf', 'outline-parte-02.pdf']);
      let pages = 0;
      for (const [, bytes] of entries) {
        expect(bytes.length).toBeLessThanOrEqual(100_000);
        pages += await pageCountOf(bytes);
      }
      expect(pages).toBe(30);
    } finally {
      client.dispose();
    }
  });

  it('pages cada 2 sobre outline.pdf: 15 partes de 2 páginas (la última de 2)', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<SplitZip>('split', { password: null, mode: { kind: 'pages', every: 2 }, baseName: 'outline', now: NOW }, [
        fixture('outline.pdf'),
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.parts).toBe(15);
      const counts: number[] = [];
      for (const bytes of Object.values(unzipSync(result.value.zip))) counts.push(await pageCountOf(bytes));
      expect(counts.every((count) => count === 2)).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it('informa del progreso con el total de páginas escritas', async () => {
    const client = inProcessDocOps();
    const calls: [number, number][] = [];
    try {
      const result = await client.run<SplitZip>(
        'split',
        { password: null, mode: { kind: 'pages', every: 4 }, baseName: 'outline', now: NOW },
        [fixture('outline.pdf')],
        { onProgress: (done, total) => calls.push([done, total]) },
      );
      expect(result.ok).toBe(true);
      expect(calls.at(-1)).toEqual([30, 30]);
      for (const [, total] of calls) expect(total).toBe(30);
    } finally {
      client.dispose();
    }
  });

  it('cancelar a mitad aborta la división: cancelled', async () => {
    // La operación se llama directamente: el canal del cliente no entrega el aborto hasta que la operación termina.
    const controller = new AbortController();
    const ctx: OpContext = {
      sources: [memorySource(fixture('pages-5000.pdf'))],
      signal: controller.signal,
      progress: (done) => {
        if (done >= 100) controller.abort();
      },
    };
    const result = await split(
      { password: null, mode: { kind: 'pages', every: 50 }, baseName: 'pages', now: NOW },
      ctx,
    );
    expect(result).toEqual({ ok: false, error: pdfError('cancelled') });
  });

  it('modo desconocido o argumentos incompletos: el Worker no los acepta', async () => {
    const client = inProcessDocOps();
    try {
      const badMode = await client.run('split', { password: null, mode: { kind: 'texto' }, baseName: 'x', now: NOW }, [fixture('basic-5.pdf')]);
      expect(badMode.ok).toBe(false);
      const missing = await client.run('split', { password: null, baseName: 'x', now: NOW }, [fixture('basic-5.pdf')]);
      expect(missing.ok).toBe(false);
    } finally {
      client.dispose();
    }
  });
});
