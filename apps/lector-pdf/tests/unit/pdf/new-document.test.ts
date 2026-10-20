/**
 * Creación de PDF nuevos con páginas de una o varias fuentes (PDF-121, ADR-0028). Los ficheros se validan con pdf.js
 * (el visor) y con qpdf (lector independiente). Fixtures de `tests/fixtures/catalog.ts`.
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type LoadedPdf, type PDFDocumentProxy } from '../../../src/engine';
import { resolveDest } from '../../../src/engine/dest';
import { getOutline } from '../../../src/engine/outline';
import { getPageLinks } from '../../../src/engine/links';
import type { OutlineNode } from '../../../src/core/outline';
import { writeCompleteFile } from '../../../src/core/pdf/file-writer';
import { buildNewDocument, type NewDocumentPart } from '../../../src/core/pdf/new-document';
import { ObjectCopier } from '../../../src/core/pdf/object-copier';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dict, dictGet, name, PdfSyntaxError, ref, withEntries, type PdfDict, type PdfRef, type PdfValue } from '../../../src/core/pdf/objects';
import type { PageSlot } from '../../../src/core/pdf/page-tree';
import { buildDocument } from '../../fixtures/document';
import { textPage } from '../../fixtures/pdf-builder';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck, run } from '../../support/qpdf';

const assetBaseUrl = nodeAssetBase();
const NOW = '2026-10-19T10:00:00.000Z';
const USER = 'usuario';
const FILE_TIMEOUT = 120_000;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

/** Todas las páginas de un fixture, en orden, con giro 0. */
function allPages(count: number): PageSlot[] {
  return Array.from({ length: count }, (_, source) => ({ source, rotate: 0 }));
}

async function openReader(data: Uint8Array, password?: string): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(data), password === undefined ? {} : { password });
}

async function part(file: string, pages: PageSlot[], password?: string): Promise<NewDocumentPart> {
  return { reader: await openReader(fixture(file), password), pages };
}

/** Escribe bytes en un directorio temporal y devuelve la ruta (para qpdf). */
function tempFile(data: Uint8Array, file = 'salida.pdf'): string {
  const dir = mkdtempSync(join(tmpdir(), 'suite-pdf-nuevo-'));
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

/** Texto de una página de pdf.js, sin espacios entre elementos (los fixtures escriben cada línea en un fragmento). */
async function textOf(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

/** Subtipo y contenido (`/Contents`) de cada anotación de una página de pdf.js. */
async function annotationsOf(doc: PDFDocumentProxy, pageNumber: number): Promise<{ subtype: string; contents: string }[]> {
  const page = await doc.getPage(pageNumber);
  const list: unknown = await page.getAnnotations();
  if (!Array.isArray(list)) throw new Error('getAnnotations no devolvió una lista');
  return list.map((item: unknown) => {
    const annotation = item as { subtype?: unknown; contentsObj?: { str?: unknown } };
    return {
      subtype: typeof annotation.subtype === 'string' ? annotation.subtype : '',
      contents: typeof annotation.contentsObj?.str === 'string' ? annotation.contentsObj.str : '',
    };
  });
}

function startsWithPdf17(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 8)) === '%PDF-1.7';
}

describe('buildNewDocument: páginas de un fixture', () => {
  it('basic-5.pdf páginas [4, 0] → 2 páginas «Página 5 de 5» y «Página 1 de 5»; qpdf valida', async () => {
    const result = await buildNewDocument({
      parts: [await part('basic-5.pdf', [{ source: 4, rotate: 0 }, { source: 0, rotate: 0 }])],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pageCount).toBe(2);
    expect(startsWithPdf17(result.value.bytes)).toBe(true);

    const loaded = await openPdf(result.value.bytes);
    try {
      expect(loaded.numPages).toBe(2);
      expect(await textOf(loaded.doc, 1)).toContain('Página 5 de 5');
      expect(await textOf(loaded.doc, 2)).toContain('Página 1 de 5');
    } finally {
      await loaded.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  });

  it('dos partes: basic-5.pdf y outline.pdf completos → 35 páginas en orden; qpdf valida', async () => {
    const basic = await openReader(fixture('basic-5.pdf'));
    const outline = await openReader(fixture('outline.pdf'));
    const basicCount = await basic.pageCount();
    const outlineCount = await outline.pageCount();
    const result = await buildNewDocument({
      parts: [
        { reader: basic, pages: allPages(basicCount) },
        { reader: outline, pages: allPages(outlineCount) },
      ],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pageCount).toBe(basicCount + outlineCount);

    const source = await openPdf(fixture('outline.pdf'));
    const loaded = await openPdf(result.value.bytes);
    try {
      expect(loaded.numPages).toBe(35);
      expect(await textOf(loaded.doc, 1)).toContain('Página 1 de 5');
      expect(await textOf(loaded.doc, 5)).toContain('Página 5 de 5');
      expect(await textOf(loaded.doc, 6)).toBe(await textOf(source.doc, 1));
      expect(await textOf(loaded.doc, 35)).toBe(await textOf(source.doc, source.numPages));
    } finally {
      await loaded.destroy();
      await source.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  });

  it('annotated.pdf: las anotaciones de cada página copiada mantienen subtipo y /Contents, en el orden elegido', async () => {
    const data = fixture('annotated.pdf');
    const reader = await openReader(data);
    const count = await reader.pageCount();
    const order: PageSlot[] = Array.from({ length: count }, (_, i) => ({ source: count - 1 - i, rotate: 0 }));
    const result = await buildNewDocument({ parts: [{ reader, pages: order }], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const source = await openPdf(data);
    const loaded = await openPdf(result.value.bytes);
    try {
      for (const [i, slot] of order.entries()) {
        const expected = await annotationsOf(source.doc, slot.source + 1);
        expect(expected.length).toBeGreaterThan(0);
        expect(await annotationsOf(loaded.doc, i + 1)).toEqual(expected);
      }
    } finally {
      await loaded.destroy();
      await source.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  });

  it('compressed.pdf: correcto en pdf.js y qpdf', async () => {
    const reader = await openReader(fixture('compressed.pdf'));
    const count = await reader.pageCount();
    const result = await buildNewDocument({ parts: [{ reader, pages: allPages(count) }], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      expect(loaded.numPages).toBe(count);
    } finally {
      await loaded.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  });

  it('encrypted-aes-256.pdf (usuario): el resultado se abre sin contraseña, con texto legible y sin cifrado', async () => {
    const reader = await openReader(fixture('encrypted-aes-256.pdf'), USER);
    const count = await reader.pageCount();
    const result = await buildNewDocument({ parts: [{ reader, pages: allPages(count) }], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      expect(loaded.numPages).toBe(count);
      expect((await textOf(loaded.doc, 1)).length).toBeGreaterThan(0);
    } finally {
      await loaded.destroy();
    }
    const path = tempFile(result.value.bytes);
    expect(qpdfCheck(path).code).toBe(0);
    expect(run(['--show-encryption', path]).stdout).toContain('File is not encrypted');
  });

  it('giro: página con rotate 90 → getPage(1).rotate === 90, y 0 sin /Rotate', async () => {
    const result = await buildNewDocument({
      parts: [await part('basic-5.pdf', [{ source: 0, rotate: 90 }, { source: 1, rotate: 0 }])],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      expect((await loaded.doc.getPage(1)).rotate).toBe(90);
      expect((await loaded.doc.getPage(2)).rotate).toBe(0);
    } finally {
      await loaded.destroy();
    }
  });

  it('título: /Info /Title con el texto indicado y Producer de la aplicación', async () => {
    const result = await buildNewDocument({
      parts: [await part('basic-5.pdf', [{ source: 0, rotate: 0 }])],
      title: 'Informe de prueba',
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      const meta = await loaded.doc.getMetadata();
      const info = meta.info as { Title?: unknown; Producer?: unknown };
      expect(info.Title).toBe('Informe de prueba');
      expect(info.Producer).toBe('Cúmulo Lector PDF');
    } finally {
      await loaded.destroy();
    }
  });

  it('informa del progreso cada 100 páginas y al final', async () => {
    const reader = await openReader(fixture('pages-5000.pdf'));
    const calls: [number, number][] = [];
    const result = await buildNewDocument({
      parts: [{ reader, pages: allPages(150) }],
      now: NOW,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      [100, 150],
      [150, 150],
    ]);
  }, FILE_TIMEOUT);
});

describe('buildNewDocument: errores', () => {
  it('sin páginas → organize-invalid', async () => {
    const result = await buildNewDocument({ parts: [], now: NOW });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'organize-invalid' }) });
  });

  it('una parte sin páginas no cuenta: si el total es 0, organize-invalid', async () => {
    const result = await buildNewDocument({ parts: [{ reader: await openReader(fixture('basic-5.pdf')), pages: [] }], now: NOW });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'organize-invalid' }) });
  });

  it('índice fuera de rango, repetido, no entero o giro inválido → organize-invalid', async () => {
    const cases: PageSlot[][] = [
      [{ source: 5, rotate: 0 }],
      [{ source: -1, rotate: 0 }],
      [{ source: 0.5, rotate: 0 }],
      [{ source: 0, rotate: 0 }, { source: 0, rotate: 90 }],
      [{ source: 0, rotate: 45 as 0 }],
    ];
    for (const pages of cases) {
      const result = await buildNewDocument({ parts: [await part('basic-5.pdf', pages)], now: NOW });
      expect(result, JSON.stringify(pages)).toEqual({ ok: false, error: expect.objectContaining({ code: 'organize-invalid' }) });
    }
  });

  it('la misma página en dos partes distintas sí es válida', async () => {
    const result = await buildNewDocument({
      parts: [await part('basic-5.pdf', [{ source: 0, rotate: 0 }]), await part('basic-5.pdf', [{ source: 0, rotate: 0 }])],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.pageCount).toBe(2);
  });

  it('signal abortado → cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await buildNewDocument({
      parts: [await part('basic-5.pdf', [{ source: 0, rotate: 0 }])],
      now: NOW,
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });

  it('abortar durante la copia (en la página 100) → cancelled', async () => {
    const controller = new AbortController();
    const result = await buildNewDocument({
      parts: [{ reader: await openReader(fixture('pages-5000.pdf')), pages: allPages(150) }],
      now: NOW,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 100) controller.abort();
      },
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });

  it('un fallo de lectura se devuelve como error de guardado, no se lanza', async () => {
    const broken = {
      pageCount: (): Promise<number> => Promise.reject(new PdfSyntaxError('roto', 0)),
    } as unknown as ObjectReader;
    const result = await buildNewDocument({ parts: [{ reader: broken, pages: [{ source: 0, rotate: 0 }] }], now: NOW });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-unreadable' }) });
  });
});

describe('writeCompleteFile', () => {
  /** Documento mínimo a mano: catálogo 1, /Pages 2 y una página 3 sin contenido. */
  function minimalObjects(): (readonly [number, PdfValue])[] {
    return [
      [1, dict({ Type: name('Catalog'), Pages: ref(2) })],
      [2, dict({ Type: name('Pages'), Kids: [ref(3)], Count: 1 })],
      [3, dict({ Type: name('Page'), Parent: ref(2), MediaBox: [0, 0, 100, 100] })],
    ];
  }

  it('xref desde 0 con cada objeto en su offset; trailer con /ID de 16 bytes y el id0 indicado', () => {
    const id0 = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    const bytes = writeCompleteFile({ objects: minimalObjects(), root: ref(1), seed: 'semilla', id0 });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.7\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 'xref\n0 1\n'.length)).toBe('xref\n0 1\n');
    expect(text).toContain('/Size 4');
    expect(text).toContain('/ID [<0102030405060708090A0B0C0D0E0F10> <');
    expect(text).not.toContain('/Info');
    expect(text).not.toContain('/Encrypt');
  });

  it('con /Info, las entradas de la xref apuntan exactamente a «N 0 obj»', () => {
    const objects = minimalObjects();
    const bytes = writeCompleteFile({ objects, root: ref(1), info: ref(3), seed: 'semilla' });
    const text = new TextDecoder('latin1').decode(bytes);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    const table = text.slice(startxref);
    expect(table.startsWith('xref\n0 1\n0000000000 65535 f \n1 3\n')).toBe(true);
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n \n/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(3);
    for (const [index, offset] of offsets.entries()) {
      expect(text.slice(offset, offset + `${index + 1} 0 obj\n`.length)).toBe(`${index + 1} 0 obj\n`);
    }
    expect(text).toContain('/Info 3 0 R');
  });

  it('con cifrado AES-256: el /Encrypt va como objeto N+1 sin cifrar y qpdf lo abre con la contraseña', async () => {
    const data = fixture('encrypted-aes-256.pdf');
    const reader = await openReader(data, USER);
    const handler = reader.security;
    const encryptRef = reader.encryptRef;
    if (handler === null || encryptRef === null) throw new Error('el fixture debe estar cifrado');
    const encrypt = await reader.getDict(encryptRef);
    if (encrypt === null) throw new Error('sin diccionario /Encrypt');

    // Catálogo 1 y /Pages 2 fijos; la página y sus objetos toman números desde 3.
    const copier = new ObjectCopier({ from: reader, alloc: counter(3) });
    const pageRef = (await copier.reservePages([0])).get(0);
    if (pageRef === undefined) throw new Error('sin referencia reservada');
    const copied = await copier.copyPage(0);
    const objects: (readonly [number, PdfValue])[] = [
      [1, dict({ Type: name('Catalog'), Pages: ref(2) })],
      [2, dict({ Type: name('Pages'), Kids: [pageRef], Count: 1 })],
      [pageRef.num, withEntries(copied.dict, { Parent: ref(2) })],
      ...copier.drain().map(([r, v]) => [r.num, v] as const),
    ];
    objects.sort((a, b) => a[0] - b[0]);
    const bytes = writeCompleteFile({
      objects,
      root: ref(1),
      seed: 'cifrado',
      encryption: { handler, encrypt, random: deterministicRandom() },
    });
    const path = tempFile(bytes);
    expect(qpdfCheck(path, USER).code).toBe(0);
    const loaded = await openPdf(bytes, USER);
    try {
      expect(loaded.numPages).toBe(1);
      expect((await textOf(loaded.doc, 1)).length).toBeGreaterThan(0);
    } finally {
      await loaded.destroy();
    }
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toMatch(/\/Encrypt \d+ 0 R/);
  }, FILE_TIMEOUT);
});

describe('buildNewDocument: destinos con nombre e índice (PDF-122)', () => {
  it('links.pdf completo: los enlaces internos (explícito, con nombre y GoTo) llevan a las páginas 3, 5 y 2', async () => {
    const reader = await openReader(fixture('links.pdf'));
    const result = await buildNewDocument({ parts: [{ reader, pages: allPages(await reader.pageCount()) }], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);

    const loaded = await openPdf(result.value.bytes);
    try {
      const links = await getPageLinks(await loaded.doc.getPage(1));
      const pageIndexes: (number | null)[] = [];
      for (const link of links) {
        if (link.target.kind !== 'internal') continue;
        pageIndexes.push((await resolveDest(loaded.doc, link.target.dest))?.pageIndex ?? null);
      }
      // (a) página 3 → índice 2; (b) «destino-final» → página 5 → índice 4; (c) GoTo página 2 → índice 1.
      expect(pageIndexes).toEqual([2, 4, 1]);
    } finally {
      await loaded.destroy();
    }
  }, FILE_TIMEOUT);

  it('outline: branches → ramas basic-5 (índice 0) y outline con sus destinos desplazados; URI conservada', async () => {
    const basic = await openReader(fixture('basic-5.pdf'));
    const outline = await openReader(fixture('outline.pdf'));
    const result = await buildNewDocument({
      parts: [
        { reader: basic, pages: allPages(await basic.pageCount()), title: 'basic-5' },
        { reader: outline, pages: allPages(await outline.pageCount()), title: 'outline' },
      ],
      outline: 'branches',
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);

    const loaded = await openPdf(result.value.bytes);
    try {
      const top = await getOutline(loaded.doc);
      expect(top.map((node) => node.title)).toEqual(['basic-5', 'outline']);
      expect(await pageOf(loaded, nodeTitled(top, 'basic-5'))).toBe(0);
      const chapters = nodeTitled(top, 'outline').children;
      expect(await pageOf(loaded, nodeTitled(chapters, 'Capítulo 2'))).toBe(15);
      expect(await pageOf(loaded, nodeTitled(chapters, 'Anexo'))).toBe(34);
      expect(nodeTitled(chapters, 'Sitio web').target).toMatchObject({ kind: 'external', url: 'https://example.org/' });
    } finally {
      await loaded.destroy();
    }
  }, FILE_TIMEOUT);

  it('outline: branches sin título → «Documento 1» y «Documento 2»; una parte sin páginas no tiene rama', async () => {
    const basic = await openReader(fixture('basic-5.pdf'));
    const outline = await openReader(fixture('outline.pdf'));
    const result = await buildNewDocument({
      parts: [
        { reader: basic, pages: allPages(await basic.pageCount()) },
        { reader: outline, pages: [] },
        { reader: outline, pages: [{ source: 0, rotate: 0 }] },
      ],
      outline: 'branches',
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      const top = await getOutline(loaded.doc);
      expect(top.map((node) => node.title)).toEqual(['Documento 1', 'Documento 3']);
    } finally {
      await loaded.destroy();
    }
  }, FILE_TIMEOUT);

  it('sin outline (por defecto) el documento no tiene índice', async () => {
    const basic = await openReader(fixture('basic-5.pdf'));
    const result = await buildNewDocument({ parts: [{ reader: basic, pages: allPages(5) }], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      expect(await getOutline(loaded.doc)).toEqual([]);
    } finally {
      await loaded.destroy();
    }
  }, FILE_TIMEOUT);
});

/** Página (base 0) de un nodo del índice, o null si no lleva a un destino interno. */
async function pageOf(loaded: LoadedPdf, node: OutlineNode): Promise<number | null> {
  if (node.target.kind !== 'internal') return null;
  return (await resolveDest(loaded.doc, node.target.dest))?.pageIndex ?? null;
}

function nodeTitled(nodes: readonly OutlineNode[], title: string): OutlineNode {
  const found = nodes.find((node) => node.title === title);
  if (found === undefined) throw new Error(`no hay entrada «${title}»`);
  return found;
}

/** Números nuevos a partir de `first`. */
function counter(first: number): () => PdfRef {
  let next = first;
  return () => ref(next++);
}

/** Generador de IV determinista: suficiente para validar el formato; la aleatoriedad real está en `secureRandom`. */
function deterministicRandom(): (n: number) => Uint8Array {
  let seed = 7;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = seed & 0xff;
    }
    return out;
  };
}

// ---------------------------------------------------------------- Formularios (PDF-123)

type FieldSummary = { readonly type: unknown; readonly value: unknown };

/**
 * Widgets que lista pdf.js: nombre → un resumen (tipo y valor) por widget. pdf.js también lista los nodos
 * intermedios (con `kidIds`); se descartan porque no son widgets.
 */
async function fieldSummaries(doc: PDFDocumentProxy): Promise<Map<string, FieldSummary[]>> {
  const raw: unknown = await doc.getFieldObjects();
  if (!(raw instanceof Map)) throw new Error('getFieldObjects no devolvió un Map');
  const out = new Map<string, FieldSummary[]>();
  for (const [key, list] of raw) {
    if (!Array.isArray(list)) throw new Error(`campo ${String(key)} sin lista`);
    const widgets = list.flatMap((item: unknown): FieldSummary[] => {
      const field = item as { type?: unknown; value?: unknown; kidIds?: unknown };
      return field.kidIds === undefined ? [{ type: field.type, value: field.value }] : [];
    });
    if (widgets.length > 0) out.set(String(key), widgets);
  }
  return out;
}

/** Nombres (completos) de los widgets de una página, uno por widget, según pdf.js. */
async function widgetFieldNames(doc: PDFDocumentProxy, pageNumber: number): Promise<string[]> {
  const page = await doc.getPage(pageNumber);
  const list: unknown = await page.getAnnotations();
  if (!Array.isArray(list)) throw new Error('getAnnotations no devolvió una lista');
  return list.flatMap((item: unknown) => {
    const annotation = item as { subtype?: unknown; fieldName?: unknown };
    return annotation.subtype === 'Widget' && typeof annotation.fieldName === 'string' ? [annotation.fieldName] : [];
  });
}

/** Resumen comparable: por campo, los widgets como cadenas ordenadas (sin depender del orden de pdf.js). */
function normalized(map: Map<string, FieldSummary[]>): Map<string, string[]> {
  return new Map([...map].map(([key, list]) => [key, list.map((f) => JSON.stringify(f)).sort()]));
}

/** Número de widgets por nombre de campo. */
function countByName(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

/** `/AcroForm` del catálogo del fichero (leído con el lector de objetos), o `undefined`. */
async function acroFormOf(data: Uint8Array): Promise<PdfDict | undefined> {
  const reader = await openReader(data);
  const catalog = await reader.resolve(dictGet(reader.xref.trailer, 'Root'));
  if (!isDictValue(catalog)) throw new Error('catálogo no legible');
  const acro = await reader.resolve(dictGet(catalog, 'AcroForm'));
  return isDictValue(acro) ? acro : undefined;
}

/** Entradas de `/AcroForm /Fields` del fichero, resueltas (diccionarios de campo). */
async function rootFieldsOf(data: Uint8Array): Promise<PdfDict[]> {
  const reader = await openReader(data);
  const acro = await acroFormOf(data);
  const fields = await reader.resolve(acro === undefined ? undefined : dictGet(acro, 'Fields'));
  if (!Array.isArray(fields)) throw new Error('/Fields no es un array');
  const out: PdfDict[] = [];
  for (const item of fields) {
    const field = await reader.resolve(item);
    if (isDictValue(field)) out.push(field);
  }
  return out;
}

describe('buildNewDocument: formularios al copiar (PDF-123)', () => {
  it('form-full.pdf, página 1 → pdf.js lista los campos de esa página con sus valores; qpdf valida', async () => {
    const source = await openPdf(fixture('form-full.pdf'));
    const result = await buildNewDocument({ parts: [await part('form-full.pdf', [{ source: 0, rotate: 0 }])], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      const onPage1 = countByName(await widgetFieldNames(source.doc, 1));
      const original = await fieldSummaries(source.doc);
      const copied = await fieldSummaries(loaded.doc);
      expect([...copied.keys()].sort()).toEqual([...onPage1.keys()].sort());
      for (const [name, count] of onPage1) {
        expect(copied.get(name)?.length).toBe(count);
        expect(normalized(copied).get(name), name).toEqual(normalized(original).get(name)?.slice(0, count) ?? []);
      }
      expect(copied.get('nombre')?.map((f) => f.value)).toEqual(['Ana']);
    } finally {
      await loaded.destroy();
      await source.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  }, FILE_TIMEOUT);

  it('form-full.pdf completo → mismos nombres de campo, tipos y valores que el original', async () => {
    const source = await openPdf(fixture('form-full.pdf'));
    const pages = await openReader(fixture('form-full.pdf'));
    const result = await buildNewDocument({ parts: [{ reader: pages, pages: allPages(await pages.pageCount()) }], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      expect(normalized(await fieldSummaries(loaded.doc))).toEqual(normalized(await fieldSummaries(source.doc)));
    } finally {
      await loaded.destroy();
      await source.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  }, FILE_TIMEOUT);

  it('campo con widgets en dos páginas: extraer solo la 2 → el campo aparece una vez, con un único widget', async () => {
    const result = await buildNewDocument({ parts: [await part('form-full.pdf', [{ source: 1, rotate: 0 }])], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await openPdf(result.value.bytes);
    try {
      expect((await fieldSummaries(loaded.doc)).get('nombre')?.length).toBe(1);
    } finally {
      await loaded.destroy();
    }
    // Raíces: «nombre» (con un único hijo) y «pagina2» (widget suelto, sin hijos).
    const reader = await openReader(result.value.bytes);
    const kidCounts: number[] = [];
    for (const root of await rootFieldsOf(result.value.bytes)) {
      const kids = await reader.resolve(dictGet(root, 'Kids'));
      kidCounts.push(Array.isArray(kids) ? kids.length : 0);
    }
    expect(kidCounts.sort()).toEqual([0, 1]);
  }, FILE_TIMEOUT);

  it('combinar form.pdf + form-full.pdf → /Fields contiene las raíces de ambos y se leen en pdf.js', async () => {
    const formOnly = await buildNewDocument({ parts: [await part('form.pdf', allPages(1))], now: NOW });
    const formFull = await buildNewDocument({ parts: [await part('form-full.pdf', allPages(2))], now: NOW });
    expect(formOnly.ok && formFull.ok).toBe(true);
    if (!formOnly.ok || !formFull.ok) return;
    const result = await buildNewDocument({
      parts: [await part('form.pdf', allPages(1)), await part('form-full.pdf', allPages(2))],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rootsA = await rootFieldsOf(formOnly.value.bytes);
    const rootsB = await rootFieldsOf(formFull.value.bytes);
    expect((await rootFieldsOf(result.value.bytes)).length).toBe(rootsA.length + rootsB.length);

    const loaded = await openPdf(result.value.bytes);
    try {
      const fields = await fieldSummaries(loaded.doc);
      expect(fields.has('acepto')).toBe(true);
      expect(fields.has('comentarios')).toBe(true);
      expect(fields.has('pagina2')).toBe(true);
    } finally {
      await loaded.destroy();
    }
    expect(qpdfCheck(tempFile(result.value.bytes)).code).toBe(0);
  }, FILE_TIMEOUT);

  it('combinar: /DR de la primera parte; las fuentes de la segunda con nombre libre (Helv_2), /DA y /SigFlags según la regla', async () => {
    const result = await buildNewDocument({
      parts: [await part('form.pdf', allPages(1)), await part('form-full.pdf', allPages(2))],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const acro = await acroFormOf(result.value.bytes);
    const original = await acroFormOf(fixture('form.pdf'));
    expect(acro).toBeDefined();
    if (acro === undefined || original === undefined) return;
    expect(dictGet(acro, 'DA')).toEqual(dictGet(original, 'DA'));
    const reader = await openReader(result.value.bytes);
    const dr = await reader.resolve(dictGet(acro, 'DR'));
    if (!isDictValue(dr)) throw new Error('/DR no es un diccionario');
    const fonts = await reader.resolve(dictGet(dr, 'Font'));
    if (!isDictValue(fonts)) throw new Error('/DR /Font no es un diccionario');
    expect([...fonts.entries.keys()].sort()).toEqual(['Helv', 'Helv_2']);
    expect(dictGet(acro, 'SigFlags')).toBeUndefined();
    expect(dictGet(acro, 'CO')).toBeUndefined();
  }, FILE_TIMEOUT);

  it('campo de firma firmado: el campo existe en el resultado y no tiene /V', async () => {
    const signed = buildDocument(1, () => ({ content: textPage(['Firmado']) }), {
      setup: ({ b, tree }) => {
        const page = tree.pageRefs[0];
        if (page === undefined) throw new Error('sin página');
        const sig = b.addObject(
          `<< /Type /Annot /Subtype /Widget /FT /Sig /T (firma) /Rect [72 100 300 150] /F 4 /P ${page} 0 R ` +
            '/V << /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Contents <00> >> >>',
        );
        return {
          catalog: `/AcroForm << /Fields [${sig} 0 R] /SigFlags 3 >>`,
          pageAnnots: new Map([[1, `/Annots [${sig} 0 R]`]]),
        };
      },
    });
    const copy = await buildNewDocument({
      parts: [{ reader: await openReader(signed), pages: allPages(1) }],
      now: NOW,
    });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;

    const roots = await rootFieldsOf(copy.value.bytes);
    expect(roots).toHaveLength(1);
    const [field] = roots;
    if (field === undefined) return;
    expect(dictGet(field, 'T')).toBeDefined();
    expect(dictGet(field, 'V')).toBeUndefined();
    const acro = await acroFormOf(copy.value.bytes);
    expect(acro === undefined ? undefined : dictGet(acro, 'SigFlags')).toBeUndefined();

    const loaded = await openPdf(copy.value.bytes);
    try {
      expect((await fieldSummaries(loaded.doc)).has('firma')).toBe(true);
    } finally {
      await loaded.destroy();
    }
  }, FILE_TIMEOUT);

  it('documentos sin formulario → el catálogo no tiene /AcroForm', async () => {
    const result = await buildNewDocument({ parts: [await part('basic-5.pdf', allPages(5))], now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await acroFormOf(result.value.bytes)).toBeUndefined();
  });
});
