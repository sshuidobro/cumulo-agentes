import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it, vi } from 'vitest';
import { mergeFonts, scanFonts, type FontInfo } from '../../src/core/pdf/fonts';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { PdfBuilder } from '../fixtures/pdf-builder';
import { CORPUS_DIR, FIXTURES_DIR } from '../fixtures/paths';
import { qpdfPageFontNames } from '../support/qpdf';

/** Lector de un fichero completo (todas sus páginas). */
async function readerOf(path: string): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(new Uint8Array(readFileSync(path))));
}

async function fontsOf(path: string): Promise<readonly FontInfo[]> {
  const reader = await readerOf(path);
  const total = await reader.pageCount();
  const result = await scanFonts(reader, 0, total, new AbortController().signal);
  if (result === 'cancelled') throw new Error('escaneo cancelado sin petición de cancelar');
  return result;
}

/** Nombres únicos de las fuentes del fichero según `scanFonts`, en el mismo orden que el oráculo de qpdf. */
function scannedNames(fonts: readonly FontInfo[]): string[] {
  return [...new Set(fonts.map((f) => f.name))].sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Documento sintético: el catálogo y el nodo `/Pages` (número `pages`) los define `make`, que devuelve
 * el contenido de cada objeto mediante el builder. Así cada prueba controla exactamente sus diccionarios.
 */
function buildDoc(make: (b: PdfBuilder, pages: number) => void): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  make(b, pages);
  return b.build({ root: catalog });
}

async function readerFor(data: Uint8Array): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(data));
}

const RUN = new AbortController().signal;

describe('fixtures reales', () => {
  it('basic-5.pdf: una sola fuente Helvetica, Type1, WinAnsiEncoding, no incrustada', async () => {
    expect(await fontsOf(join(FIXTURES_DIR, 'basic-5.pdf'))).toEqual([
      { name: 'Helvetica', subtype: 'Type1', encoding: 'WinAnsiEncoding', embedded: false, subset: false },
    ]);
  });

  it('libreoffice/multilingue.pdf: fuentes TrueType incrustadas en subconjunto y sin prefijo en el nombre', async () => {
    const path = join(CORPUS_DIR, 'libreoffice', 'multilingue.pdf');
    const fonts = await fontsOf(path);
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      expect(font.subtype).toBe('TrueType');
      expect(font.embedded).toBe(true);
      expect(font.subset).toBe(true);
      expect(font.name).not.toMatch(/^[A-Z]{6}\+/);
      expect(font.name).not.toBe('');
    }
    expect(fonts.map((f) => f.name)).toEqual(expect.arrayContaining(['DejaVuSans', 'LiberationSerif', 'WenQuanYiZenHei']));
    expect(scannedNames(fonts)).toEqual(qpdfPageFontNames(path));
  });

  it('verapdf/7.21.4.1-t01-pass-a.pdf: fuentes usadas por las páginas, igual que qpdf (sin /AcroForm /DR)', async () => {
    // qpdf da /Helvetica, /ZapfDingbats y /BRYEGL+Arial, pero Helvetica y ZapfDingbats solo cuelgan de
    // /AcroForm /DR (recursos por defecto de formularios, no usados por las páginas). La pestaña lista solo Arial.
    const path = join(CORPUS_DIR, 'verapdf', '7.21.4.1-t01-pass-a.pdf');
    const fonts = await fontsOf(path);
    expect(scannedNames(fonts)).toEqual(qpdfPageFontNames(path));
    expect(qpdfPageFontNames(path)).toEqual(['Arial']);
    expect(fonts.map((f) => f.name)).not.toContain('Helvetica');
    expect(fonts.map((f) => f.name)).not.toContain('ZapfDingbats');
    const arial = fonts.find((f) => f.name === 'Arial');
    expect(arial).toEqual({ name: 'Arial', subtype: 'CIDFontType2', encoding: 'Identity-H', embedded: true, subset: true });
  });

  it('basic-5.pdf: la lista coincide con el oráculo de qpdf', async () => {
    const path = join(FIXTURES_DIR, 'basic-5.pdf');
    expect(scannedNames(await fontsOf(path))).toEqual(qpdfPageFontNames(path));
  });

  it('pages-5000.pdf: escaneo de rango parcial coincide con el de páginas [0, 10)', async () => {
    const reader = await readerOf(join(FIXTURES_DIR, 'pages-5000.pdf'));
    const partial = await scanFonts(reader, 0, 10, RUN);
    const again = await scanFonts(reader, 0, 10, RUN);
    expect(partial).toEqual(again);
    expect(partial).not.toBe('cancelled');
  });
});

describe('construcción de FontInfo con documentos sintéticos', () => {
  it('Type0 toma subtipo, incrustación y subconjunto de la descendiente; codificación del Type0', async () => {
    const data = buildDoc((b, pages) => {
      const font0 = b.alloc();
      const cid = b.alloc();
      const descriptor = b.alloc();
      const file = b.addStream('<< >>', 'bytes-de-fuente');
      b.setObject(descriptor, `<< /Type /FontDescriptor /FontName /ABCDEF+Mincho /FontFile2 ${String(file)} 0 R >>`);
      b.setObject(cid, `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /ABCDEF+Mincho /FontDescriptor ${String(descriptor)} 0 R >>`);
      b.setObject(font0, `<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Mincho /Encoding /Identity-H /DescendantFonts [${String(cid)} 0 R] >>`);
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /Font << /F1 ${String(font0)} 0 R >> >> >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    expect(await scanFonts(await readerFor(data), 0, 1, RUN)).toEqual([
      { name: 'Mincho', subtype: 'CIDFontType0', encoding: 'Identity-H', embedded: true, subset: true },
    ]);
  });

  it('codificación con diccionario (/Differences) → «Personalizada»; Type3 sin /BaseFont → nombre vacío y no incrustada', async () => {
    const data = buildDoc((b, pages) => {
      const custom = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /Differences [65 /B] >> >>');
      const type3 = b.addObject('<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << >> >>');
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /Font << /F1 ${String(custom)} 0 R /F2 ${String(type3)} 0 R >> >> >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    expect(await scanFonts(await readerFor(data), 0, 1, RUN)).toEqual([
      { name: '', subtype: 'Type3', encoding: '', embedded: false, subset: false },
      { name: 'Times-Roman', subtype: 'Type1', encoding: 'Personalizada', embedded: false, subset: false },
    ]);
  });

  it('hereda /Resources desde /Pages cuando la página no los tiene', async () => {
    const data = buildDoc((b, pages) => {
      const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
      const p1 = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R >>`);
      const p2 = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(p1)} 0 R ${String(p2)} 0 R] /Count 2 /Resources << /Font << /F1 ${String(font)} 0 R >> >> >>`);
    });
    const reader = await readerFor(data);
    expect((await scanFonts(reader, 0, 1, RUN))).toEqual([
      { name: 'Courier', subtype: 'Type1', encoding: '', embedded: false, subset: false },
    ]);
    expect((await scanFonts(reader, 1, 2, RUN))).toHaveLength(1);
  });

  it('lee las fuentes de los Form XObject de primer nivel, pero no las de imágenes', async () => {
    const data = buildDoc((b, pages) => {
      const fromForm = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>');
      const fromImage = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Wingdings >>');
      const form = b.addStream(`<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /Font << /F9 ${String(fromForm)} 0 R >> >> >>`, '');
      const image = b.addStream(`<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Resources << /Font << /F8 ${String(fromImage)} 0 R >> >> >>`, '\u0000');
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /XObject << /X1 ${String(form)} 0 R /X2 ${String(image)} 0 R >> >> >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    expect(await scanFonts(await readerFor(data), 0, 1, RUN)).toEqual([
      { name: 'Symbol', subtype: 'Type1', encoding: '', embedded: false, subset: false },
    ]);
  });

  it('un Parent que apunta a sí mismo sin /Resources no hace bucles y devuelve la lista vacía', async () => {
    const data = buildDoc((b, pages) => {
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 /Parent ${String(pages)} 0 R >>`);
    });
    expect(await scanFonts(await readerFor(data), 0, 1, RUN)).toEqual([]);
  });

  it('una fuente compartida por muchas páginas se lee una sola vez', async () => {
    let fontNum = 0;
    const data = buildDoc((b, pages) => {
      fontNum = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
      const kids: number[] = [];
      for (let i = 0; i < 20; i++) {
        kids.push(b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /Font << /F1 ${String(fontNum)} 0 R >> >> >>`));
      }
      b.setObject(pages, `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(' ')}] /Count 20 >>`);
    });
    const reader = await readerFor(data);
    const getDict = vi.spyOn(reader, 'getDict');
    const result = await scanFonts(reader, 0, 20, RUN);
    expect(result).toHaveLength(1);
    expect(getDict.mock.calls.filter(([r]) => r.num === fontNum)).toHaveLength(1);
  });
});

describe('rangos y cancelación', () => {
  it('rango vacío → lista vacía; señal ya abortada → cancelled', async () => {
    const reader = await readerOf(join(FIXTURES_DIR, 'basic-5.pdf'));
    expect(await scanFonts(reader, 2, 2, RUN)).toEqual([]);
    const aborted = AbortSignal.abort();
    expect(await scanFonts(reader, 0, 5, aborted)).toBe('cancelled');
  });

  it('cancelar a mitad de rango corta antes de leer el resto de páginas', async () => {
    const reader = await readerOf(join(FIXTURES_DIR, 'pages-5000.pdf'));
    const controller = new AbortController();
    const pageRef = reader.pageRef.bind(reader);
    let calls = 0;
    vi.spyOn(reader, 'pageRef').mockImplementation(async (index: number) => {
      calls += 1;
      if (calls === 3) controller.abort();
      return pageRef(index);
    });
    expect(await scanFonts(reader, 0, 5000, controller.signal)).toBe('cancelled');
    expect(calls).toBeLessThanOrEqual(3);
  });
});

describe('mergeFonts', () => {
  const times: FontInfo = { name: 'Times', subtype: 'Type1', encoding: 'WinAnsiEncoding', embedded: false, subset: false };
  const arial: FontInfo = { name: 'Arial', subtype: 'TrueType', encoding: 'WinAnsiEncoding', embedded: true, subset: true };

  it('une sin repetir (nombre, subtipo, incrustada) y ordena por nombre en español', () => {
    const merged = mergeFonts([times], [arial, { ...times, encoding: 'MacRomanEncoding' }]);
    expect(merged).toEqual([arial, times]);
  });

  it('ordena con la collation española: «Árbol» va antes de «Arial» (b < i) y «Zapf» al final', () => {
    const acute = { ...times, name: 'Árbol' };
    const zapf = { ...times, name: 'Zapf' };
    expect(mergeFonts([zapf], [acute, arial]).map((f) => f.name)).toEqual(['Árbol', 'Arial', 'Zapf']);
  });

  it('no modifica las listas de entrada', () => {
    const a = [times];
    const b = [arial];
    mergeFonts(a, b);
    expect(a).toEqual([times]);
    expect(b).toEqual([arial]);
  });
});
