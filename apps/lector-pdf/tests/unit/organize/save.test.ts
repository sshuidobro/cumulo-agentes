/**
 * Guardado de la vista Organizar en un solo incremento (PDF-119). Cada prueba escribe el incremento sobre un
 * fixture, concatena original + delta y lo comprueba con pdf.js (el visor) y con qpdf (lector independiente).
 * Requiere `qpdf` en el PATH.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type PDFDocumentProxy } from '../../../src/engine';
import { resolveDest } from '../../../src/engine/dest';
import { getOutline } from '../../../src/engine/outline';
import type { OutlineNode } from '../../../src/core/outline';
import { startDelta } from '../../../src/core/pdf/delta-writer';
import { openForSave } from '../../../src/core/pdf/incremental';
import { ref } from '../../../src/core/pdf/objects';
import { removePageWidgets } from '../../../src/core/organize/forms-cleanup';
import { buildOrganizeUpdate } from '../../../src/core/organize/save';
import type { SaveSlot } from '../../../src/core/organize/plan';
import { PdfBuilder, textPage } from '../../fixtures/pdf-builder';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck, qpdfObjects, type QpdfObjects } from '../../support/qpdf';

const assetBaseUrl = nodeAssetBase();
const NOW = '2026-10-19T10:00:00.000Z';
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function original(source: number, rotate: 0 | 90 | 180 | 270 = 0): SaveSlot {
  return { kind: 'original', source, rotate };
}

function blank(width: number, height: number, rotate: 0 | 90 | 180 | 270 = 0): SaveSlot {
  return { kind: 'blank', width, height, rotate };
}

/** Todas las páginas originales de `count` en orden y sin girar. */
function identity(count: number): SaveSlot[] {
  return Array.from({ length: count }, (_, i) => original(i));
}

function joined(base: Uint8Array, delta: Uint8Array): Uint8Array {
  const out = new Uint8Array(base.length + delta.length);
  out.set(base, 0);
  out.set(delta, base.length);
  return out;
}

/** Escribe el plan `slots` sobre `bytes` y devuelve el fichero resultante junto con el resultado. */
async function organize(bytes: Uint8Array, slots: readonly SaveSlot[], password?: string) {
  const source = memorySource(bytes);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
  const result = await buildOrganizeUpdate({ source, reader: opened.value, slots, now: NOW });
  if (!result.ok) throw new Error(`buildOrganizeUpdate falló: ${result.error.code}`);
  const out = joined(bytes, result.value.delta);
  expect(result.value.expectedSize).toBe(out.length);
  return { bytes: out, result: result.value };
}

async function withPdf<T>(bytes: Uint8Array, fn: (doc: PDFDocumentProxy) => Promise<T>, password?: string): Promise<T> {
  const opened = await loadPdf(memorySource(bytes), password === undefined ? { assetBaseUrl } : { assetBaseUrl, password });
  if (!opened.ok) throw new Error(`loadPdf falló: ${opened.error.code}`);
  const loaded = opened.value;
  try {
    return await fn(loaded.doc);
  } finally {
    await loaded.destroy();
  }
}

/** Nombres de los campos que lista pdf.js (`getFieldObjects` devuelve un Map). */
async function fieldNames(doc: PDFDocumentProxy): Promise<string[]> {
  const fields: unknown = await doc.getFieldObjects();
  expect(fields).toBeInstanceOf(Map);
  return fields instanceof Map ? [...fields.keys()].map(String) : [];
}

async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

function tempFile(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'organize-save-'));
  tempDirs.push(dir);
  const file = join(dir, 'out.pdf');
  writeFileSync(file, bytes);
  return file;
}

function expectQpdfOk(bytes: Uint8Array, password?: string): void {
  const check = qpdfCheck(tempFile(bytes), password);
  expect(check.code, check.output).toBe(0);
}

/** Objetos del fichero según qpdf (`obj:N 0 R`). */
function objectsOf(bytes: Uint8Array): QpdfObjects {
  return qpdfObjects(tempFile(bytes));
}

/** Si `v` es una referencia `N 0 R` a un objeto del fichero, devuelve su valor; si no, `v` tal cual. */
function deref(objs: QpdfObjects, v: unknown): unknown {
  const match = typeof v === 'string' ? /^(\d+) 0 R$/.exec(v) : null;
  if (match === null) return v;
  return objs[`obj:${match[1]} 0 R`]?.value;
}

/** Todas las cadenas `N 0 R` que aparecen dentro de `v` (recursivo). */
function refsIn(v: unknown): string[] {
  if (typeof v === 'string') return /^\d+ 0 R$/.test(v) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(refsIn);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(refsIn);
  return [];
}

function catalogOf(objs: QpdfObjects): Record<string, unknown> {
  const found = Object.values(objs).find((o) => {
    const value = o.value;
    return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>)['/Type'] === '/Catalog';
  });
  const value = found?.value;
  if (typeof value !== 'object' || value === null) throw new Error('catálogo no encontrado');
  return value as Record<string, unknown>;
}

/** `/AcroForm` del catálogo, resuelto. */
function acroFormOf(objs: QpdfObjects): Record<string, unknown> {
  const acro = deref(objs, catalogOf(objs)['/AcroForm']);
  if (typeof acro !== 'object' || acro === null) throw new Error('AcroForm no encontrado');
  return acro as Record<string, unknown>;
}

describe('organizar: guardado en un solo incremento (PDF-119)', () => {
  it('basic-5.pdf con una página en blanco 595×842 en el índice 1: pdf.js da 6 páginas y qpdf valida', async () => {
    const { bytes } = await organize(fixture('basic-5.pdf'), [original(0), blank(595, 842), original(1), original(2), original(3), original(4)]);
    expectQpdfOk(bytes);
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(6);
      const blankPage = await doc.getPage(2);
      const { width, height } = blankPage.getViewport({ scale: 1 });
      expect(width).toBeCloseTo(595);
      expect(height).toBeCloseTo(842);
      expect(await pageText(doc, 2)).toBe('');
      expect(await pageText(doc, 1)).toContain('Página');
      expect(await pageText(doc, 3)).toContain('Página');
    });
  });

  it('una página en blanco girada 90 grados: pdf.js lee rotate 90', async () => {
    const { bytes } = await organize(fixture('basic-5.pdf'), [blank(612, 792, 90), ...identity(5)]);
    expectQpdfOk(bytes);
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(6);
      expect((await doc.getPage(1)).rotate).toBe(90);
      expect((await doc.getPage(2)).rotate).toBe(0);
    });
  });

  it('encrypted-aes-256.pdf (usuario) con una página en blanco al final: 6 páginas con la contraseña y qpdf valida', async () => {
    const slots = [...identity(5), blank(612, 792)];
    const { bytes } = await organize(fixture('encrypted-aes-256.pdf'), slots, 'usuario');
    expectQpdfOk(bytes, 'usuario');
    await withPdf(
      bytes,
      async (doc) => {
        expect(doc.numPages).toBe(6);
        expect(await pageText(doc, 6)).toBe('');
      },
      'usuario',
    );
  });

  it('form-full.pdf: borrar la página con widgets quita sus widgets de /Fields, /Kids y pdf.js ya no los lista', async () => {
    const formFull = fixture('form-full.pdf');
    const { bytes } = await organize(formFull, [original(0)]);
    expectQpdfOk(bytes);

    const objs = objectsOf(bytes);
    const acro = acroFormOf(objs);
    const fields = deref(objs, acro['/Fields']);
    expect(refsIn(fields)).not.toContain('11 0 R');
    expect(refsIn(fields)).not.toContain('25 0 R');
    for (const [key, o] of Object.entries(objs)) {
      if (key.startsWith('obj:') && typeof o.value === 'object' && o.value !== null && !Array.isArray(o.value) && '/Kids' in o.value) {
        const kids = refsIn((o.value as Record<string, unknown>)['/Kids']);
        expect(kids, key).not.toContain('11 0 R');
        expect(kids, key).not.toContain('25 0 R');
      }
    }
    // El campo con widgets en ambas páginas (obj 7) conserva el widget de la página que sigue.
    const field7 = objs['obj:7 0 R']?.value as Record<string, unknown>;
    expect(refsIn(field7['/Kids'])).toEqual(['9 0 R']);

    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(1);
      const names = await fieldNames(doc);
      expect(names).toContain('comentarios');
      expect(names).toContain('codigo');
      expect(names).not.toContain('pagina2');
    });
  });
});

/**
 * Formulario de dos páginas con cuatro campos (PDF-119):
 * - `A`: campo con dos widgets, uno en cada página (P1 y P2).
 * - `B`: widget terminal (campo fusionado) en P2.
 * - `C`: padre de `G` (que tiene un widget en P2) y de un widget en P2: al borrar P2 se queda vacío y desaparece.
 * `/CO` lista A, B y C. `shape` cambia dónde viven los objetos (directo o indirecto) para cubrir las ramas.
 */
interface FormShape {
  readonly acroDirect?: boolean;
  readonly fieldsIndirect?: boolean;
  readonly kidsIndirect?: boolean;
}

interface FormDocument {
  readonly bytes: Uint8Array;
  readonly page1: number;
  readonly page2: number;
  readonly fieldA: number;
  readonly widgetA1: number;
  readonly widgetA2: number;
  readonly widgetB: number;
  readonly fieldC: number;
}

function formDocument(shape: FormShape = {}): FormDocument {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page1 = b.alloc();
  const page2 = b.alloc();
  const fieldA = b.alloc();
  const fieldC = b.alloc();
  const fieldG = b.alloc();
  const widgetA1 = b.alloc();
  const widgetA2 = b.alloc();
  const widgetB = b.alloc();
  const widgetG1 = b.alloc();
  const widgetC1 = b.alloc();

  const content1 = b.addStream('<< >>', textPage(['Hoja uno']));
  const content2 = b.addStream('<< >>', textPage(['Hoja dos']));
  b.setObject(page1, `<< /Type /Page /Parent ${pages} 0 R /Contents ${content1} 0 R /Annots [${widgetA1} 0 R] >>`);
  b.setObject(
    page2,
    `<< /Type /Page /Parent ${pages} 0 R /Contents ${content2} 0 R /Annots [${widgetA2} 0 R ${widgetB} 0 R ${widgetG1} 0 R ${widgetC1} 0 R] >>`,
  );
  b.setObject(pages, `<< /Type /Pages /Kids [${page1} 0 R ${page2} 0 R] /Count 2 /MediaBox [0 0 612 792] >>`);

  const kidsA = shape.kidsIndirect === true ? b.addObject(`[${widgetA1} 0 R ${widgetA2} 0 R]`) : null;
  b.setObject(fieldA, `<< /FT /Tx /T (A) /Kids ${kidsA === null ? `[${widgetA1} 0 R ${widgetA2} 0 R]` : `${kidsA} 0 R`} >>`);
  b.setObject(widgetA1, `<< /Type /Annot /Subtype /Widget /Parent ${fieldA} 0 R /Rect [10 10 50 30] /P ${page1} 0 R >>`);
  b.setObject(widgetA2, `<< /Type /Annot /Subtype /Widget /Parent ${fieldA} 0 R /Rect [10 10 50 30] /P ${page2} 0 R >>`);
  b.setObject(widgetB, `<< /Type /Annot /Subtype /Widget /FT /Tx /T (B) /Rect [10 40 50 60] /P ${page2} 0 R >>`);
  b.setObject(widgetG1, `<< /Type /Annot /Subtype /Widget /Parent ${fieldG} 0 R /Rect [10 70 50 90] /P ${page2} 0 R >>`);
  b.setObject(widgetC1, `<< /Type /Annot /Subtype /Widget /Parent ${fieldC} 0 R /Rect [10 100 50 120] /P ${page2} 0 R >>`);
  b.setObject(fieldG, `<< /T (G) /Parent ${fieldC} 0 R /Kids [${widgetG1} 0 R] >>`);
  b.setObject(fieldC, `<< /T (C) /Kids [${fieldG} 0 R ${widgetC1} 0 R] >>`);

  const fieldList = `${fieldA} 0 R ${widgetB} 0 R ${fieldC} 0 R`;
  const fields = shape.fieldsIndirect === true ? `${b.addObject(`[${fieldList}]`)} 0 R` : `[${fieldList}]`;
  const acroBody = `<< /Fields ${fields} /CO [${fieldList}] /DA (/Helv 0 Tf 0 g) >>`;
  if (shape.acroDirect === true) {
    b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R /AcroForm ${acroBody} >>`);
  } else {
    const acro = b.addObject(acroBody);
    b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R /AcroForm ${acro} 0 R >>`);
  }
  return {
    bytes: b.build({ root: catalog }),
    page1,
    page2,
    fieldA,
    widgetA1,
    widgetA2,
    widgetB,
    fieldC,
  };
}

describe('limpieza de formularios al borrar páginas (PDF-119)', () => {
  it('un campo con dos widgets en páginas distintas conserva el de la página que sigue y pdf.js lo lista', async () => {
    const doc = formDocument();
    const { bytes } = await organize(doc.bytes, [original(0)]);
    expectQpdfOk(bytes);

    const objs = objectsOf(bytes);
    const fieldA = objs[`obj:${doc.fieldA} 0 R`]?.value;
    expect(typeof fieldA).toBe('object');
    const kids = refsIn((fieldA as Record<string, unknown>)['/Kids']);
    expect(kids).toEqual([`${doc.widgetA1} 0 R`]);

    await withPdf(bytes, async (pdf) => {
      const names = await fieldNames(pdf);
      expect(names).toContain('A');
      expect(names).not.toContain('B');
      expect(names).not.toContain('C');
    });
  });

  it('quita de /Fields y de /CO el widget terminal y el campo que se queda sin hijos (anidado incluido)', async () => {
    const doc = formDocument();
    const { bytes } = await organize(doc.bytes, [original(0)]);
    const objs = objectsOf(bytes);
    const acro = acroFormOf(objs);
    expect(refsIn(deref(objs, acro['/Fields']))).toEqual([`${doc.fieldA} 0 R`]);
    expect(refsIn(deref(objs, acro['/CO']))).toEqual([`${doc.fieldA} 0 R`]);
  });

  const shapes: readonly [string, FormShape][] = [
    ['AcroForm directo en el catálogo', { acroDirect: true }],
    ['/Fields indirecto', { fieldsIndirect: true }],
    ['/Kids indirecto', { kidsIndirect: true }],
  ];
  it.each(shapes)('%s: el resultado sigue siendo válido y los campos quedan igual', async (_label, shape) => {
    const doc = formDocument(shape);
    const { bytes } = await organize(doc.bytes, [original(0)]);
    expectQpdfOk(bytes);
    const objs = objectsOf(bytes);
    const acro = acroFormOf(objs);
    expect(refsIn(deref(objs, acro['/Fields']))).toEqual([`${doc.fieldA} 0 R`]);
    const kidsOfA = deref(objs, (objs[`obj:${doc.fieldA} 0 R`]?.value as Record<string, unknown>)['/Kids']);
    expect(refsIn(kidsOfA)).toEqual([`${doc.widgetA1} 0 R`]);
    await withPdf(bytes, async (pdf) => {
      const names = await fieldNames(pdf);
      expect(names).toEqual(['A']);
    });
  });

  it('borrar la página 1 (widget de A) deja el campo A con su widget de la página 2', async () => {
    const doc = formDocument();
    const { bytes } = await organize(doc.bytes, [original(1)]);
    expectQpdfOk(bytes);
    const objs = objectsOf(bytes);
    const fieldA = objs[`obj:${doc.fieldA} 0 R`]?.value as Record<string, unknown>;
    expect(refsIn(fieldA['/Kids'])).toEqual([`${doc.widgetA2} 0 R`]);
  });

  it('sin widgets en las páginas borradas no escribe ningún objeto de formulario', async () => {
    const source = memorySource(fixture('basic-5.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const writer = await startDelta(source, opened.value);
    const before = writer.toBytes().length;
    const removed = await removePageWidgets(opened.value, writer, await opened.value.pageRefs(), ref(1));
    expect(removed).toBe(0);
    expect(writer.toBytes().length).toBe(before);
  });

  it('con widgets en las páginas borradas pero sin /AcroForm: devuelve el número de widgets y no escribe el formulario', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const page = b.alloc();
    const widget = b.alloc();
    b.setObject(widget, `<< /Type /Annot /Subtype /Widget /Rect [0 0 1 1] /P ${page} 0 R >>`);
    b.setObject(page, `<< /Type /Page /Parent ${pages} 0 R /Annots [${widget} 0 R] >>`);
    b.setObject(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 /MediaBox [0 0 612 792] >>`);
    b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
    const source = memorySource(b.build({ root: catalog }));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const writer = await startDelta(source, opened.value);
    const before = writer.toBytes().length;
    const removed = await removePageWidgets(opened.value, writer, [ref(page)], ref(catalog));
    expect(removed).toBe(1);
    expect(writer.toBytes().length).toBe(before);
  });

  it('outline.pdf borrando la página 3: los destinos del índice a páginas que siguen resuelven a su nuevo índice', async () => {
    const originalBytes = fixture('outline.pdf');
    const before = await withPdf(originalBytes, async (doc) => {
      const nodes = flatOutline(await getOutline(doc));
      const targets: (number | null)[] = [];
      for (const node of nodes) targets.push(node.target.kind === 'internal' ? (await resolveDest(doc, node.target.dest))?.pageIndex ?? null : null);
      return { titles: nodes.map((n) => n.title), targets };
    });
    const slots = identity(30).filter((slot) => slot.kind === 'original' && slot.source !== 2);
    const { bytes } = await organize(originalBytes, slots);
    await withPdf(bytes, async (doc) => {
      const nodes = flatOutline(await getOutline(doc));
      expect(nodes.map((n) => n.title)).toEqual(before.titles);
      for (const [i, node] of nodes.entries()) {
        const old = before.targets[i] ?? null;
        const resolved = node.target.kind === 'internal' ? await resolveDest(doc, node.target.dest) : null;
        const expected = old === null ? null : old === 2 ? null : old > 2 ? old - 1 : old;
        expect(resolved?.pageIndex ?? null, node.title).toBe(expected);
      }
    });
    expectQpdfOk(bytes);
  });

  it('plan idéntico al documento: delta vacío', async () => {
    const bytes = fixture('basic-5.pdf');
    const { result } = await organize(bytes, identity(5));
    expect(result.delta.length).toBe(0);
    expect(result.expectedSize).toBe(bytes.length);
    expect(result.rewrittenPages).toBe(0);
  });

  it('solo giros: reescribe las páginas cuyo giro cambia', async () => {
    const bytes = fixture('basic-5.pdf');
    const { result } = await organize(bytes, [original(0, 90), original(1), original(2), original(3), original(4)]);
    expect(result.rewrittenPages).toBe(1);
  });

  it.each([
    ['sin páginas', []],
    ['origen repetido', [original(0), original(0)]],
    ['origen fuera de rango', [original(0), original(5)]],
    ['origen negativo', [original(-1)]],
    ['giro no válido', [{ kind: 'original', source: 0, rotate: 45 } as unknown as SaveSlot]],
    ['blanco de ancho 0', [original(0), blank(0, 842)]],
    ['blanco de alto 14401', [original(0), blank(595, 14401)]],
    ['blanco de ancho NaN', [original(0), blank(Number.NaN, 842)]],
    ['página importada', [original(0), { kind: 'imported', doc: 1, source: 0, rotate: 0 } as SaveSlot]],
  ])('plan no válido (%s) → organize-invalid', async (_label, slots) => {
    const source = memorySource(fixture('basic-5.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const result = await buildOrganizeUpdate({ source, reader: opened.value, slots, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('organize-invalid');
  });

  it('signal abortado → cancelled', async () => {
    const source = memorySource(fixture('basic-5.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error(opened.error.code);
    const controller = new AbortController();
    controller.abort();
    const result = await buildOrganizeUpdate({
      source,
      reader: opened.value,
      slots: [original(0), blank(100, 100), original(1)],
      now: NOW,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('cancelled');
  });
});

function flatOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((node) => [node, ...flatOutline(node.children)]);
}
