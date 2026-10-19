/**
 * Aplanado de anotaciones nuevas al guardar (PDF-059, ADR-0036): el texto y la imagen pasan a ser contenido de la
 * página. Se comprueba con pdf.js (texto, anotaciones, búsqueda), con el propio lector de objetos y con qpdf.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EMPTY_COMMENT_FILTER,
  buildCommentRows,
  diffAnnotations,
  fromDraft,
  isAnnotation,
  toDraft,
  type Annotation,
  type AnnotationDiff,
  type FreeTextAnnotation,
  type SignatureAnnotation,
} from '../../../src/core/annotations';
import { fromBase64 } from '../../../src/core/base64';
import { decodeStreamData } from '../../../src/core/pdf/filters';
import { buildIncrementalUpdate, openForSave } from '../../../src/core/pdf/incremental';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from '../../../src/core/pdf/objects';
import { effectiveResources } from '../../../src/core/pdf/page-content';
import { findInPage } from '../../../src/core/search/find';
import { buildPageText } from '../../../src/core/search/page-text';
import { normalizeQuery, normalizeText } from '../../../src/core/search/normalize';
import { loadPdf } from '../../../src/engine';
import { exportXfdf } from '../../../src/core/xfdf/xfdf';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck } from '../../support/qpdf';
import { additionsDiff, concat } from '../../support/save-annotations';
import { newAnnotation } from '../annotations/factories';

const NOW = '2026-10-19T09:00:00.000Z';
const T0 = '2026-10-19T08:00:00.000Z';
/** JPEG real de 40 × 20 (generado con Pillow, calidad 80; mismo dato que `signature-annotation.test.ts`). */
const JPEG_40X20_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAUACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjrRelbNovSs20XpW1aJ0rza+X+R+n4mZo2idK2bRelZ1ovStm0XpXjV8v8jwMTM0bRelFWLROlFeXPL9djxak/ePIbQDitm0A4oor9RrpH2eJNm0A4rZtAOKKK8eukeBiTZtAOKKKK8uaVzxam5//2Q==';
const JPEG_BYTES = fromBase64(JPEG_40X20_BASE64) ?? new Uint8Array();

let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'flatten-pdf-'));
});

afterAll(() => {
  if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
});

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Texto libre aplanado: `flatten: true`, Helvetica WinAnsi, en un rectángulo de la página. */
function flatFreeText(id: string, contents: string, pageIndex: number): FreeTextAnnotation {
  return {
    id,
    type: 'freetext',
    pageIndex,
    rect: [72, 600, 300, 620],
    color: [1, 1, 0],
    opacity: 1,
    contents,
    author: 'Ana',
    modified: T0,
    created: T0,
    origin: { kind: 'new' },
    fontSize: 12,
    textColor: [0, 0, 0],
    flatten: true,
  };
}

/** Imagen JPEG aplanada de 40 × 20 pt. */
function flatJpeg(id: string, pageIndex: number): SignatureAnnotation {
  return {
    id,
    type: 'signature',
    pageIndex,
    rect: [300, 500, 380, 530],
    color: [0, 0, 0.6],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: T0,
    created: T0,
    origin: { kind: 'new' },
    art: { kind: 'image', format: 'jpeg', data: JPEG_40X20_BASE64, pixelWidth: 40, pixelHeight: 20 },
    flatten: true,
  };
}

/** Guarda `diff` sobre `data` con el escritor real; devuelve el fichero completo. */
async function saveOver(data: Uint8Array, diff: AnnotationDiff, password?: string): Promise<Uint8Array> {
  const source = memorySource(data);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW });
  if (!result.ok) throw new Error(`save: ${result.error.code}`);
  return concat(data, result.value.delta);
}

function writeTemp(data: Uint8Array, name: string): string {
  const path = join(workDir, name);
  writeFileSync(path, data);
  return path;
}

async function openPdfjs(data: Uint8Array, password?: string) {
  const loaded = await loadPdf(memorySource(data), password === undefined ? { assetBaseUrl: nodeAssetBase() } : { assetBaseUrl: nodeAssetBase(), password });
  if (!loaded.ok) throw new Error(`loadPdf: ${loaded.error.code}`);
  return loaded.value;
}

/** Texto de una página (1-based) tal como lo extrae pdf.js. */
async function textOf(data: Uint8Array, pageNumber: number, password?: string): Promise<string> {
  const loaded = await openPdfjs(data, password);
  try {
    const content = await (await loaded.doc.getPage(pageNumber)).getTextContent();
    return content.items.map((item) => ('str' in item ? item.str : '')).join('');
  } finally {
    await loaded.destroy();
  }
}

async function annotationSubtypes(data: Uint8Array, pageNumber: number): Promise<string[]> {
  const loaded = await openPdfjs(data);
  try {
    const annotations = await (await loaded.doc.getPage(pageNumber)).getAnnotations();
    return annotations.map((a: { subtype: string }) => a.subtype);
  } finally {
    await loaded.destroy();
  }
}

/** Números de los objetos que escribe el incremento (`N G obj` tras el original). */
function writtenNumbers(data: Uint8Array, originalSize: number): number[] {
  const text = Buffer.from(data.subarray(originalSize)).toString('latin1');
  return [...text.matchAll(/(?:^|\n)(\d+) \d+ obj/g)].map((m) => Number(m[1]));
}

async function readerOf(data: Uint8Array): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(data));
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isRefValue(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

/** Diccionario de la página (0-based) con su número de objeto. */
async function pageOf(data: Uint8Array, index: number): Promise<{ readonly num: number; readonly dict: PdfDict }> {
  const reader = await readerOf(data);
  const pageRef = await reader.pageRef(index);
  const dict = await reader.getDict(pageRef);
  if (dict === null) throw new Error('página no legible');
  return { num: pageRef.num, dict };
}

async function streamOf(reader: ObjectReader, r: PdfRef): Promise<PdfStream> {
  const value = await reader.get(r);
  if (typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'stream') {
    throw new Error(`${String(r.num)} no es un flujo`);
  }
  return value;
}

/** `/XObject` efectivo de la página (0-based): nombre → referencia al objeto. */
async function xobjectsOf(data: Uint8Array, index: number): Promise<ReadonlyMap<string, PdfRef>> {
  const reader = await readerOf(data);
  const { dict } = await pageOf(data, index);
  const xobjects = dictGet(await effectiveResources(reader, dict), 'XObject');
  const out = new Map<string, PdfRef>();
  if (isDictValue(xobjects)) {
    for (const [name, value] of xobjects.entries) if (isRefValue(value)) out.set(name, value);
  }
  return out;
}

/** Documento con dos páginas y una fuente F1 en `/Pages`; la primera tiene el contenido en un array. */
function inheritedResourcesDoc(): { readonly data: Uint8Array; readonly pages: number; readonly secondPage: number } {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fonts = b.addObject(`<< /F1 ${String(font)} 0 R >>`);
  const c1 = b.addStream('<< >>', 'BT /F1 18 Tf 72 720 Td (Original uno) Tj ET');
  const c2 = b.addStream('<< >>', 'BT /F1 18 Tf 72 690 Td (Original dos) Tj ET');
  const c3 = b.addStream('<< >>', 'BT /F1 18 Tf 72 720 Td (Segunda pagina) Tj ET');
  const p1 = b.addObject(
    `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Contents [${String(c1)} 0 R ${String(c2)} 0 R] >>`,
  );
  const p2 = b.addObject(
    `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Contents ${String(c3)} 0 R >>`,
  );
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(
    pages,
    `<< /Type /Pages /Kids [${String(p1)} 0 R ${String(p2)} 0 R] /Count 2 /Resources << /Font ${String(fonts)} 0 R >> >>`,
  );
  return { data: b.build({ root: catalog }), pages, secondPage: p2 };
}

describe('aplanado · criterios de aceptación con basic-5.pdf', () => {
  it('texto libre aplanado: pdf.js ve el texto en la página 2, sin anotación nueva, y la búsqueda lo encuentra', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const originalSubtypes = await annotationSubtypes(original, 2);
    const data = await saveOver(original, additionsDiff([flatFreeText('flat-1', 'Texto añadido Ñandú', 1)]));

    expect(await textOf(data, 2)).toContain('Texto añadido Ñandú');
    expect(await annotationSubtypes(data, 2)).toEqual(originalSubtypes);

    const loaded = await openPdfjs(data);
    try {
      const content = await (await loaded.doc.getPage(2)).getTextContent();
      const items = content.items.flatMap((item) => ('str' in item ? [{ str: item.str, hasEOL: item.hasEOL }] : []));
      const pt = buildPageText(items);
      const options = { matchCase: false, matchDiacritics: false };
      const query = normalizeQuery('texto añadido ñandú', options);
      expect(findInPage(1, pt, normalizeText(pt.raw, options), query, false).length).toBeGreaterThan(0);
    } finally {
      await loaded.destroy();
    }

    expect(qpdfCheck(writeTemp(data, 'texto.pdf')).code).toBe(0);
  }, 30_000);

  it('imagen JPEG aplanada: un XObject de imagen con los bytes idénticos, ninguna anotación nueva y qpdf 0', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const originalSubtypes = await annotationSubtypes(original, 1);
    const data = await saveOver(original, additionsDiff([flatJpeg('jpeg-1', 0)]));

    expect(await annotationSubtypes(data, 1)).toEqual(originalSubtypes);

    const reader = await readerOf(data);
    const form = await streamOf(reader, (await xobjectsOf(data, 0)).get('SuiteFlat') ?? { kind: 'ref', num: -1, gen: 0 });
    const formResources = await reader.resolve(dictGet(form.dict, 'Resources'));
    const formXObjects = isDictValue(formResources) ? await reader.resolve(dictGet(formResources, 'XObject')) : undefined;
    const images: PdfStream[] = [];
    if (isDictValue(formXObjects)) {
      for (const value of formXObjects.entries.values()) {
        if (isRefValue(value)) images.push(await streamOf(reader, value));
      }
    }
    expect(images).toHaveLength(1);
    expect(Buffer.from(images[0]?.data ?? new Uint8Array()).equals(Buffer.from(JPEG_BYTES))).toBe(true);

    expect(qpdfCheck(writeTemp(data, 'jpeg.pdf')).code).toBe(0);
  }, 30_000);

  it('cifrado AES-256 (usuario): el texto aplanado se extrae con la contraseña y qpdf 0', async () => {
    const original = fixtureBytes('encrypted-aes-256.pdf');
    const data = await saveOver(original, additionsDiff([flatFreeText('flat-enc', 'Texto cifrado Ñandú', 0)]), 'usuario');

    expect(await textOf(data, 1, 'usuario')).toContain('Texto cifrado Ñandú');
    expect(qpdfCheck(writeTemp(data, 'cifrado.pdf'), 'usuario').code).toBe(0);
  }, 30_000);
});

describe('aplanado · contenido de la página', () => {
  it('página con /Resources heredados y /Contents en array: el texto original y el nuevo se extraen; /Pages y las demás páginas no cambian', async () => {
    const { data: original, pages, secondPage } = inheritedResourcesDoc();
    const data = await saveOver(original, additionsDiff([flatFreeText('flat-h', 'Texto nuevo', 0)]));

    const written = writtenNumbers(data, original.length);
    expect(written).not.toContain(pages);
    expect(written).not.toContain(secondPage);

    const text = await textOf(data, 1);
    expect(text).toContain('Original uno');
    expect(text).toContain('Original dos');
    expect(text).toContain('Texto nuevo');
    expect(await textOf(data, 2)).toContain('Segunda pagina');
    expect(qpdfCheck(writeTemp(data, 'heredado.pdf')).code).toBe(0);
  }, 30_000);

  it('página que ya tiene un XObject «SuiteFlat» → el nuevo se llama «SuiteFlat1»', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const form = b.addStream('<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] >>', 'q Q');
    const page = b.addObject(
      `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /SuiteFlat ${String(form)} 0 R >> >> >>`,
    );
    b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
    b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    const original = b.build({ root: catalog });

    const data = await saveOver(original, additionsDiff([flatFreeText('flat-n', 'Dos', 0)]));
    const xobjects = await xobjectsOf(data, 0);
    expect([...xobjects.keys()].sort()).toEqual(['SuiteFlat', 'SuiteFlat1']);
    expect(xobjects.get('SuiteFlat')?.num).toBe(form);

    const reader = await readerOf(data);
    const { dict } = await pageOf(data, 0);
    const contents = dictGet(dict, 'Contents');
    const last = Array.isArray(contents) ? contents[contents.length - 1] : undefined;
    expect(isRefValue(last)).toBe(true);
    const close = await streamOf(reader, last as PdfRef);
    expect(Buffer.from(decodeStreamData(close)).toString('latin1')).toContain('/SuiteFlat1 Do');
    expect(qpdfCheck(writeTemp(data, 'nombre.pdf')).code).toBe(0);
  }, 30_000);

  it('un resaltado normal y un texto aplanado en la misma página: un único objeto de página con /Annots y /Contents nuevos', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const { num: pageNum } = await pageOf(original, 0);
    const data = await saveOver(
      original,
      additionsDiff([newAnnotation('hl-1', 'highlight', 0), flatFreeText('flat-m', 'Mixto', 0)]),
    );

    expect(writtenNumbers(data, original.length).filter((n) => n === pageNum)).toHaveLength(1);

    const { dict } = await pageOf(data, 0);
    expect(dictGet(dict, 'Annots')).toBeDefined();
    expect(dictGet(dict, 'Contents')).toBeDefined();
    expect(await textOf(data, 1)).toContain('Mixto');
    expect(await annotationSubtypes(data, 1)).toEqual(['Highlight']);
    expect(qpdfCheck(writeTemp(data, 'mixta.pdf')).code).toBe(0);
  }, 30_000);

  it('dos aplanados en la misma página: ambos se dibujan con nombres distintos', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const data = await saveOver(original, additionsDiff([flatFreeText('a', 'Primero', 0), flatJpeg('b', 0)]));
    expect([...(await xobjectsOf(data, 0)).keys()].sort()).toEqual(['SuiteFlat', 'SuiteFlat1']);
    expect(await textOf(data, 1)).toContain('Primero');
    expect(qpdfCheck(writeTemp(data, 'dos.pdf')).code).toBe(0);
  }, 30_000);
});

describe('aplanado · borradores, comentarios y exportación', () => {
  it('toDraft/fromDraft conservan flatten: true', () => {
    const a = flatFreeText('d-1', 'Borrador', 0);
    const edits = { upserts: new Map<string, Annotation>([[a.id, a]]), removed: new Set<string>(), fields: new Map() };
    const restored = fromDraft(JSON.parse(JSON.stringify(toDraft(edits, 'x.pdf', NOW))));
    expect(restored?.upserts.get('d-1')).toEqual(a);
  });

  it('flatten: false, o flatten en un tipo que no lo admite → borrador no válido', () => {
    const falso = { ...flatFreeText('f', 'x', 0), flatten: false } as unknown as Annotation;
    const resaltado = { ...newAnnotation('h', 'highlight', 0), flatten: true } as unknown as Annotation;
    expect(isAnnotation(falso)).toBe(false);
    expect(isAnnotation(resaltado)).toBe(false);
    const edits = { upserts: new Map<string, Annotation>([[falso.id, falso]]), removed: new Set<string>(), fields: new Map() };
    expect(fromDraft(JSON.parse(JSON.stringify(toDraft(edits, 'x.pdf', NOW))))).toBeNull();
  });

  it('isAnnotation acepta flatten ausente o true en texto libre y firma', () => {
    expect(isAnnotation(flatFreeText('ok', 'x', 0))).toBe(true);
    expect(isAnnotation(newAnnotation('ok2', 'freetext', 0))).toBe(true);
    expect(isAnnotation(flatJpeg('ok3', 0))).toBe(true);
  });

  it('buildCommentRows no lista los aplanados; exportXfdf tampoco', () => {
    const effective = new Map<string, Annotation>([
      ['flat-list', flatFreeText('flat-list', 'Oculto', 0)],
      ['note-1', newAnnotation('note-1', 'note', 0)],
    ]);
    const rows = buildCommentRows(effective, new Map(), EMPTY_COMMENT_FILTER);
    expect(rows.flatMap((r) => (r.kind === 'item' ? [r.id] : []))).toEqual(['note-1']);

    const xml = exportXfdf(effective, { fileName: 'x.pdf', ids: null });
    expect(xml).toContain('note-1');
    expect(xml).not.toContain('flat-list');
    expect(xml).not.toContain('Oculto');
  });
});

describe('aplanado · invariantes', () => {
  it('una anotación aplanada que viene del fichero es un bug: el escritor devuelve error sin escribir', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const source = memorySource(original);
    const opened = await openForSave(source);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const fromFile = {
      ...flatFreeText('from-file', 'x', 0),
      origin: { kind: 'file', ref: { num: 999, gen: 0 }, popupRef: null },
    } as FreeTextAnnotation;
    const diff = diffAnnotations(new Map(), {
      upserts: new Map([[fromFile.id, fromFile]]),
      removed: new Set(),
      fields: new Map(),
    });
    const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cause).toBeInstanceOf(RangeError);
  });
});
