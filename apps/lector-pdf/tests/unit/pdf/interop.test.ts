/**
 * Interoperabilidad de las anotaciones escritas (PDF-029, ADR-0009): qpdf (lector independiente) y pdf.js
 * (el que usará el visor) deben leer lo que escribimos como anotaciones PDF estándar, sobre los fixtures
 * generados no dañados de ≤ 5 000 páginas y sobre el corpus público. Requiere `qpdf` en el PATH.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  diffAnnotations,
  fileAnnotationId,
  isEmptyDiff,
  type Annotation,
  type PdfObjRef,
} from '../../../src/core/annotations';
import { loadPdf, readPageAnnotations } from '../../../src/engine';
import { CORPUS_DIR, FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfAnnotations, qpdfCheck, qpdfObjects, qpdfVersion, type QpdfObjects } from '../../support/qpdf';
import {
  STANDARD_AUTHOR,
  STANDARD_DATE,
  STANDARD_TYPES,
  standardAnnotations,
  standardId,
} from '../../support/standard-annotations';
import { additionsDiff, saveAnnotations as save } from '../../support/save-annotations';
import { newAnnotation } from '../annotations/factories';

const assetBaseUrl = nodeAssetBase();
const FILE_TIMEOUT = 120_000;
const FALLBACK = '2026-10-17T12:00:00.000Z';
const NOW = '2026-10-18T09:30:00.000Z';
/** Claves comunes que el conjunto estándar debe escribir en cada anotación (ISO 32000 §12.5). */
const COMMON_KEYS = ['/Type', '/Subtype', '/Rect', '/AP', '/F', '/NM', '/P', '/M'];
/** Claves propias de cada subtipo que se exigen además de las comunes. */
const SUBTYPE_KEYS: Readonly<Record<string, readonly string[]>> = {
  Highlight: ['/QuadPoints'],
  Underline: ['/QuadPoints'],
  StrikeOut: ['/QuadPoints'],
  Text: ['/Popup'],
  FreeText: ['/DA'],
  Ink: ['/InkList'],
};
const SUBTYPE_OF: Readonly<Record<string, string>> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  note: 'Text',
  freetext: 'FreeText',
  ink: 'Ink',
};
/** Fixtures generados no dañados de ≤ 5 000 páginas (se excluyen corrupt-* y pages-20000/100000). */
const GENERATED_FILES = [
  'annotated.pdf',
  'basic-5.pdf',
  'compressed.pdf',
  'form.pdf',
  'images-200.pdf',
  'incremental-updates.pdf',
  'links.pdf',
  'outline.pdf',
  'pages-5000.pdf',
  'page-labels.pdf',
  'sizes-mixed.pdf',
];
const CORPUS_FILES = (readdirSync(CORPUS_DIR, { recursive: true }) as string[]).filter((f) => f.endsWith('.pdf')).sort();

/** Todos los ficheros de la prueba, con su ruta absoluta. */
const INPUTS: readonly { readonly name: string; readonly path: string }[] = [
  ...GENERATED_FILES.map((name) => ({ name, path: join(FIXTURES_DIR, name) })),
  ...CORPUS_FILES.map((name) => ({ name, path: join(CORPUS_DIR, name) })),
];

let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'interop-pdf-'));
});

afterAll(() => {
  if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
});

function readBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

function tmpFile(name: string, data: Uint8Array): string {
  const path = join(workDir, name);
  writeFileSync(path, data);
  return path;
}

/** Gravedad de un código de `qpdf --check`: 0 limpio < 3 avisos < 2 errores. */
function severity(code: number): number {
  if (code === 0) return 0;
  if (code === 3) return 1;
  if (code === 2) return 2;
  return 3;
}

/** Anotaciones con soporte de todas las páginas del documento, tal como las importa pdf.js. */
async function importAll(data: Uint8Array): Promise<Annotation[]> {
  const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
  if (!loaded.ok) throw new Error(`pdf.js no abre el resultado: ${loaded.error.code}`);
  try {
    const all: Annotation[] = [];
    for (let p = 1; p <= loaded.value.numPages; p++) {
      const page = await loaded.value.doc.getPage(p);
      all.push(...(await readPageAnnotations(page, FALLBACK)).supported);
    }
    return all;
  } finally {
    await loaded.value.destroy();
  }
}

function expectClose(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected), `${actual} ≠ ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Resultado de la prueba de un fichero: el conjunto estándar escrito sobre la página 1. */
interface Prepared {
  readonly original: { readonly code: number; readonly output: string };
  readonly outPath: string;
  readonly data: Uint8Array;
  readonly written: ReadonlyMap<string, PdfObjRef>;
}

async function prepareStandard(name: string, path: string): Promise<Prepared> {
  const original = qpdfCheck(path);
  const bytes = readBytes(path);
  const { data, out } = await save(bytes, additionsDiff(standardAnnotations(0)));
  const outPath = tmpFile(`std-${name.replaceAll('/', '-')}`, data);
  return { original, outPath, data, written: out.written };
}

describe('interoperabilidad · conjunto estándar en cada fichero', () => {
  it('qpdf instalado (la versión queda en el Registro)', () => {
    expect(qpdfVersion()).toMatch(/\d+\.\d+/);
  });

  it.each(INPUTS.map((f) => f.name))('%s: el original de qpdf es válido o solo tiene avisos', (name) => {
    const input = INPUTS.find((f) => f.name === name);
    expect(input).toBeDefined();
    if (input === undefined) return;
    expect([0, 3]).toContain(qpdfCheck(input.path).code);
  }, FILE_TIMEOUT);

  describe.each(INPUTS.map((f) => f.name))('%s', (name) => {
    let prepared: Prepared | null = null;

    beforeAll(async () => {
      const input = INPUTS.find((f) => f.name === name);
      if (input === undefined) throw new Error(`fichero desconocido: ${name}`);
      prepared = await prepareStandard(name, input.path);
    }, FILE_TIMEOUT);

    function ready(): Prepared {
      if (prepared === null) throw new Error(`${name}: la preparación no terminó`);
      return prepared;
    }

    it('qpdf --check no empeora respecto al original', () => {
      const p = ready();
      const after = qpdfCheck(p.outPath);
      expect(severity(after.code), after.output).toBeLessThanOrEqual(severity(p.original.code));
    }, FILE_TIMEOUT);

    it('qpdf ve los seis subtipos del conjunto con sus claves obligatorias', () => {
      const p = ready();
      const annots = qpdfAnnotations(p.outPath);
      for (const type of STANDARD_TYPES) {
        const subtype = SUBTYPE_OF[type] ?? '';
        const id = standardId(type);
        const ref = p.written.get(id);
        expect(ref, id).toBeDefined();
        if (ref === undefined) continue;
        const found = annots.find((a) => a.ref === `${ref.num} ${ref.gen} R`);
        expect(found, id).toBeDefined();
        expect(found?.subtype).toBe(subtype);
        const required = [...COMMON_KEYS, ...(SUBTYPE_KEYS[subtype] ?? [])];
        for (const key of required) expect(found?.keys, `${id} sin ${key}`).toContain(key);
      }
    }, FILE_TIMEOUT);

    it('pdf.js reimporta el modelo escrito: tipo, geometría, color, contenido y autor', async () => {
      const p = ready();
      const imported = await importPage1(p.data);
      const byId = new Map(imported.map((a) => [a.id, a] as const));
      for (const expected of standardAnnotations(0)) {
        const ref = p.written.get(expected.id);
        expect(ref, expected.id).toBeDefined();
        if (ref === undefined) continue;
        const got = byId.get(fileAnnotationId(ref));
        expect(got, expected.id).toBeDefined();
        if (got === undefined) continue;
        expect(got.type).toBe(expected.type);
        expect(got.contents).toBe(expected.contents);
        expect(got.author).toBe(STANDARD_AUTHOR);
        expect(got.pageIndex).toBe(0);
        expect(got.created).toBe(STANDARD_DATE);
        expect(got.modified).toBe(NOW);
        for (let i = 0; i < 4; i++) expectClose(got.rect[i] ?? NaN, expected.rect[i] ?? NaN, 0.01);
        for (let i = 0; i < 3; i++) expectClose(got.color[i] ?? NaN, expected.color[i] ?? NaN, 1 / 255);
        if (expected.type === 'ink') {
          expect(got).toMatchObject({ type: 'ink', paths: expected.paths });
        }
        if (expected.type === 'highlight' || expected.type === 'underline' || expected.type === 'strikeout') {
          expect(got).toMatchObject({ type: expected.type, quads: expected.quads });
        }
      }
    }, FILE_TIMEOUT);
  });
});

/** Anotaciones soportadas de la página 1 según pdf.js. */
async function importPage1(data: Uint8Array): Promise<readonly Annotation[]> {
  const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
  if (!loaded.ok) throw new Error(`pdf.js no abre el resultado: ${loaded.error.code}`);
  try {
    const page = await loaded.value.doc.getPage(1);
    return (await readPageAnnotations(page, FALLBACK)).supported;
  } finally {
    await loaded.value.destroy();
  }
}

describe('ida y vuelta · annotated.pdf con tres guardados seguidos', () => {
  it('tras cada guardado, qpdf acepta el fichero y pdf.js lee exactamente el modelo esperado', async () => {
    let current = readBytes(join(FIXTURES_DIR, 'annotated.pdf'));
    for (let round = 1; round <= 3; round++) {
      const baseline = await importAll(current);
      const [first, ...rest] = baseline;
      const removed = rest[rest.length - 1];
      expect(first, 'línea base vacía').toBeDefined();
      expect(removed, 'sin anotación que borrar').toBeDefined();
      if (first === undefined || removed === undefined) return;

      const modified: Annotation = { ...first, contents: `Editada ronda ${round} ñ €`, modified: NOW };
      const addedHighlight: Annotation = {
        ...newAnnotation(`suite-rt-${round}-hl`, 'highlight', 0),
        contents: `Alta ronda ${round}`,
        author: STANDARD_AUTHOR,
        created: NOW,
        modified: NOW,
      };
      const addedInk: Annotation = {
        ...newAnnotation(`suite-rt-${round}-ink`, 'ink', 1),
        author: STANDARD_AUTHOR,
        created: NOW,
        modified: NOW,
      };
      const added = [addedHighlight, addedInk];
      const diff = diffAnnotations(new Map(baseline.map((a) => [a.id, a] as const)), {
        upserts: new Map([modified, ...added].map((a) => [a.id, a] as const)),
        removed: new Set([removed.id]),
        fields: new Map(),
      });

      const saved = await save(current, diff);
      current = saved.data;

      const expected = new Map<string, Annotation>();
      for (const a of baseline) {
        if (a.id !== removed.id && a.id !== modified.id) expected.set(a.id, a);
      }
      expected.set(modified.id, modified);
      for (const a of added) {
        const ref = saved.out.written.get(a.id);
        expect(ref, a.id).toBeDefined();
        if (ref === undefined) return;
        const id = fileAnnotationId(ref);
        expected.set(id, { ...a, id, origin: { kind: 'file', ref, popupRef: null } });
      }

      const after = await importAll(current);
      expect(new Set(after.map((a) => a.id))).toEqual(new Set(expected.keys()));
      const check = diffAnnotations(new Map(after.map((a) => [a.id, a] as const)), {
        upserts: expected,
        removed: new Set(),
        fields: new Map(),
      });
      expect(check.modified.map((a) => a.id)).toEqual([]);
      expect(check.added).toEqual([]);
      expect(isEmptyDiff(check)).toBe(true);

      const path = tmpFile(`roundtrip-${round}.pdf`, current);
      const result = qpdfCheck(path);
      expect(result.code, result.output).toBe(0);
    }
  }, FILE_TIMEOUT);
});

describe('conservación · el resto del fichero no cambia', () => {
  it('annotated.pdf: el Square y el Link de la página 3 mantienen su diccionario', async () => {
    const path = join(FIXTURES_DIR, 'annotated.pdf');
    const before = qpdfObjects(path);
    const { data } = await save(readBytes(path), additionsDiff(standardAnnotations(0)));
    const after = qpdfObjects(tmpFile('conserva-annotated.pdf', data));

    const page3 = pageObjectAt(before, 2);
    const annotRefs = arrayOf(dictValue(page3, '/Annots'));
    const watched = annotRefs.filter((ref) => {
      const subtype = dictValue(objectValue(before, ref), '/Subtype');
      return subtype === '/Square' || subtype === '/Link';
    });
    expect(watched.map((ref) => dictValue(objectValue(before, ref), '/Subtype')).sort()).toEqual(['/Link', '/Square']);
    for (const ref of watched) {
      expect(objectValue(after, ref), `objeto ${ref}`).toEqual(objectValue(before, ref));
    }
  }, FILE_TIMEOUT);

  it('form.pdf: /AcroForm del catálogo se conserva al guardar anotaciones', async () => {
    const path = join(FIXTURES_DIR, 'form.pdf');
    const before = catalogOf(qpdfObjects(path));
    const { data } = await save(readBytes(path), additionsDiff(standardAnnotations(0)));
    const after = catalogOf(qpdfObjects(tmpFile('conserva-form.pdf', data)));
    expect(before).toHaveProperty('/AcroForm');
    expect(after['/AcroForm']).toEqual(before['/AcroForm']);
  }, FILE_TIMEOUT);
});

type Dict = Readonly<Record<string, unknown>>;

function objectValue(objects: QpdfObjects, ref: string): unknown {
  return objects[`obj:${ref}`]?.value;
}

function dictValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Dict)[key];
}

function arrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Referencia `"N G R"` de la página `index` (0-based) según las objetos del catálogo `/Pages`. */
function pageObjectAt(objects: QpdfObjects, index: number): unknown {
  const pages = collectPages(objects);
  const ref = pages[index];
  if (ref === undefined) throw new Error(`sin página ${index + 1}`);
  return objectValue(objects, ref);
}

function collectPages(objects: QpdfObjects): string[] {
  const out: string[] = [];
  const visit = (ref: string): void => {
    const value = objectValue(objects, ref);
    if (dictValue(value, '/Type') === '/Page') {
      out.push(ref);
      return;
    }
    for (const kid of arrayOf(dictValue(value, '/Kids'))) visit(kid);
  };
  const catalog = catalogOf(objects);
  const root = typeof catalog['/Pages'] === 'string' ? catalog['/Pages'] : '';
  visit(root);
  return out;
}

function catalogOf(objects: QpdfObjects): Dict {
  for (const object of Object.values(objects)) {
    if (dictValue(object.value, '/Type') === '/Catalog') return object.value as Dict;
  }
  throw new Error('sin /Catalog');
}
