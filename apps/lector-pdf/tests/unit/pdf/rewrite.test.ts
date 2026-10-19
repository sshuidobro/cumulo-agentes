/**
 * Reescritura completa (PDF-131). Los ficheros se validan con pdf.js (el visor) y con qpdf (lector independiente).
 * Fixtures de `tests/fixtures/catalog.ts`; contraseñas: usuario = `usuario`, propietario = `propietario`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type PDFDocumentProxy } from '../../../src/engine';
import { getOutline } from '../../../src/engine/outline';
import type { OutlineNode } from '../../../src/core/outline';
import { writeCompleteFile } from '../../../src/core/pdf/file-writer';
import { openForSave } from '../../../src/core/pdf/incremental';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dict, dictGet, name, PdfSyntaxError, ref, type PdfStream, type PdfValue } from '../../../src/core/pdf/objects';
import { buildPageTreeUpdate, readPageRotations, type PageSlot } from '../../../src/core/pdf/page-tree';
import { rewriteDocument } from '../../../src/core/pdf/rewrite';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfAnnotations, qpdfCheck } from '../../support/qpdf';

const NOW = '2026-10-19T10:00:00.000Z';
const USER = 'usuario';
const OWNER = 'propietario';
const assetBaseUrl = nodeAssetBase();
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

/** Escribe `bytes` en un directorio temporal y devuelve la ruta (para qpdf). */
function tempFile(bytes: Uint8Array, file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rewrite-'));
  tempDirs.push(dir);
  const path = join(dir, file);
  writeFileSync(path, bytes);
  return path;
}

/** Latín-1: un carácter por byte, para buscar cadenas en el fichero crudo. */
function raw(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

async function readerOf(bytes: Uint8Array, password?: string): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(bytes), password === undefined ? {} : { password });
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await readerOf(bytes)).pageCount();
}

/** Reescritura completa de `bytes`, abriéndolo con `password` (vacía si no se indica). */
async function rewriteBytes(bytes: Uint8Array, opts: { password?: string; keepEncryption?: boolean } = {}): Promise<Uint8Array> {
  const opened = await openForSave(memorySource(bytes), opts.password);
  if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
  const written = await rewriteDocument({
    reader: opened.value,
    encryption: null,
    keepEncryption: opts.keepEncryption ?? false,
    now: NOW,
  });
  if (!written.ok) throw new Error(`rewriteDocument falló: ${written.error.code}`);
  return written.value.bytes;
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

function titles(nodes: readonly OutlineNode[]): string[] {
  return nodes.flatMap((node) => [node.title, ...titles(node.children)]);
}

/** Documento mínimo escrito a mano: catálogo 1, raíz de páginas 2, página 3, y los objetos extra indicados. */
function minimalFile(extra: {
  catalog?: Record<string, PdfValue>;
  page?: Record<string, PdfValue>;
  objects?: (readonly [number, PdfValue])[];
}): Uint8Array {
  const objects: (readonly [number, PdfValue])[] = [
    [1, dict({ Type: name('Catalog'), Pages: ref(2), ...extra.catalog })],
    [2, dict({ Type: name('Pages'), Kids: [ref(3)], Count: 1 })],
    [3, dict({ Type: name('Page'), Parent: ref(2), MediaBox: [0, 0, 100, 100], ...extra.page })],
    ...(extra.objects ?? []),
  ];
  return writeCompleteFile({ objects, root: ref(1), seed: 'minimal' });
}

/** Reescritura de un fichero escrito a mano, con el resultado completo (para comprobar errores). */
async function rewriteMinimal(bytes: Uint8Array, signal?: AbortSignal) {
  const opened = await openForSave(memorySource(bytes));
  if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
  return rewriteDocument({ reader: opened.value, encryption: null, now: NOW, ...(signal === undefined ? {} : { signal }) });
}

describe('rewriteDocument: incremental-updates.pdf', () => {
  it('una sola sección xref, sin /Prev, y sin el contenido de la revisión antigua', async () => {
    const original = fixture('incremental-updates.pdf');
    const originalText = raw(original);
    expect(originalText.split('\nxref\n').length - 1).toBeGreaterThan(1);
    expect(originalText).toContain('marcador-1');

    const out = await rewriteBytes(original);
    const text = raw(out);
    expect(text.split('\nxref\n').length - 1).toBe(1);
    expect(text).not.toContain('/Prev');
    expect(text).not.toContain('marcador-1');
    expect(text).toContain('modificada');
    expect(qpdfCheck(tempFile(out, 'rewritten.pdf')).code).toBe(0);
  });

  it('pdf.js ve las mismas páginas y el texto de la revisión vigente', async () => {
    const out = await rewriteBytes(fixture('incremental-updates.pdf'));
    const seen = await withPdf(out, async (doc) => ({
      count: doc.numPages,
      first: await pageText(doc, 1),
      second: await pageText(doc, 2),
    }));
    expect(seen.count).toBe(5);
    expect(seen.first).toContain('modificada');
    expect(seen.second).toContain('Página 2 de 5');
  });
});

describe('rewriteDocument: borrar una página y reescribir', () => {
  it('basic-5.pdf sin la página 2: más pequeño que el concatenado y sin su contenido', async () => {
    const base = fixture('basic-5.pdf');
    expect(raw(base)).toContain('marcador-2');
    const source = memorySource(base);
    const reader = await ObjectReader.open(source);
    const rotationsResult = await readPageRotations(reader);
    if (!rotationsResult.ok) throw new Error(`readPageRotations falló: ${rotationsResult.error.code}`);
    const rotations = rotationsResult.value;
    const pages: PageSlot[] = [0, 2, 3, 4].map((index) => ({ source: index, rotate: rotations[index] ?? 0 }));
    const update = await buildPageTreeUpdate({ source, reader, pages, now: NOW });
    if (!update.ok) throw new Error(`buildPageTreeUpdate falló: ${update.error.code}`);
    const concatenated = new Uint8Array(base.length + update.value.delta.length);
    concatenated.set(base, 0);
    concatenated.set(update.value.delta, base.length);

    const out = await rewriteBytes(concatenated);
    expect(out.length).toBeLessThan(concatenated.length);
    expect(raw(out)).not.toContain('marcador-2');
    expect(raw(out)).toContain('marcador-3');
    expect(await pageCountOf(out)).toBe(4);
  });
});

describe('rewriteDocument: cifrado', () => {
  it('encrypted-aes-128.pdf con keepEncryption sigue cifrado y abre con usuario y propietario', async () => {
    const out = await rewriteBytes(fixture('encrypted-aes-128.pdf'), { password: USER, keepEncryption: true });
    expect((await readerOf(out, USER)).encryptRef).not.toBeNull();
    await expect(readerOf(out)).rejects.toBeInstanceOf(PdfSyntaxError);
    expect((await readerOf(out, USER)).security).not.toBeNull();
    expect((await readerOf(out, OWNER)).security).not.toBeNull();
    const file = tempFile(out, 'kept.pdf');
    expect(qpdfCheck(file, USER).code).toBe(0);
    expect(qpdfCheck(file, OWNER).code).toBe(0);
    expect(await withPdf(out, async (doc) => doc.numPages, USER)).toBe(5);
  });

  it('sin keepEncryption, la salida de un PDF cifrado no tiene cifrado', async () => {
    const out = await rewriteBytes(fixture('encrypted-aes-256.pdf'), { password: OWNER });
    expect((await readerOf(out)).encryptRef).toBeNull();
    expect(qpdfCheck(tempFile(out, 'plain.pdf')).code).toBe(0);
  });

  it('sin cifrado original, keepEncryption no añade cifrado', async () => {
    const out = await rewriteBytes(fixture('basic-5.pdf'), { keepEncryption: true });
    expect((await readerOf(out)).encryptRef).toBeNull();
  });

  it('con cifrado nuevo AES-256, el fichero exige la contraseña y qpdf lo abre con ella', async () => {
    const opened = await openForSave(memorySource(fixture('basic-5.pdf')));
    if (!opened.ok) throw new Error('openForSave');
    const random = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
    const written = await rewriteDocument({
      reader: opened.value,
      encryption: {
        userPassword: 'abc',
        ownerPassword: OWNER,
        permissions: { print: 'high', modify: true, copy: false, annotate: true, fillForms: true, assemble: true },
        random,
      },
      now: NOW,
    });
    if (!written.ok) throw new Error(written.error.code);
    expect(qpdfCheck(tempFile(written.value.bytes, 'new-aes.pdf'), 'abc').code).toBe(0);
    expect((await readerOf(written.value.bytes, 'abc')).security?.authenticatedAs).toBe('user');
    await expect(readerOf(written.value.bytes)).rejects.toBeInstanceOf(PdfSyntaxError);
  });
});

describe('rewriteDocument: anotaciones, formularios, índice y compresión', () => {
  for (const file of ['annotated.pdf', 'form-full.pdf', 'outline.pdf', 'compressed.pdf'] as const) {
    it(`${file}: qpdf --check 0, mismo número de páginas y mismo texto en pdf.js`, async () => {
      const original = fixture(file);
      const out = await rewriteBytes(original);
      expect(qpdfCheck(tempFile(out, file)).code).toBe(0);
      const before = await withPdf(original, async (doc) => ({ count: doc.numPages, text: await pageText(doc, 1) }));
      const after = await withPdf(out, async (doc) => ({ count: doc.numPages, text: await pageText(doc, 1) }));
      expect(after).toEqual(before);
    });
  }

  for (const file of ['annotated.pdf', 'form-full.pdf'] as const) {
    it(`${file}: las anotaciones y campos son los mismos (qpdf)`, async () => {
      const original = fixture(file);
      const out = await rewriteBytes(original);
      const before = qpdfAnnotations(tempFile(original, `before-${file}`)).map((a) => a.subtype).sort();
      const after = qpdfAnnotations(tempFile(out, `after-${file}`)).map((a) => a.subtype).sort();
      expect(before.length).toBeGreaterThan(0);
      expect(after).toEqual(before);
    });
  }

  it('outline.pdf conserva el índice', async () => {
    const original = fixture('outline.pdf');
    const out = await rewriteBytes(original);
    const before = await withPdf(original, async (doc) => titles(await getOutline(doc)));
    const after = await withPdf(out, async (doc) => titles(await getOutline(doc)));
    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });
});

describe('rewriteDocument: reglas de la salida', () => {
  it('no copia objetos no alcanzables desde /Root ni /Info', async () => {
    const written = await rewriteMinimal(minimalFile({ objects: [[4, dict({ Unused: true })]] }));
    if (!written.ok) throw new Error(written.error.code);
    expect(written.value.objects).toBe(3);
    expect(raw(written.value.bytes)).not.toContain('Unused');
    expect(await pageCountOf(written.value.bytes)).toBe(1);
  });

  it('quita /Perms del catálogo', async () => {
    const out = await rewriteBytes(minimalFile({ catalog: { Perms: dict({ UR3: dict({}) }) } }));
    expect(raw(out)).not.toContain('/Perms');
    expect(raw(out)).not.toContain('UR3');
  });

  it('una referencia a un objeto inexistente pasa a null', async () => {
    const out = await rewriteBytes(minimalFile({ page: { Dangling: ref(99) } }));
    const reader = await readerOf(out);
    const pageDict = await reader.getDict(await reader.pageRef(0));
    expect(pageDict).not.toBeNull();
    expect(pageDict === null ? undefined : dictGet(pageDict, 'Dangling')).toBeNull();
  });

  it('un flujo sale con /Length directo aunque su longitud fuera una referencia', async () => {
    const data = new TextEncoder().encode('q Q');
    const contents: PdfStream = { kind: 'stream', dict: dict({ Type: name('Foo'), Length: ref(5) }), data };
    const out = await rewriteBytes(
      minimalFile({
        objects: [
          [4, contents],
          [5, data.length],
        ],
        page: { Contents: ref(4) },
      }),
    );
    const reader = await readerOf(out);
    const pageDict = await reader.getDict(await reader.pageRef(0));
    const contentsRef = pageDict === null ? undefined : dictGet(pageDict, 'Contents');
    if (contentsRef === undefined || contentsRef === null || typeof contentsRef !== 'object' || !('kind' in contentsRef) || contentsRef.kind !== 'ref') {
      throw new Error('la página no tiene /Contents como referencia');
    }
    const copied = await reader.get(contentsRef);
    if (copied === null || typeof copied !== 'object' || !('kind' in copied) || copied.kind !== 'stream') {
      throw new Error('el contenido no es un flujo');
    }
    expect(dictGet(copied.dict, 'Length')).toBe(data.length);
    expect(copied.data).toEqual(data);
  });

  it('más de 100 niveles de anidamiento → save-unreadable, no excepción', async () => {
    let deep: PdfValue = null;
    for (let i = 0; i < 120; i++) deep = [deep];
    const written = await rewriteMinimal(minimalFile({ page: { Deep: deep } }));
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error.code).toBe('save-unreadable');
  });

  it('signal abortada → cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const written = await rewriteMinimal(minimalFile({}), controller.signal);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error.code).toBe('cancelled');
  });

  it('informa del progreso al final con done === total', async () => {
    const opened = await openForSave(memorySource(fixture('basic-5.pdf')));
    if (!opened.ok) throw new Error('openForSave');
    const calls: [number, number][] = [];
    const written = await rewriteDocument({ reader: opened.value, encryption: null, now: NOW, onProgress: (d, t) => calls.push([d, t]) });
    if (!written.ok) throw new Error(written.error.code);
    expect(calls.at(-1)).toEqual([written.value.objects, written.value.objects]);
  });

  it('conserva el /ID original', async () => {
    const original = fixture('basic-5.pdf');
    const id = dictGet((await readerOf(original)).xref.trailer, 'ID');
    expect(Array.isArray(id)).toBe(true);
    const out = await rewriteBytes(original);
    const idOut = dictGet((await readerOf(out)).xref.trailer, 'ID');
    // El primer identificador es el original; el segundo es nuevo (ISO 32000-1 §14.4).
    expect(Array.isArray(idOut) && Array.isArray(id) && idOut[0]).toEqual(Array.isArray(id) ? id[0] : undefined);
  });
});
