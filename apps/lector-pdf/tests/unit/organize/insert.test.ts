/**
 * Insertar páginas de otro PDF en la vista Organizar (PDF-055). Cada prueba escribe el incremento sobre un fixture,
 * concatena original + delta y lo comprueba con pdf.js (el visor) y con qpdf (lector independiente). Requiere
 * `qpdf` en el PATH.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPdf, type PDFDocumentProxy } from '../../../src/engine';
import type { SaveSlot } from '../../../src/core/organize/plan';
import { buildOrganizeUpdate } from '../../../src/core/organize/save';
import { openForSave } from '../../../src/core/pdf/incremental';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck } from '../../support/qpdf';

const assetBaseUrl = nodeAssetBase();
const NOW = '2026-10-20T10:00:00.000Z';
const FILE_TIMEOUT = 120_000;
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

function imported(doc: number, source: number, rotate: 0 | 90 | 180 | 270 = 0): SaveSlot {
  return { kind: 'imported', doc, source, rotate };
}

function joined(base: Uint8Array, delta: Uint8Array): Uint8Array {
  const out = new Uint8Array(base.length + delta.length);
  out.set(base, 0);
  out.set(delta, base.length);
  return out;
}

interface Imported {
  readonly bytes: Uint8Array;
  readonly password?: string;
}

/** Escribe el plan `slots` sobre `target` con los PDF `from` importados; devuelve el fichero resultante y el delta. */
async function insert(target: Uint8Array, slots: readonly SaveSlot[], from: readonly Imported[] = [], password?: string) {
  const source = memorySource(target);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(`openForSave falló: ${opened.error.code}`);
  const readers = [];
  for (const file of from) {
    const reader = await openForSave(memorySource(file.bytes), file.password);
    if (!reader.ok) throw new Error(`openForSave del importado falló: ${reader.error.code}`);
    readers.push(reader.value);
  }
  const result = await buildOrganizeUpdate({ source, reader: opened.value, slots, imported: readers, now: NOW });
  if (!result.ok) throw new Error(`buildOrganizeUpdate falló: ${result.error.code}`);
  const out = joined(target, result.value.delta);
  expect(result.value.expectedSize).toBe(out.length);
  return { bytes: out, delta: result.value.delta, result: result.value };
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

/** «nombre=valor» de cada widget con valor, ordenado (los `id` internos de pdf.js no se comparan). */
function valuesOf(fields: ReadonlyMap<string, unknown>): string[] {
  const out: string[] = [];
  for (const [name, list] of fields) {
    if (!Array.isArray(list)) continue;
    for (const field of list) {
      if (typeof field === 'object' && field !== null && 'value' in field) out.push(`${name}=${JSON.stringify(field.value)}`);
    }
  }
  return out.sort();
}

/** Nombres de los campos que lista pdf.js (`getFieldObjects` devuelve un Map). */
async function fieldNames(doc: PDFDocumentProxy): Promise<string[]> {
  const fields: unknown = await doc.getFieldObjects();
  expect(fields).toBeInstanceOf(Map);
  return fields instanceof Map ? [...fields.keys()].map(String) : [];
}

function tempFile(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'insert-pages-'));
  tempDirs.push(dir);
  const file = join(dir, 'out.pdf');
  writeFileSync(file, bytes);
  return file;
}

function expectQpdfOk(bytes: Uint8Array, password?: string): void {
  const check = qpdfCheck(tempFile(bytes), password);
  expect(check.code, check.output).toBe(0);
}

describe('insertar páginas de otro PDF (PDF-055)', () => {
  it('las 2 primeras de outline.pdf tras la página 2 de basic-5.pdf: 7 páginas en orden; qpdf valida', async () => {
    const basic = fixture('basic-5.pdf');
    const slots: SaveSlot[] = [original(0), original(1), imported(0, 0), imported(0, 1), original(2), original(3), original(4)];
    const { bytes, result } = await insert(basic, slots, [{ bytes: fixture('outline.pdf') }]);
    expect(result.rewrittenPages).toBe(7);
    expectQpdfOk(bytes);
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(7);
      expect(await pageText(doc, 1)).toContain('Página 1 de 5');
      expect(await pageText(doc, 2)).toContain('Página 2 de 5');
      expect(await pageText(doc, 3)).toContain('Página 1 de 30');
      expect(await pageText(doc, 4)).toContain('Página 2 de 30');
      expect(await pageText(doc, 5)).toContain('Página 3 de 5');
      expect(await pageText(doc, 7)).toContain('Página 5 de 5');
    });
  }, FILE_TIMEOUT);

  it('páginas de annotated.pdf: sus anotaciones aparecen en las páginas insertadas', async () => {
    const annotated = fixture('annotated.pdf');
    const sourceCounts = await withPdf(annotated, async (doc) => {
      const counts: number[] = [];
      for (let i = 1; i <= doc.numPages; i++) counts.push((await (await doc.getPage(i)).getAnnotations()).length);
      return counts;
    });
    expect(sourceCounts.some((count) => count > 0)).toBe(true);

    const pages = sourceCounts.map((_, i) => imported(0, i));
    const { bytes } = await insert(fixture('basic-5.pdf'), [original(0), ...pages, original(1), original(2), original(3), original(4)], [
      { bytes: annotated },
    ]);
    expectQpdfOk(bytes);
    await withPdf(bytes, async (doc) => {
      for (const [i, expected] of sourceCounts.entries()) {
        const annotations = await (await doc.getPage(i + 2)).getAnnotations();
        expect(annotations.length).toBe(expected);
      }
    });
  }, FILE_TIMEOUT);

  it('una página con campos de form-full.pdf en basic-5.pdf (sin formulario): /AcroForm y los mismos campos y valores', async () => {
    const formFull = fixture('form-full.pdf');
    const sourceFields = await withPdf(formFull, async (doc) => {
      const fields: unknown = await doc.getFieldObjects();
      expect(fields).toBeInstanceOf(Map);
      return fields instanceof Map ? fields : new Map<string, unknown>();
    });
    expect(sourceFields.size).toBeGreaterThan(0);
    const names = await withPdf(formFull, fieldNames);
    const sourcePages = await withPdf(formFull, async (doc) => doc.numPages);

    const pages = Array.from({ length: sourcePages }, (_, i) => imported(0, i));
    const { bytes } = await insert(fixture('basic-5.pdf'), [...pages, original(0), original(1), original(2), original(3), original(4)], [
      { bytes: formFull },
    ]);
    expectQpdfOk(bytes);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/AcroForm');
    await withPdf(bytes, async (doc) => {
      const resultNames = await fieldNames(doc);
      for (const name of names) expect(resultNames).toContain(name);
      const fields: unknown = await doc.getFieldObjects();
      expect(fields).toBeInstanceOf(Map);
      if (!(fields instanceof Map)) return;
      expect(valuesOf(fields)).toEqual(valuesOf(sourceFields));
      expect(valuesOf(sourceFields).length).toBeGreaterThan(0);
    });
  }, FILE_TIMEOUT);

  it('destino con formulario (form.pdf): los campos importados se añaden a los del destino', async () => {
    const target = fixture('form.pdf');
    const formFull = fixture('form-full.pdf');
    const targetNames = await withPdf(target, fieldNames);
    const importedNames = await withPdf(formFull, fieldNames);
    const sourcePages = await withPdf(formFull, async (doc) => doc.numPages);
    const targetPages = await withPdf(target, async (doc) => doc.numPages);

    const slots: SaveSlot[] = [
      ...Array.from({ length: targetPages }, (_, i) => original(i)),
      ...Array.from({ length: sourcePages }, (_, i) => imported(0, i)),
    ];
    const { bytes } = await insert(target, slots, [{ bytes: formFull }]);
    expectQpdfOk(bytes);
    await withPdf(bytes, async (doc) => {
      const resultNames = await fieldNames(doc);
      for (const name of [...targetNames, ...importedNames]) expect(resultNames).toContain(name);
    });
  }, FILE_TIMEOUT);

  it('insertar en encrypted-aes-256.pdf (usuario) páginas de basic-5.pdf: abre con la contraseña y las páginas se leen cifradas', async () => {
    const basic = fixture('basic-5.pdf');
    const target = fixture('encrypted-aes-256.pdf');
    const targetPages = await withPdf(target, async (doc) => doc.numPages, 'usuario');
    const slots: SaveSlot[] = [imported(0, 0), imported(0, 1), ...Array.from({ length: targetPages }, (_, i) => original(i))];
    const { bytes, delta } = await insert(target, slots, [{ bytes: basic }], 'usuario');

    expectQpdfOk(bytes, 'usuario');
    // Los objetos copiados van cifrados: su texto no aparece en claro en el incremento.
    expect(new TextDecoder('latin1').decode(delta)).not.toContain('Página 1 de 5');
    await withPdf(
      bytes,
      async (doc) => {
        expect(doc.numPages).toBe(targetPages + 2);
        expect(await pageText(doc, 1)).toContain('Página 1 de 5');
        expect(await pageText(doc, 2)).toContain('Página 2 de 5');
      },
      'usuario',
    );
  }, FILE_TIMEOUT);

  it('insertar desde encrypted-aes-128.pdf (usuario) en basic-5.pdf: correcto; con contraseña mala, save-wrong-password', async () => {
    const encrypted = fixture('encrypted-aes-128.pdf');
    const slots: SaveSlot[] = [original(0), imported(0, 0), original(1), original(2), original(3), original(4)];
    const { bytes } = await insert(fixture('basic-5.pdf'), slots, [{ bytes: encrypted, password: 'usuario' }]);
    expectQpdfOk(bytes);
    await withPdf(bytes, async (doc) => {
      expect(doc.numPages).toBe(6);
      expect(await pageText(doc, 2)).toContain('Página 1 de');
    });

    const source = memorySource(fixture('basic-5.pdf'));
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error('openForSave falló');
    const wrong = await openForSave(memorySource(encrypted), 'mala');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('save-wrong-password');
  }, FILE_TIMEOUT);

  it('plan inválido: documento importado inexistente, página fuera de rango o par (doc, source) repetido → organize-invalid', async () => {
    const basic = fixture('basic-5.pdf');
    const outline = fixture('outline.pdf');
    const cases: { readonly slots: SaveSlot[]; readonly from: Imported[] }[] = [
      { slots: [original(0), imported(1, 0)], from: [{ bytes: outline }] },
      { slots: [original(0), imported(0, 99)], from: [{ bytes: outline }] },
      { slots: [original(0), imported(0, 0), imported(0, 0)], from: [{ bytes: outline }] },
      { slots: [original(0), imported(0, 0)], from: [] },
    ];
    for (const { slots, from } of cases) {
      const source = memorySource(basic);
      const opened = await openForSave(source);
      if (!opened.ok) throw new Error('openForSave falló');
      const readers = [];
      for (const file of from) {
        const reader = await openForSave(memorySource(file.bytes), file.password);
        if (!reader.ok) throw new Error('openForSave del importado falló');
        readers.push(reader.value);
      }
      const result = await buildOrganizeUpdate({ source, reader: opened.value, slots, imported: readers, now: NOW });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('organize-invalid');
    }
  });
});
