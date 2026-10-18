import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProperties, formatFileSize, formatPageSize, type RawProperties } from '../../src/core/properties';
import { loadPdf, readDocumentProperties, readRawProperties } from '../../src/engine';
import { memorySource } from '@suite/platform';
import { CORPUS_DIR, FIXTURES_DIR } from '../fixtures/paths';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const VERAPDF = join(CORPUS_DIR, 'verapdf', '7.18.4-t01-pass-a.pdf');

const facts = {
  fileName: 'x.pdf',
  path: null,
  fileSize: 1000,
  pageCount: 3,
  pageSize: { widthPt: 595, heightPt: 842 },
} as const;

describe('formatPageSize', () => {
  it('reconoce A4 en vertical y apaisado', () => {
    expect(formatPageSize(595, 842)).toBe('A4 (210 × 297 mm)');
    expect(formatPageSize(842, 595)).toBe('A4 (297 × 210 mm)');
  });

  it('reconoce Carta con medidas en coma decimal', () => {
    expect(formatPageSize(612, 792)).toBe('Carta (215,9 × 279,4 mm)');
  });

  it('reconoce A3, A5 y Legal', () => {
    expect(formatPageSize(842, 1191)).toBe('A3 (297 × 420 mm)');
    expect(formatPageSize(420, 595)).toBe('A5 (148 × 210 mm)');
    expect(formatPageSize(612, 1008)).toBe('Legal (215,9 × 355,6 mm)');
  });

  it('muestra las medidas en mm si no es un tamaño estándar', () => {
    expect(formatPageSize(200, 100)).toBe('70,6 × 35,3 mm');
  });

  it('tolera menos de 1 mm de diferencia con un tamaño estándar, pero no más', () => {
    // A4 con 0,5 mm de más en el ancho: sigue siendo A4.
    expect(formatPageSize(596.6, 842)).toBe('A4 (210 × 297 mm)');
    // 213 mm de ancho: 3 mm más que A4, ya no es A4.
    expect(formatPageSize(213 * 72 / 25.4, 842)).toBe('213 × 297 mm');
  });

  it('una página sin tamaño válido muestra un guion', () => {
    expect(formatPageSize(0, 0)).toBe('—');
  });
});

describe('formatFileSize', () => {
  it('usa MB con una decimal y los bytes agrupados por miles', () => {
    expect(formatFileSize(1775941)).toBe('1,7 MB (1.775.941 bytes)');
  });

  it('usa KB sin decimales cuando la cifra pasa de 10', () => {
    expect(formatFileSize(839680)).toBe('820 KB (839.680 bytes)');
  });

  it('muestra bytes por debajo de 1 KB', () => {
    expect(formatFileSize(512)).toBe('512 bytes');
    expect(formatFileSize(0)).toBe('0 bytes');
  });
});

describe('buildProperties', () => {
  const base: RawProperties = { info: {}, xmpTitle: null, tagged: null };

  it('usa el título XMP solo si /Title está vacío', () => {
    expect(buildProperties({ ...base, info: { Title: 'Informe' }, xmpTitle: 'XMP' }, facts).title).toBe('Informe');
    expect(buildProperties({ ...base, info: { Title: '  ' }, xmpTitle: 'XMP' }, facts).title).toBe('XMP');
    expect(buildProperties(base, facts).title).toBe('');
  });

  it('convierte las fechas PDF a ISO y deja null las ilegibles', () => {
    const p = buildProperties({ ...base, info: { CreationDate: "D:20200104120000+01'00'", ModDate: 'basura' } }, facts);
    expect(p.created).toBe('2020-01-04T11:00:00.000Z');
    expect(p.modified).toBeNull();
  });

  it('interpreta las marcas de formulario, linealización y cifrado', () => {
    const p = buildProperties({
      ...base,
      info: { IsLinearized: true, IsAcroFormPresent: false, IsXFAPresent: true, EncryptFilterName: 'Standard' },
    }, facts);
    expect(p.fastWebView).toBe(true);
    expect(p.hasForm).toBe(true);
    expect(p.encrypted).toBe(true);
    const plain = buildProperties(base, facts);
    expect(plain.fastWebView).toBe(false);
    expect(plain.hasForm).toBe(false);
    expect(plain.encrypted).toBe(false);
    expect(plain.tagged).toBeNull();
  });

  it('copia los datos del fichero y de la apertura tal cual', () => {
    const p = buildProperties(base, { ...facts, path: '/tmp/x.pdf' });
    expect(p).toMatchObject({ fileName: 'x.pdf', path: '/tmp/x.pdf', fileSize: 1000, pageCount: 3, pageSize: facts.pageSize });
  });
});

describe('readRawProperties y readDocumentProperties con el corpus veraPDF', () => {
  it('lee /Info, la marca de etiquetado y el formulario del fichero 7.18.4-t01-pass-a.pdf', async () => {
    const result = await loadPdf(memorySource(new Uint8Array(readFileSync(VERAPDF))), { assetBaseUrl });
    if (!result.ok) throw new Error(result.error.code);
    try {
      const raw = await readRawProperties(result.value.doc);
      expect(raw.info.Title).toBe('Widget-pass');
      expect(raw.info.Author).toBe('veraPDF Consortium');
      expect(raw.info.Producer).toBe('veraPDF Test Builder 1.0');
      expect(raw.tagged).toBe(true);

      const p = await readDocumentProperties(result.value.doc, { fileName: 'pass.pdf', path: null, fileSize: 1 }, 0);
      expect(p.title).toBe('Widget-pass');
      expect(p.created).not.toBeNull();
      expect(p.fastWebView).toBe(true);
      expect(p.hasForm).toBe(true);
      expect(p.encrypted).toBe(false);
      expect(p.pageSize.widthPt).toBeGreaterThan(0);
    } finally {
      await result.value.destroy();
    }
  });

  it('el número de páginas y la versión coinciden con el fichero basic-5.pdf', async () => {
    const bytes = readFileSync(join(FIXTURES_DIR, 'basic-5.pdf'));
    const version = /%PDF-(\d\.\d)/.exec(bytes.subarray(0, 1024).toString('latin1'))?.[1];
    expect(version).toBeDefined();
    const result = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl });
    if (!result.ok) throw new Error(result.error.code);
    try {
      const p = await readDocumentProperties(result.value.doc, { fileName: 'basic-5.pdf', path: null, fileSize: bytes.length }, 0);
      expect(p.pageCount).toBe(5);
      expect(p.pdfVersion).toBe(version);
      expect(p.encrypted).toBe(false);
    } finally {
      await result.value.destroy();
    }
  });
});
