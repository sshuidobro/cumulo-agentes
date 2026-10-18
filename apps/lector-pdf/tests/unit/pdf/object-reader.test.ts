import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource, type ByteSource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { loadPdf } from '../../../src/engine/load';
import { decodeTextString } from '../../../src/core/pdf/text-string';
import { dictGet, name, ref, type PdfDict, type PdfRef, type PdfString } from '../../../src/core/pdf/objects';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { CORPUS_DIR, FIXTURES_DIR } from '../../fixtures/paths';
import { countingSource, nodeAssetBase } from '../../helpers/pdfjs-node';
import { bytes } from './helpers';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;

/** Carga un fixture generado como fuente por rangos. */
function fixture(name: string): { readonly source: ByteSource; readonly size: number } {
  const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return { source: memorySource(data), size: data.length };
}

interface RawPdf {
  /** Cuerpo de cada objeto (texto tal cual, sin `obj`/`endobj`). */
  readonly objects: Record<number, string>;
  readonly root?: number;
  /** Números libres (entrada `f` en la tabla). */
  readonly free?: readonly number[];
  /** La entrada de `num` apunta al offset del objeto `target` (incoherencia a propósito). */
  readonly redirect?: Record<number, number>;
}

/** PDF de tabla clásica escrito a mano: cada objeto en su offset y una xref exacta. */
function buildPdf(raw: RawPdf): Uint8Array {
  let text = '%PDF-1.7\n';
  const offsets = new Map<number, number>();
  const nums = Object.keys(raw.objects).map(Number).sort((a, b) => a - b);
  for (const num of nums) {
    offsets.set(num, text.length);
    text += `${num} 0 obj\n${raw.objects[num] ?? ''}\nendobj\n`;
  }
  const size = Math.max(...nums) + 1;
  const xrefAt = text.length;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const target = raw.redirect?.[n] ?? n;
    const offset = offsets.get(target);
    const isFree = raw.free?.includes(n) === true || offset === undefined;
    table += isFree
      ? '0000000000 65535 f \n'
      : `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  text += `${table}trailer\n<< /Size ${size} /Root ${raw.root ?? 1} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return bytes(text);
}

/** Lector sobre un PDF escrito a mano. */
function readerOf(raw: RawPdf): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(buildPdf(raw)));
}

/** Página `index` de un PDF escrito a mano que tiene un único árbol plano de hojas. */
const LEAF = '<< /Type /Page /Parent 2 0 R >>';

describe('ObjectReader · fixtures pequeños', () => {
  it('basic-5.pdf: 5 páginas y pageRef coincide con pageRefs para todo índice', async () => {
    const { source } = fixture('basic-5.pdf');
    const reader = await ObjectReader.open(source);
    expect(await reader.pageCount()).toBe(5);
    const all = await reader.pageRefs();
    expect(all).toHaveLength(5);
    const first = await reader.getDict(await reader.pageRef(0));
    expect(first?.entries.get('Type')).toEqual(name('Page'));
    for (let i = 0; i < 5; i++) {
      expect(await reader.pageRef(i)).toEqual(all[i]);
    }
  });

  it('basic-5.pdf: índices fuera de rango (5 y -1) → page-not-found', async () => {
    const reader = await ObjectReader.open(fixture('basic-5.pdf').source);
    await expect(reader.pageRef(5)).rejects.toMatchObject({ name: 'PdfSyntaxError', message: 'page-not-found' });
    await expect(reader.pageRef(-1)).rejects.toMatchObject({ name: 'PdfSyntaxError', message: 'page-not-found' });
  });

  it('compressed.pdf: el catálogo está en un object stream y se lee; 50 páginas', async () => {
    const reader = await ObjectReader.open(fixture('compressed.pdf').source);
    expect(reader.xref.entries.get(1)?.type).toBe('compressed');
    const catalog = await reader.getDict(ref(1));
    expect(catalog).not.toBeNull();
    expect(catalog?.entries.get('Pages')).toMatchObject({ kind: 'ref' });
    expect(await reader.pageCount()).toBe(50);
    expect(await reader.pageRef(49)).toEqual((await reader.pageRefs())[49]);
  });

  it('incremental-updates.pdf: /Info del trailer tiene el título de la última actualización', async () => {
    const reader = await ObjectReader.open(fixture('incremental-updates.pdf').source);
    const info = await reader.resolve(dictGet(reader.xref.trailer, 'Info'));
    const title = (info as PdfDict).entries.get('Title') as PdfString;
    expect(decodeTextString(title)).toBe('Actualizado dos veces');
  });

  it('pages-20000-flat.pdf: pageRef(19999) usa el atajo y devuelve el hijo 19 999 del raíz', async () => {
    const { source, size } = fixture('pages-20000-flat.pdf');
    const counted = countingSource(source);
    const reader = await ObjectReader.open(counted);
    const catalog = await reader.getDict(ref(1));
    const pagesRef = catalog?.entries.get('Pages') as PdfRef;
    const root = await reader.getDict(pagesRef);
    const kids = (await reader.resolve(root?.entries.get('Kids'))) as readonly PdfRef[];
    const expected = kids[19999];
    expect(await reader.pageRef(19999)).toEqual(expected);
    // Sin el atajo se recorrerían las 20 000 hojas: se comprueba que no se leen.
    expect(counted.bytesRead).toBeLessThan(size * 0.5);
  });
});

describe('ObjectReader · lectura por rangos', () => {
  it('pages-100000.pdf: abrir + pageRef(99998) + getDict leen menos del 15 % del fichero', async () => {
    const { source, size } = fixture('pages-100000.pdf');
    const counted = countingSource(source);
    const reader = await ObjectReader.open(counted);
    const page = await reader.getDict(await reader.pageRef(99998));
    expect(page).not.toBeNull();
    expect(page?.entries.get('Type')).toEqual(name('Page'));
    expect(counted.bytesRead / size).toBeLessThan(0.15);
  });

  it('pages-100000.pdf: 10 páginas repartidas leen en total menos del 16 %', async () => {
    const { source, size } = fixture('pages-100000.pdf');
    const counted = countingSource(source);
    const reader = await ObjectReader.open(counted);
    const indices = [0, 12345, 25000, 37777, 50000, 62500, 75000, 87654, 99000, 99999];
    for (const index of indices) {
      const r = await reader.pageRef(index);
      expect(await reader.getDict(r)).not.toBeNull();
    }
    expect(counted.bytesRead / size).toBeLessThan(0.16);
  });
});

describe('ObjectReader · get', () => {
  it('objeto libre, inexistente y con gen distinto → null', async () => {
    const reader = await readerOf({
      objects: { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [] /Count 0 >>' },
      free: [3],
    });
    expect(await reader.get(ref(3))).toBeNull();
    expect(await reader.get(ref(999))).toBeNull();
    expect(await reader.get(ref(1, 1))).toBeNull();
    expect(await reader.get(ref(1))).not.toBeNull();
  });

  it('un offset que apunta a otro objeto → object-mismatch', async () => {
    const reader = await readerOf({
      objects: { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [] /Count 0 >>', 3: '<< /X 1 >>' },
      redirect: { 2: 3 },
    });
    await expect(reader.get(ref(2))).rejects.toMatchObject({ name: 'PdfSyntaxError', message: 'object-mismatch' });
  });

  it('un stream con /Length indirecto se lee completo aunque sus datos contengan "endstream"', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [] /Count 0 >>',
        4: '<< /Length 5 0 R >>\nstream\nA endstream B\nendstream',
        5: '13',
      },
    });
    const s = await reader.get(ref(4));
    expect(s).toMatchObject({ kind: 'stream' });
    const data = (s as { data: Uint8Array }).data;
    expect(new TextDecoder().decode(data)).toBe('A endstream B');
  });

  it('un /Length que apunta a su propio objeto no cuelga y usa endstream', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [] /Count 0 >>',
        4: '<< /Length 4 0 R >>\nstream\nabc\nendstream',
      },
    });
    const s = await reader.get(ref(4));
    expect(new TextDecoder().decode((s as { data: Uint8Array }).data)).toBe('abc');
  });

  it('getDict de un objeto que no es diccionario ni flujo → null', async () => {
    const reader = await readerOf({
      objects: { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [] /Count 0 >>', 3: '42', 4: '/Nombre' },
    });
    expect(await reader.getDict(ref(3))).toBeNull();
    expect(await reader.get(ref(3))).toBe(42);
    expect(await reader.getDict(ref(4))).toBeNull();
  });
});

describe('ObjectReader · casos límite del árbol y errores de E/S', () => {
  it('/Count ausente o no válido: pageCount cuenta las hojas', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R 4 0 R] >>',
        3: LEAF,
        4: LEAF,
      },
    });
    expect(await reader.pageCount()).toBe(2);
  });

  it('sin catálogo utilizable: 0 páginas y page-not-found', async () => {
    const reader = await readerOf({
      objects: { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [] /Count 0 >>' },
      root: 9,
    });
    expect(await reader.pageCount()).toBe(0);
    expect(await reader.pageRefs()).toEqual([]);
    await expect(reader.pageRef(0)).rejects.toMatchObject({ message: 'page-not-found' });
  });

  it('un error de E/S al recorrer el árbol no queda cacheado: la siguiente llamada reintenta', async () => {
    const data = buildPdf({
      objects: { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R 4 0 R] >>', 3: LEAF, 4: LEAF },
    });
    let failing = false;
    const flaky: ByteSource = {
      size: data.length,
      read: async (begin, end) => {
        if (failing) throw new Error('fallo de lectura simulado');
        return data.slice(begin, end);
      },
    };
    const reader = await ObjectReader.open(flaky);
    failing = true;
    await expect(reader.pageRefs()).rejects.toThrow('fallo de lectura simulado');
    failing = false;
    expect(await reader.pageRefs()).toHaveLength(2);
  });
});

describe('ObjectReader · árbol de páginas incoherente', () => {
  it('/Count del raíz mentiroso (10 con 3 páginas): pageRef(2) correcto y pageRef(5) → page-not-found', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 10 >>',
        3: LEAF,
        4: LEAF,
        5: LEAF,
      },
    });
    expect(await reader.pageRef(2)).toEqual(ref(5));
    expect(await reader.pageRefs()).toHaveLength(3);
    await expect(reader.pageRef(5)).rejects.toMatchObject({ message: 'page-not-found' });
  });

  it('/Count = número de hijos con un subárbol de 2 páginas y otro vacío: pageRef igual a pageRefs para todo i', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R 4 0 R 7 0 R] /Count 3 >>',
        3: '<< /Type /Pages /Kids [5 0 R 6 0 R] /Count 2 /Parent 2 0 R >>',
        4: '<< /Type /Pages /Kids [] /Count 0 /Parent 2 0 R >>',
        5: LEAF,
        6: LEAF,
        7: LEAF,
      },
    });
    const all = await reader.pageRefs();
    expect(all).toEqual([ref(5), ref(6), ref(7)]);
    for (let i = 0; i < all.length; i++) {
      expect(await reader.pageRef(i)).toEqual(all[i]);
    }
    await expect(reader.pageRef(3)).rejects.toMatchObject({ message: 'page-not-found' });
  });

  it('ciclo en /Kids: pageRefs y pageRef terminan', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [2 0 R 3 0 R] >>',
        3: LEAF,
      },
    });
    expect(await reader.pageRefs()).toEqual([ref(3)]);
    expect(await reader.pageRef(0)).toEqual(ref(3));
    await expect(reader.pageRef(1)).rejects.toMatchObject({ message: 'page-not-found' });
  });

  it('[QA] hoja duplicada en /Kids: ambos métodos terminan sin otro error que page-not-found', async () => {
    const reader = await readerOf({
      objects: {
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R 3 0 R 4 0 R] /Count 3 >>',
        3: LEAF,
        4: LEAF,
      },
    });
    const all = await reader.pageRefs();
    expect(all.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      try {
        const r = await reader.pageRef(i);
        expect([3, 4]).toContain(r.num);
      } catch (e) {
        expect(e).toMatchObject({ message: 'page-not-found' });
      }
    }
  });

  it('[QA] PDF vacío o truncado: open falla con error de sintaxis, no cuelga', async () => {
    await expect(ObjectReader.open(memorySource(new Uint8Array(0)))).rejects.toBeInstanceOf(Error);
    const full = buildPdf({
      objects: { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [] /Count 0 >>' },
    });
    await expect(ObjectReader.open(memorySource(full.slice(0, full.length - 40)))).rejects.toBeInstanceOf(Error);
  });
});

describe('ObjectReader · corpus público frente a pdf.js', () => {
  const corpusFiles = [
    ...readdirSync(join(CORPUS_DIR, 'verapdf')).map((f) => join('verapdf', f)),
    ...readdirSync(join(CORPUS_DIR, 'libreoffice')).map((f) => join('libreoffice', f)),
  ].filter((f) => f.endsWith('.pdf')).sort();

  it('hay 10 PDFs en el corpus', () => {
    expect(corpusFiles).toHaveLength(10);
  });

  it.each(corpusFiles)('%s: pageCount y pageRefs coinciden con pdf.js; pageRef(i) = pageRefs()[i]', async (relativePath) => {
    const data = new Uint8Array(readFileSync(join(CORPUS_DIR, relativePath)));
    const reader = await ObjectReader.open(memorySource(data));
    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    if (!loaded.ok) throw new Error(`${relativePath}: ${loaded.error.code}`);
    try {
      const all = await reader.pageRefs();
      expect(all).toHaveLength(loaded.value.numPages);
      expect(await reader.pageCount()).toBe(loaded.value.numPages);
      for (let i = 0; i < all.length; i++) {
        expect(await reader.pageRef(i)).toEqual(all[i]);
      }
    } finally {
      await loaded.value.destroy();
    }
  }, OPEN_TIMEOUT);
});
