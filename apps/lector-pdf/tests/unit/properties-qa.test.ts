import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProperties, formatFileSize, formatPageSize, type RawProperties } from '../../src/core/properties';
import { loadPdf, readDocumentProperties, readRawProperties } from '../../src/engine';
import { memorySource } from '@suite/platform';
import { FIXTURES_DIR } from '../fixtures/paths';
import { nodeAssetBase } from '../helpers/pdfjs-node';

/** QA de PDF-045: criterios literales de la ficha y casos límite. */
const facts = { fileName: 'x.pdf', path: null, fileSize: 1000, pageCount: 3, pageSize: { widthPt: 595, heightPt: 842 } } as const;
const empty: RawProperties = { info: {}, xmpTitle: null, tagged: null };

describe('criterios literales de la ficha', () => {
  it.each([
    [595, 842, 'A4 (210 × 297 mm)'],
    [842, 595, 'A4 (297 × 210 mm)'],
    [612, 792, 'Carta (215,9 × 279,4 mm)'],
    [200, 100, '70,6 × 35,3 mm'],
  ])('formatPageSize(%d, %d) = %s', (w, h, expected) => {
    expect(formatPageSize(w, h)).toBe(expected);
  });

  it('formatFileSize', () => {
    expect(formatFileSize(1775941)).toBe('1,7 MB (1.775.941 bytes)');
    expect(formatFileSize(839680)).toBe('820 KB (839.680 bytes)');
    expect(formatFileSize(512)).toBe('512 bytes');
  });
});

describe('casos límite de buildProperties y formatos', () => {
  it('valores hostiles en /Info (tipos erróneos, null, números) no lanzan', () => {
    const raw: RawProperties = {
      info: { Title: 42, Author: null, Subject: { a: 1 }, Keywords: ['x'], CreationDate: 'basura', ModDate: 12, PDFFormatVersion: undefined },
      xmpTitle: null,
      tagged: null,
    };
    expect(() => buildProperties(raw, facts)).not.toThrow();
    const p = buildProperties(raw, facts);
    expect(p.created).toBeNull();
    expect(p.modified).toBeNull();
    expect(typeof p.author).toBe('string');
  });

  it('conserva Unicode: ñ, tildes, emojis y RTL', () => {
    const title = 'Ñandú – café 😀 مرحبا';
    const p = buildProperties({ ...empty, info: { Title: title, Author: 'José Peña' } }, facts);
    expect(p.title).toBe(title);
    expect(p.author).toBe('José Peña');
  });

  it('tamaños degenerados no lanzan', () => {
    for (const [w, h] of [[0, 0], [-5, 10], [Number.NaN, 1], [Infinity, 1], [1e9, 1e9]] as const) {
      expect(() => formatPageSize(w, h)).not.toThrow();
    }
    for (const n of [0, 1, 1023, 1024, 1048575, 1048576, 2 ** 40, Number.NaN, -1]) {
      expect(() => formatFileSize(n)).not.toThrow();
    }
    expect(formatFileSize(0)).toBe('0 bytes');
  });
});

const assetBaseUrl = nodeAssetBase();

describe('lectura con ficheros reales', () => {
  it('sizes-mixed.pdf: el tamaño de la página elegida respeta el tamaño de cada página', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'sizes-mixed.pdf')));
    const result = await loadPdf(memorySource(bytes), { assetBaseUrl });
    if (!result.ok) throw new Error(result.error.code);
    try {
      const sizes = new Set<string>();
      for (let i = 0; i < result.value.doc.numPages; i += 1) {
        const p = await readDocumentProperties(result.value.doc, { fileName: 'a.pdf', path: null, fileSize: bytes.length }, i);
        expect(p.pageCount).toBe(result.value.doc.numPages);
        sizes.add(`${String(Math.round(p.pageSize.widthPt))}x${String(Math.round(p.pageSize.heightPt))}`);
      }
      expect(sizes.size).toBeGreaterThan(1);
    } finally {
      await result.value.destroy();
    }
  });

  it('readRawProperties nunca lanza con un documento ya destruido', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const result = await loadPdf(memorySource(bytes), { assetBaseUrl });
    if (!result.ok) throw new Error(result.error.code);
    await result.value.destroy();
    await expect(readRawProperties(result.value.doc)).resolves.toBeDefined();
  });
});
