/**
 * Edición de texto por líneas (PDF-145): borrado real de glifos, texto nuevo con fuente estándar, color y línea base
 * originales, fuentes compartidas, cifrado y errores. Validación externa con pdftotext (poppler), qpdf y pdf.js.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { pageContentBytes, parseContent, type ContentOp } from '../../../src/core/content';
import { buildTextEditUpdate, type LineEdit } from '../../../src/core/edit-text';
import { effectiveResources } from '../../../src/core/pdf/page-content';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, type PdfDict, type PdfRef, type PdfValue } from '../../../src/core/pdf/objects';
import { concatSource } from '../../../src/core/pdf/concat-source';
import { openForSave } from '../../../src/core/pdf/incremental';
import { rewriteDocument } from '../../../src/core/pdf/rewrite';
import type { PdfBuilder } from '../../fixtures/pdf-builder';
import { ensureFixtures } from '../../fixtures/ensure.ts';
import { fixtureBytes, helveticaResources, onePagePdf, openPage } from '../content/helpers';
import { qpdfCheck as qpdfCheckFile, run } from '../../support/qpdf';

type RectPt = readonly [number, number, number, number];

const NOW = '2026-10-20T10:00:00.000Z';
const LATIN1 = 'latin1';
const BASIC = 'basic-5.pdf';
const ENCRYPTED = 'encrypted-aes-256.pdf';
/** Línea «Texto de búsqueda en la página dos.» de la página 2 de basic-5.pdf. */
const SEARCH_HINT: RectPt = [71, 674, 500, 687];
const SEARCH_NEW = 'Texto de búsqueda en la hoja dos.';
const SEARCH_OLD = 'la página dos';
/** Línea «Página 1 de 5» (y = 720) de las páginas 1 y 3 de basic-5.pdf. */
const TOP_LINE_HINT: RectPt = [71, 714, 500, 730];

/** Recursos con F1 = Helvetica estándar y F2 = fuente con /BaseFont `baseFont` (y descriptor opcional). */
function fontsResources(baseFont: string): (b: PdfBuilder) => string {
  return (b) => {
    const f1 = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = b.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /FirstChar 72 /LastChar 73 /Widths [600 600] /Encoding /WinAnsiEncoding >>`,
    );
    return `<< /Font << /F1 ${String(f1)} 0 R /F2 ${String(f2)} 0 R >> >>`;
  };
}

function edit(pageIndex: number, hint: RectPt, text: string): LineEdit {
  return { pageIndex, hint, text };
}

/** Aplica las ediciones como lo hace la operación `edit-text` y devuelve el fichero reescrito completo. */
async function editBytes(data: Uint8Array, edits: readonly LineEdit[]): Promise<Uint8Array> {
  const source = memorySource(data);
  const reader = await ObjectReader.open(source);
  const built = await buildTextEditUpdate({ source, reader, edits, now: NOW });
  if (!built.ok) throw new Error(built.error.code);
  const reopened = await ObjectReader.open(concatSource(source, built.value.delta));
  const written = await rewriteDocument({ reader: reopened, encryption: null, keepEncryption: true, now: NOW });
  if (!written.ok) throw new Error(written.error.code);
  return written.value.bytes;
}

/** Escribe `data` en un directorio temporal, ejecuta `inDir` con la ruta y borra el directorio. */
function withFile<T>(data: Uint8Array, inDir: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'suite-edit-text-'));
  try {
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, data);
    return inDir(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Texto de una página con `pdftotext`. */
function pdftotext(data: Uint8Array, page: number, password?: string): string {
  return withFile(data, (file) => {
    const args = ['-f', String(page), '-l', String(page), ...(password === undefined ? [] : ['-upw', password]), file, '-'];
    const result = spawnSync('pdftotext', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`pdftotext falló: ${result.stderr}`);
    return result.stdout;
  });
}

/** `qpdf --check` sobre los bytes (código de salida). */
function qpdfCheck(data: Uint8Array, password?: string): { code: number } {
  return withFile(data, (file) => qpdfCheckFile(file, password));
}

function qpdfQdf(data: Uint8Array): string {
  return withFile(data, (file) => {
    const { status, stdout, stderr } = run(['--qdf', '--object-streams=disable', file, '-']);
    if (status !== 0) throw new Error(`qpdf --qdf falló: ${stderr}`);
    return stdout;
  });
}

interface TextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly transform: readonly number[];
}

/** Ítems de texto de una página según pdf.js. */
async function textItems(data: Uint8Array, pageNumber: number): Promise<TextItem[]> {
  // pdf.js transfiere el búfer que recibe: se le pasa una copia para no dejar `data` sin bytes.
  const task = getDocument({ data: data.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items.flatMap((item): TextItem[] => {
      if (!('str' in item)) return [];
      return [{ str: item.str, x: item.transform[4] ?? NaN, y: item.transform[5] ?? NaN, height: item.height, transform: item.transform }];
    });
  } finally {
    await task.destroy();
  }
}

/** Operaciones de contenido de la página `index` del fichero. */
async function opsOf(data: Uint8Array, index: number): Promise<readonly ContentOp[]> {
  const { reader, page } = await openPage(data, index);
  return parseContent(await pageContentBytes(reader, page));
}

/** Diccionario de fuente `name` de la página `index`, o null. */
async function fontNamed(data: Uint8Array, index: number, name: string): Promise<PdfDict | null> {
  const { reader, page } = await openPage(data, index);
  const fonts = asDict(await reader.resolve(dictGet(await effectiveResources(reader, page), 'Font')));
  if (fonts === null) return null;
  return asDict(await reader.resolve(fonts.entries.get(name)));
}

/** Referencia del recurso de fuente `name` de la página `index`, o null. */
async function fontRefNamed(data: Uint8Array, index: number, name: string): Promise<PdfRef | null> {
  const { reader, page } = await openPage(data, index);
  const fonts = asDict(await reader.resolve(dictGet(await effectiveResources(reader, page), 'Font')));
  const value = fonts?.entries.get(name);
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'num' in value ? value : null;
}

function asDict(v: PdfValue | undefined): PdfDict | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict' ? v : null;
}

function nameOf(v: PdfValue | undefined): string | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'name' ? v.value : null;
}

async function baseFontOf(data: Uint8Array, index: number, resource: string): Promise<string | null> {
  const font = await fontNamed(data, index, resource);
  return font === null ? null : nameOf(font.entries.get('BaseFont'));
}

describe('buildTextEditUpdate: criterio original (basic-5.pdf)', () => {
  ensureFixtures();
  const basic = fixtureBytes(BASIC);

  it('sustituye la línea 3 de la página 2 y el texto viejo desaparece del fichero', async () => {
    const out = await editBytes(basic, [edit(1, SEARCH_HINT, SEARCH_NEW)]);
    expect(pdftotext(out, 2)).toContain(SEARCH_NEW);
    expect(pdftotext(out, 2)).not.toContain(SEARCH_OLD);
    expect(qpdfQdf(out)).not.toContain('gina dos');
    expect(qpdfCheck(out).code).toBe(0);
  });

  it('el texto nuevo queda en la línea base original (72, 676) con altura de 18 pt; el resto no se mueve', async () => {
    const before = await textItems(basic, 2);
    const after = await textItems(await editBytes(basic, [edit(1, SEARCH_HINT, SEARCH_NEW)]), 2);
    const added = after.find((item) => item.str.includes('hoja dos'));
    expect(added).toBeDefined();
    expect(added?.x).toBeCloseTo(72, 0);
    expect(Math.abs((added?.x ?? NaN) - 72)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((added?.y ?? NaN) - 676)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((added?.height ?? NaN) - 18)).toBeLessThanOrEqual(0.1);
    for (const line of before.filter((item) => item.y === 720 || item.y === 698)) {
      expect(after.find((item) => item.str === line.str)?.transform).toEqual(line.transform);
    }
  });

  it('las anotaciones de la página no cambian', async () => {
    const annots = async (data: Uint8Array): Promise<unknown> => {
      const task = getDocument({ data: data.slice(), verbosity: 0 });
      try {
        const page = await (await task.promise).getPage(2);
        return await page.getAnnotations();
      } finally {
        await task.destroy();
      }
    };
    expect(await annots(await editBytes(basic, [edit(1, SEARCH_HINT, SEARCH_NEW)]))).toEqual(await annots(basic));
  });

  it('la página editada tiene un SuiteEd con /BaseFont /Helvetica; dos páginas con la misma fuente comparten un solo objeto', async () => {
    const out = await editBytes(basic, [edit(0, TOP_LINE_HINT, 'Uno'), edit(2, TOP_LINE_HINT, 'Dos'), edit(1, SEARCH_HINT, SEARCH_NEW)]);
    expect(await baseFontOf(out, 1, 'SuiteEd')).toBe('Helvetica');
    const first = await fontRefNamed(out, 0, 'SuiteEd');
    const third = await fontRefNamed(out, 2, 'SuiteEd');
    expect(first).not.toBeNull();
    expect(first?.num).toBe(third?.num);
  });

  it('texto vacío borra la línea sin escribir un BT nuevo', async () => {
    const out = await editBytes(basic, [edit(1, SEARCH_HINT, '')]);
    expect(pdftotext(out, 2)).not.toContain(SEARCH_OLD);
    expect(await fontNamed(out, 1, 'SuiteEd')).toBeNull();
    expect(pdftotext(out, 2)).toContain('Página 2 de 5');
    expect(qpdfCheck(out).code).toBe(0);
  });

  it('la reescritura es completa: una sola xref y sin /Prev', async () => {
    const out = await editBytes(basic, [edit(1, SEARCH_HINT, SEARCH_NEW)]);
    expect(Buffer.from(out).toString(LATIN1)).not.toContain('/Prev');
  });

  it('sin ediciones devuelve un delta vacío', async () => {
    const source = memorySource(basic);
    const reader = await ObjectReader.open(source);
    const built = await buildTextEditUpdate({ source, reader, edits: [], now: NOW });
    expect(built).toEqual({ ok: true, value: { delta: new Uint8Array(0), expectedSize: basic.length } });
  });
});

describe('buildTextEditUpdate: estilo y errores', () => {
  it('color de la línea: el contenido nuevo fija el mismo rg antes de su Tj', async () => {
    const data = onePagePdf('0 0 1 rg BT /F1 12 Tf 100 500 Td (Hola) Tj ET', helveticaResources);
    const out = await editBytes(data, [edit(0, [95, 495, 200, 515], 'Adiós')]);
    const ops = await opsOf(out, 0);
    const tjIndex = ops.findIndex((op) => op.op === 'Tj' && op.operands.length === 1);
    expect(tjIndex).toBeGreaterThan(0);
    const rgIndex = ops.slice(0, tjIndex).map((op) => op.op).lastIndexOf('rg');
    expect(ops[rgIndex]?.operands).toEqual([0, 0, 1]);
    expect(pdftotext(out, 1)).toContain('Adiós');
  });

  it('Georgia-Bold se reescribe con Times-Bold', async () => {
    const data = onePagePdf('BT /F2 12 Tf 100 300 Td (HH) Tj ET', fontsResources('ABCDEF+Georgia-Bold'));
    const out = await editBytes(data, [edit(0, [95, 295, 130, 315], 'Nuevo')]);
    expect(await baseFontOf(out, 0, 'SuiteEd')).toBe('Times-Bold');
    expect(qpdfCheck(out).code).toBe(0);
  });

  it('texto con caracteres no representables (emoji o salto de línea) → edit-text-invalid y nada escrito', async () => {
    const source = memorySource(fixtureBytes(BASIC));
    const reader = await ObjectReader.open(source);
    for (const text of ['Hola 😀', 'uno\ndos']) {
      const built = await buildTextEditUpdate({ source, reader, edits: [edit(1, SEARCH_HINT, text)], now: NOW });
      expect(built).toEqual({ ok: false, error: expect.objectContaining({ code: 'edit-text-invalid' }) });
    }
  });

  it('una caja que ya no tiene texto → edit-line-missing', async () => {
    const source = memorySource(fixtureBytes(BASIC));
    const reader = await ObjectReader.open(source);
    const built = await buildTextEditUpdate({ source, reader, edits: [edit(1, [300, 300, 400, 320], 'x')], now: NOW });
    expect(built).toEqual({ ok: false, error: expect.objectContaining({ code: 'edit-line-missing' }) });
  });

  it('dos ediciones sobre los mismos glifos → RangeError', async () => {
    const source = memorySource(fixtureBytes(BASIC));
    const reader = await ObjectReader.open(source);
    await expect(
      buildTextEditUpdate({ source, reader, edits: [edit(1, SEARCH_HINT, 'a'), edit(1, SEARCH_HINT, 'b')], now: NOW }),
    ).rejects.toThrow(RangeError);
  });

  it('página fuera de rango, caja no finita o de área 0 → RangeError (bug de la interfaz)', async () => {
    const source = memorySource(fixtureBytes(BASIC));
    const reader = await ObjectReader.open(source);
    const call = (e: LineEdit): Promise<unknown> => buildTextEditUpdate({ source, reader, edits: [e], now: NOW });
    await expect(call(edit(99, SEARCH_HINT, 'a'))).rejects.toThrow(RangeError);
    await expect(call(edit(0.5, SEARCH_HINT, 'a'))).rejects.toThrow(RangeError);
    await expect(call(edit(1, [0, Number.NaN, 10, 10], 'a'))).rejects.toThrow(RangeError);
    await expect(call(edit(1, [5, 5, 5, 20], 'a'))).rejects.toThrow(RangeError);
  });

  it('señal abortada → cancelled', async () => {
    const source = memorySource(fixtureBytes(BASIC));
    const reader = await ObjectReader.open(source);
    const signal = AbortSignal.abort();
    const built = await buildTextEditUpdate({ source, reader, edits: [edit(1, SEARCH_HINT, 'a')], now: NOW, signal });
    expect(built).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });
});

describe('buildTextEditUpdate: cifrado', () => {
  ensureFixtures();

  it('encrypted-aes-256.pdf: sigue cifrado, abre con «usuario» y contiene el texto nuevo y no el viejo', async () => {
    // El cifrado no cambia la disposición del texto: la línea es la de basic-5.pdf sin cifrar.
    const source = memorySource(fixtureBytes(ENCRYPTED));
    const opened = await openForSave(source, 'usuario');
    if (!opened.ok) throw new Error(opened.error.code);
    const built = await buildTextEditUpdate({ source, reader: opened.value, edits: [edit(1, SEARCH_HINT, SEARCH_NEW)], now: NOW });
    if (!built.ok) throw new Error(built.error.code);
    const reopened = await openForSave(concatSource(source, built.value.delta), 'usuario');
    if (!reopened.ok) throw new Error(reopened.error.code);
    const written = await rewriteDocument({ reader: reopened.value, encryption: null, keepEncryption: true, now: NOW });
    if (!written.ok) throw new Error(written.error.code);
    const out = written.value.bytes;
    expect(Buffer.from(out).toString(LATIN1)).toContain('/Encrypt');
    expect(pdftotext(out, 2, 'usuario')).toContain(SEARCH_NEW);
    expect(pdftotext(out, 2, 'usuario')).not.toContain(SEARCH_OLD);
    expect(qpdfCheck(out, 'usuario').code).toBe(0);
  });
});
