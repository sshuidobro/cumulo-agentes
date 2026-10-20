/**
 * Operaciones `combine` (PDF-055) y `organize` con PDF importados (PDF-055), por el registro de operaciones del
 * Worker. Los ficheros se validan con pdf.js (el visor) y con qpdf (lector independiente).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type LoadedPdf, type PDFDocumentProxy } from '../../../src/engine';
import { resolveDest } from '../../../src/engine/dest';
import { getOutline } from '../../../src/engine/outline';
import type { OutlineNode } from '../../../src/core/outline';
import type { SaveSlot } from '../../../src/core/organize/plan';
import { inProcessDocOps } from '../../../src/state/doc-ops';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck } from '../../support/qpdf';

const assetBaseUrl = nodeAssetBase();
const NOW = '2026-10-20T10:00:00.000Z';
const FILE_TIMEOUT = 120_000;
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function tempFile(data: Uint8Array, file = 'salida.pdf'): string {
  const dir = mkdtempSync(join(tmpdir(), 'suite-combine-'));
  tempDirs.push(dir);
  const path = join(dir, file);
  writeFileSync(path, data);
  return path;
}

async function openPdf(data: Uint8Array, password?: string): Promise<LoadedPdf> {
  const result = await loadPdf(memorySource(data), password === undefined ? { assetBaseUrl } : { assetBaseUrl, password });
  if (!result.ok) throw new Error(`loadPdf falló: ${result.error.code}`);
  return result.value;
}

async function withPdf<T>(bytes: Uint8Array, fn: (doc: PDFDocumentProxy) => Promise<T>, password?: string): Promise<T> {
  const loaded = await openPdf(bytes, password);
  try {
    return await fn(loaded.doc);
  } finally {
    await loaded.destroy();
  }
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await ObjectReader.open(memorySource(bytes))).pageCount();
}

function nodeTitled(nodes: readonly OutlineNode[], title: string): OutlineNode {
  const found = nodes.find((node) => node.title === title);
  if (found === undefined) throw new Error(`no hay entrada «${title}»`);
  return found;
}

async function pageOf(loaded: LoadedPdf, node: OutlineNode): Promise<number | null> {
  if (node.target.kind !== 'internal') return null;
  return (await resolveDest(loaded.doc, node.target.dest))?.pageIndex ?? null;
}

describe('operación combine (PDF-055)', () => {
  it('basic-5.pdf y outline.pdf → 35 páginas; ramas basic-5 y outline con el índice de outline bajo su rama', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run<{ readonly bytes: Uint8Array; readonly pageCount: number }>(
        'combine',
        {
          parts: [
            { password: null, title: 'basic-5' },
            { password: null, title: 'outline' },
          ],
          now: NOW,
        },
        [fixture('basic-5.pdf'), fixture('outline.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { bytes, pageCount } = result.value;
      expect(pageCount).toBe(35);
      expect(await pageCountOf(bytes)).toBe(35);
      expect(qpdfCheck(tempFile(bytes)).code).toBe(0);

      const loaded = await openPdf(bytes);
      try {
        expect(loaded.doc.numPages).toBe(35);
        const top = await getOutline(loaded.doc);
        expect(top.map((node) => node.title)).toEqual(['basic-5', 'outline']);
        expect(await pageOf(loaded, nodeTitled(top, 'basic-5'))).toBe(0);
        const chapters = nodeTitled(top, 'outline').children;
        expect(await pageOf(loaded, nodeTitled(chapters, 'Capítulo 2'))).toBe(15);
        expect(await pageOf(loaded, nodeTitled(chapters, 'Anexo'))).toBe(34);
      } finally {
        await loaded.destroy();
      }
    } finally {
      client.dispose();
    }
  }, FILE_TIMEOUT);

  it('annotated.pdf + form.pdf: anotaciones y campos presentes en el resultado', async () => {
    const client = inProcessDocOps();
    try {
      const annotated = fixture('annotated.pdf');
      const form = fixture('form.pdf');
      const result = await client.run<{ readonly bytes: Uint8Array; readonly pageCount: number }>(
        'combine',
        {
          parts: [
            { password: null, title: 'anotado' },
            { password: null, title: 'formulario' },
          ],
          now: NOW,
        },
        [annotated, form],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { bytes } = result.value;
      expect(qpdfCheck(tempFile(bytes)).code).toBe(0);
      const annotatedPages = await withPdf(annotated, async (doc) => doc.numPages);
      const annotationCount = await withPdf(annotated, async (doc) => {
        let total = 0;
        for (let i = 1; i <= doc.numPages; i++) total += (await (await doc.getPage(i)).getAnnotations()).length;
        return total;
      });
      const fieldCount = await withPdf(form, async (doc) => {
        const fields: unknown = await doc.getFieldObjects();
        return fields instanceof Map ? fields.size : 0;
      });
      expect(annotationCount).toBeGreaterThan(0);
      expect(fieldCount).toBeGreaterThan(0);

      await withPdf(bytes, async (doc) => {
        let total = 0;
        for (let i = 1; i <= annotatedPages; i++) total += (await (await doc.getPage(i)).getAnnotations()).length;
        expect(total).toBe(annotationCount);
        const fields: unknown = await doc.getFieldObjects();
        expect(fields instanceof Map ? fields.size : 0).toBe(fieldCount);
      });
    } finally {
      client.dispose();
    }
  }, FILE_TIMEOUT);

  it('contraseña incorrecta en una parte: save-wrong-password', async () => {
    const client = inProcessDocOps();
    try {
      const result = await client.run(
        'combine',
        {
          parts: [
            { password: null, title: 'basic' },
            { password: 'mala', title: 'cifrado' },
          ],
          now: NOW,
        },
        [fixture('basic-5.pdf'), fixture('encrypted-aes-256.pdf')],
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('save-wrong-password');
    } finally {
      client.dispose();
    }
  }, FILE_TIMEOUT);
});

describe('operación organize con PDF importados (PDF-055)', () => {
  it('insertar 2 páginas de outline.pdf en basic-5.pdf: el resultado tiene 7 páginas', async () => {
    const organize = inProcessDocOps();
    try {
      const slots: SaveSlot[] = [
        { kind: 'original', source: 0, rotate: 0 },
        { kind: 'original', source: 1, rotate: 0 },
        { kind: 'imported', doc: 0, source: 0, rotate: 0 },
        { kind: 'imported', doc: 0, source: 1, rotate: 0 },
        { kind: 'original', source: 2, rotate: 0 },
        { kind: 'original', source: 3, rotate: 0 },
        { kind: 'original', source: 4, rotate: 0 },
      ];
      const result = await organize.run<{ readonly delta: Uint8Array }>(
        'organize',
        { password: null, slots, now: NOW, importedPasswords: [null] },
        [fixture('basic-5.pdf'), fixture('outline.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const basic = fixture('basic-5.pdf');
      const bytes = new Uint8Array(basic.length + result.value.delta.length);
      bytes.set(basic, 0);
      bytes.set(result.value.delta, basic.length);
      expect(await pageCountOf(bytes)).toBe(7);
      expect(qpdfCheck(tempFile(bytes)).code).toBe(0);
    } finally {
      organize.dispose();
    }
  }, FILE_TIMEOUT);

  it('contraseña incorrecta del importado: save-wrong-password', async () => {
    const organize = inProcessDocOps();
    try {
      const slots: SaveSlot[] = [
        { kind: 'original', source: 0, rotate: 0 },
        { kind: 'imported', doc: 0, source: 0, rotate: 0 },
      ];
      const result = await organize.run(
        'organize',
        { password: null, slots, now: NOW, importedPasswords: ['mala'] },
        [fixture('basic-5.pdf'), fixture('encrypted-aes-128.pdf')],
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('save-wrong-password');
    } finally {
      organize.dispose();
    }
  }, FILE_TIMEOUT);

  it('importado cifrado con su contraseña: correcto y legible', async () => {
    const organize = inProcessDocOps();
    try {
      const slots: SaveSlot[] = [
        { kind: 'original', source: 0, rotate: 0 },
        { kind: 'imported', doc: 0, source: 0, rotate: 0 },
        { kind: 'original', source: 1, rotate: 0 },
        { kind: 'original', source: 2, rotate: 0 },
        { kind: 'original', source: 3, rotate: 0 },
        { kind: 'original', source: 4, rotate: 0 },
      ];
      const result = await organize.run<{ readonly delta: Uint8Array }>(
        'organize',
        { password: null, slots, now: NOW, importedPasswords: ['usuario'] },
        [fixture('basic-5.pdf'), fixture('encrypted-aes-128.pdf')],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const basic = fixture('basic-5.pdf');
      const bytes = new Uint8Array(basic.length + result.value.delta.length);
      bytes.set(basic, 0);
      bytes.set(result.value.delta, basic.length);
      expect(qpdfCheck(tempFile(bytes)).code).toBe(0);
      await withPdf(bytes, async (doc) => {
        expect(doc.numPages).toBe(6);
      });
    } finally {
      organize.dispose();
    }
  }, FILE_TIMEOUT);
});
