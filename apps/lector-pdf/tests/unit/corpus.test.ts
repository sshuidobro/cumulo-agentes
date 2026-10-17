import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import type { PDFDocumentProxy } from '../../src/engine/pdfjs';
import { CORPUS_DIR } from '../fixtures/paths';
import { nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;

/** Corpus público (veraPDF, CC BY 4.0), ver fixtures/FUENTES.md. */
const VERAPDF_FILES = [
  '7.1-t01-pass-a.pdf',
  '7.10-t01-pass-a.pdf',
  '7.18.1-t02-pass-a.pdf',
  '7.18.4-t01-pass-a.pdf',
  '7.18.5-t01-pass-a.pdf',
  '7.18.5-t02-pass-a.pdf',
  '7.21.4.1-t01-pass-a.pdf',
].map((name) => join('verapdf', name));

/** Exportados con LibreOffice desde HTML propio (fixtures/pdf/corpus/src/). */
const LIBREOFFICE_FILES = ['informe.pdf', 'multilingue.pdf', 'largo.pdf'].map((name) => join('libreoffice', name));

const CORPUS_FILES = [...VERAPDF_FILES, ...LIBREOFFICE_FILES];

/** Abre un PDF del corpus con el motor real; el llamador debe liberar el documento. */
async function openCorpus(relativePath: string): Promise<LoadedPdf> {
  const bytes = new Uint8Array(readFileSync(join(CORPUS_DIR, relativePath)));
  const result = await loadPdf(memorySource(bytes), { assetBaseUrl });
  if (!result.ok) throw new Error(`${relativePath}: ${result.error.code}`);
  return result.value;
}

async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

describe('corpus · inventario', () => {
  it('contiene exactamente 10 PDFs: 7 de veraPDF y 3 de LibreOffice', () => {
    const found = (readdirSync(CORPUS_DIR, { recursive: true }) as string[])
      .filter((entry) => entry.endsWith('.pdf'))
      .sort();
    expect(found).toHaveLength(10);
    expect(found).toEqual([...CORPUS_FILES].sort());
  });
});

describe('corpus · apertura', () => {
  it.each(CORPUS_FILES)('%s se abre con loadPdf y su página 1 tiene texto sin lanzar', async (relativePath) => {
    const loaded = await openCorpus(relativePath);
    try {
      expect(loaded.numPages).toBeGreaterThanOrEqual(1);
      await expect(pageText(loaded.doc, 1)).resolves.toBeTypeOf('string');
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('corpus · LibreOffice', () => {
  it('informe.pdf: el texto contiene "Introducción" y "€" y tiene índice (outline) no vacío', async () => {
    const loaded = await openCorpus(join('libreoffice', 'informe.pdf'));
    try {
      const text = await pageText(loaded.doc, 1);
      expect(text).toContain('Introducción');
      expect(text).toContain('€');
      const outline = await loaded.doc.getOutline();
      expect(outline).not.toBeNull();
      expect(outline?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('largo.pdf tiene 30 o más páginas', async () => {
    const loaded = await openCorpus(join('libreoffice', 'largo.pdf'));
    try {
      expect(loaded.numPages).toBeGreaterThanOrEqual(30);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('multilingue.pdf: la página 1 contiene texto en ruso, griego y chino', async () => {
    const loaded = await openCorpus(join('libreoffice', 'multilingue.pdf'));
    try {
      const text = await pageText(loaded.doc, 1);
      expect(text).toContain('Привет');
      expect(text).toContain('Καλημέρα');
      expect(text).toContain('你好');
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('corpus · anotaciones de veraPDF', () => {
  it('7.18.1-t02-pass-a.pdf tiene una anotación Highlight en la página 1', async () => {
    const loaded = await openCorpus(join('verapdf', '7.18.1-t02-pass-a.pdf'));
    try {
      const page = await loaded.doc.getPage(1);
      const annotations = await page.getAnnotations();
      const subtypes = annotations.map((annotation: { readonly subtype?: unknown }) => annotation.subtype);
      expect(subtypes).toContain('Highlight');
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});
