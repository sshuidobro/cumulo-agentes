import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { decodeStreamData } from '../../../src/core/pdf/filters';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dict, dictGet, ref, type PdfDict, type PdfRef, type PdfStream } from '../../../src/core/pdf/objects';
import {
  effectiveResources,
  freeResourceName,
  withResource,
  wrapStreams,
  wrappedContents,
} from '../../../src/core/pdf/page-content';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { latin1 } from './helpers';

const CHAIN_LENGTH = 70;

/** Documento con catálogo y nodo `/Pages` (número `pages`); `make` define el resto de objetos. */
function buildDoc(make: (b: PdfBuilder, pages: number) => void): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  make(b, pages);
  return b.build({ root: catalog });
}

async function pageOf(data: Uint8Array, index = 0): Promise<{ readonly reader: ObjectReader; readonly page: PdfDict }> {
  const reader = await ObjectReader.open(memorySource(data));
  const pageRef = await reader.pageRef(index);
  const page = await reader.getDict(pageRef);
  if (page === null) throw new Error('página no legible');
  return { reader, page };
}

function subdict(d: PdfDict, key: string): PdfDict {
  const value = dictGet(d, key);
  if (value === undefined || typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'dict') {
    throw new Error(`${key} no es un diccionario directo`);
  }
  return value;
}

describe('effectiveResources', () => {
  it('devuelve los recursos propios con /Font resuelto a directo (sus entradas siguen siendo referencias)', async () => {
    let fontNum = 0;
    let fontsNum = 0;
    const data = buildDoc((b, pages) => {
      fontNum = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
      fontsNum = b.addObject(`<< /F1 ${String(fontNum)} 0 R >>`);
      const page = b.addObject(
        `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font ${String(fontsNum)} 0 R >> >>`,
      );
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    const { reader, page } = await pageOf(data);
    const res = await effectiveResources(reader, page);
    expect(dictGet(res, 'Font')).toEqual(dict({ F1: ref(fontNum) }));
  });

  it('hereda /Resources del nodo /Pages y resuelve las categorías referenciadas', async () => {
    let fontNum = 0;
    const data = buildDoc((b, pages) => {
      fontNum = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
      const fontsNum = b.addObject(`<< /F1 ${String(fontNum)} 0 R >>`);
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 /Resources << /Font ${String(fontsNum)} 0 R >> >>`);
    });
    const { reader, page } = await pageOf(data);
    const res = await effectiveResources(reader, page);
    expect(subdict(res, 'Font').entries.get('F1')).toEqual(ref(fontNum));
    expect(dictGet(res, 'XObject')).toBeUndefined();
  });

  it('página sin recursos en ninguna parte → diccionario vacío', async () => {
    const data = buildDoc((b, pages) => {
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    const { reader, page } = await pageOf(data);
    expect((await effectiveResources(reader, page)).entries.size).toBe(0);
  });

  it('recursos que no son un diccionario → diccionario vacío', async () => {
    const data = buildDoc((b, pages) => {
      const page = b.addObject(`<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Resources 7 >>`);
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    const { reader, page } = await pageOf(data);
    expect((await effectiveResources(reader, page)).entries.size).toBe(0);
  });

  it('subdiccionario /XObject que no es diccionario se deja tal cual', async () => {
    const data = buildDoc((b, pages) => {
      const page = b.addObject(
        `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Resources << /XObject 5 >> >>`,
      );
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    const { reader, page } = await pageOf(data);
    expect(dictGet((await effectiveResources(reader, page)), 'XObject')).toBe(5);
  });

  it('cadena de padres sin límite: termina y no mira más allá de 64 niveles', async () => {
    const chain: number[] = [];
    const data = buildDoc((b, pages) => {
      for (let i = 0; i < CHAIN_LENGTH; i++) chain.push(b.alloc());
      const page = b.addObject(`<< /Type /Page /Parent ${String(chain[0] ?? 0)} 0 R /MediaBox [0 0 612 792] >>`);
      chain.forEach((num, i) => {
        const parent = chain[i + 1] ?? pages;
        const resources = i === CHAIN_LENGTH - 1 ? ` /Resources << /Font << >> >>` : '';
        b.setObject(num, `<< /Type /Pages /Parent ${String(parent)} 0 R /Kids [] /Count 0${resources} >>`);
      });
      b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    });
    const { reader, page } = await pageOf(data);
    expect((await effectiveResources(reader, page)).entries.size).toBe(0);
  });
});

describe('freeResourceName', () => {
  const xobjects = (names: readonly string[]): PdfDict =>
    dict({ XObject: dict(Object.fromEntries(names.map((n, i) => [n, ref(100 + i)]))) });

  it('devuelve la base si está libre o si la categoría no existe', () => {
    expect(freeResourceName(dict({}), 'XObject', 'SuiteFlat')).toBe('SuiteFlat');
    expect(freeResourceName(xobjects(['Im0']), 'XObject', 'SuiteFlat')).toBe('SuiteFlat');
  });

  it('usa el primer sufijo libre: base1, base2…', () => {
    expect(freeResourceName(xobjects(['SuiteFlat']), 'XObject', 'SuiteFlat')).toBe('SuiteFlat1');
    expect(freeResourceName(xobjects(['SuiteFlat', 'SuiteFlat1']), 'XObject', 'SuiteFlat')).toBe('SuiteFlat2');
  });

  it('las fuentes no ocupan nombres de XObject', () => {
    const res = dict({ Font: dict({ SuiteFlat: ref(5) }) });
    expect(freeResourceName(res, 'XObject', 'SuiteFlat')).toBe('SuiteFlat');
    expect(freeResourceName(res, 'Font', 'SuiteFlat')).toBe('SuiteFlat1');
  });
});

describe('withResource', () => {
  it('añade el recurso sin tocar los demás ni el diccionario original', () => {
    const original = dict({ Font: dict({ F1: ref(3) }), XObject: dict({ Im0: ref(4) }) });
    const next = withResource(original, 'XObject', 'SuiteFlat', ref(9));
    expect(dictGet(next, 'XObject')).toEqual(dict({ Im0: ref(4), SuiteFlat: ref(9) }));
    expect(dictGet(next, 'Font')).toBe(dictGet(original, 'Font'));
    expect(dictGet(original, 'XObject')).toEqual(dict({ Im0: ref(4) }));
  });

  it('crea la categoría si no existe', () => {
    const next = withResource(dict({}), 'Font', 'F9', ref(2));
    expect(dictGet(next, 'Font')).toEqual(dict({ F9: ref(2) }));
  });
});

describe('wrapStreams', () => {
  it('open es «q» sin filtro; close comprime «Q» seguido de las operaciones', () => {
    const ops = 'q /SuiteFlat Do Q\n';
    const { open, close } = wrapStreams(ops);
    expect(latin1(open.data)).toBe('q\n');
    expect(dictGet(open.dict, 'Filter')).toBeUndefined();
    expect(dictGet(close.dict, 'Filter')).toEqual({ kind: 'name', value: 'FlateDecode' });
    expect(latin1(decodeStreamData(close as PdfStream))).toBe(`Q\n${ops}`);
    expect(dictGet(close.dict, 'Length')).toBe(close.data.length);
  });
});

describe('wrappedContents', () => {
  const open: PdfRef = ref(50);
  const close: PdfRef = ref(51);

  it('sin /Contents: solo open y close', () => {
    expect(wrappedContents(dict({}), open, close)).toEqual([open, close]);
  });

  it('una referencia se queda entre open y close', () => {
    const page = dict({ Contents: ref(7) });
    expect(wrappedContents(page, open, close)).toEqual([open, ref(7), close]);
  });

  it('un array se aplana en el medio, en su orden', () => {
    const page = dict({ Contents: [ref(7), ref(8)] });
    expect(wrappedContents(page, open, close)).toEqual([open, ref(7), ref(8), close]);
  });

  it('un valor directo que no es array se envuelve en un array de un elemento', () => {
    const page = dict({ Contents: dict({ Length: 0 }) });
    expect(wrappedContents(page, open, close)).toEqual([open, dict({ Length: 0 }), close]);
  });
});
