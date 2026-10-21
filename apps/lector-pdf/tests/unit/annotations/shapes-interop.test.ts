/**
 * Interoperabilidad de las formas y sellos (PDF-057, ADR-0029): un rectángulo con relleno, una elipse, una flecha,
 * un polígono de cinco vértices y un sello `Draft` escritos sobre `basic-5.pdf` deben pasar `qpdf --check`, leerse
 * en pdf.js con su subtipo, apariencia y caja, y conservar en el diccionario lo que pide ADR-0029.
 * Requiere `qpdf` en el PATH.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  annotationEquals,
  diffAnnotations,
  newBoxShape,
  newLineShape,
  newPolygonShape,
  newStamp,
  type Annotation,
  type NewShapeBase,
  type PdfObjRef,
  type RectPt,
} from '../../../src/core/annotations';
import { openForSave } from '../../../src/core/pdf/incremental';
import { loadPdf } from '../../../src/engine';
import { readPageAnnotations } from '../../../src/engine/annotations-import';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck, qpdfObjects } from '../../support/qpdf';
import { additionsDiff, saveAnnotations } from '../../support/save-annotations';
import { STANDARD_AUTHOR, STANDARD_DATE } from '../../support/standard-annotations';

const assetBaseUrl = nodeAssetBase();
const FILE_TIMEOUT = 120_000;

const base: Omit<NewShapeBase, 'id'> = {
  pageIndex: 0,
  color: [0.9, 0.1, 0.1],
  author: STANDARD_AUTHOR,
  now: STANDARD_DATE,
};

const SQUARE_RECT: RectPt = [72, 600, 172, 650];
const CIRCLE_RECT: RectPt = [200, 600, 300, 650];
const LINE_POINTS: readonly [number, number, number, number] = [72, 500, 200, 520];
const POLYGON_VERTICES: readonly number[] = [320, 600, 380, 610, 400, 650, 350, 670, 310, 640];
const STAMP_CENTER: readonly [number, number] = [300, 400];

/** Las cinco formas de la prueba, en la página 1, con los ids del conjunto. */
function allShapes(): Annotation[] {
  return [
    { ...newBoxShape({ ...base, id: 'suite-shape-square', kind: 'square', rect: SQUARE_RECT, width: 2 }), interior: [1, 1, 0] },
    newBoxShape({ ...base, id: 'suite-shape-circle', kind: 'circle', rect: CIRCLE_RECT, width: 2 }),
    newLineShape({ ...base, id: 'suite-shape-line', points: LINE_POINTS, arrow: true, width: 2 }),
    newPolygonShape({ ...base, id: 'suite-shape-polygon', vertices: POLYGON_VERTICES, width: 2 }),
    newStamp({ ...base, id: 'suite-shape-stamp', name: 'Draft', center: STAMP_CENTER }),
  ];
}

const SUBTYPE: Readonly<Record<string, string>> = {
  square: 'Square',
  circle: 'Circle',
  line: 'Line',
  polygon: 'Polygon',
  stamp: 'Stamp',
};

/** Subtipo PDF esperado y la caja de cada forma tal como debe leerla pdf.js. */
function expectedShapes(): readonly { readonly id: string; readonly subtype: string; readonly rect: RectPt }[] {
  return allShapes().map((a) => ({ id: a.id, subtype: SUBTYPE[a.type] ?? '', rect: a.rect }));
}

function refOf(refs: ReadonlyMap<string, PdfObjRef>, id: string): PdfObjRef {
  const ref = refs.get(id);
  if (ref === undefined) throw new Error(`no se escribió ${id}`);
  return ref;
}

let workDir = '';
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'shapes-interop-'));
});
afterAll(() => {
  if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
});

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function numbersOf(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)) : [];
}

function sameRect(actual: unknown, expected: RectPt): boolean {
  const got = numbersOf(actual);
  return got.length === 4 && expected.every((v, i) => Math.abs((got[i] ?? NaN) - v) <= 0.01);
}

/** Diccionario de qpdf (`--json=2`) de la referencia escrita. */
function dictOf(path: string, ref: PdfObjRef): Record<string, unknown> {
  const object = qpdfObjects(path)[`obj:${ref.num} ${ref.gen} R`];
  const dict = asRecord(object?.value);
  if (dict === undefined) throw new Error(`qpdf no ve el diccionario ${ref.num} ${ref.gen} R`);
  return dict;
}

describe('interoperabilidad · formas y sellos sobre basic-5.pdf', () => {
  it('qpdf --check da 0, pdf.js lee cada forma con su apariencia y su caja, y el diccionario es el de ADR-0029', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data, out } = await saveAnnotations(original, additionsDiff(allShapes()));
    const outPath = join(workDir, 'shapes.pdf');
    writeFileSync(outPath, data);

    expect(qpdfCheck(outPath).code).toBe(0);

    const refs = out.written;
    const expected = expectedShapes();
    for (const e of expected) refOf(refs, e.id);

    // qpdf: claves del diccionario de cada forma.
    const square = dictOf(outPath, refOf(refs, 'suite-shape-square'));
    expect(square['/IC']).toBeDefined();
    expect(square['/BS']).toMatchObject({ '/W': 2, '/S': '/S' });
    expect(dictOf(outPath, refOf(refs, 'suite-shape-circle'))['/IC']).toBeUndefined();

    const line = dictOf(outPath, refOf(refs, 'suite-shape-line'));
    expect(numbersOf(line['/L'])).toEqual(LINE_POINTS);
    expect(line['/LE']).toEqual(['/None', '/OpenArrow']);
    expect(line['/IT']).toBe('/LineArrow');

    expect(numbersOf(dictOf(outPath, refOf(refs, 'suite-shape-polygon'))['/Vertices'])).toEqual(POLYGON_VERTICES);
    expect(dictOf(outPath, refOf(refs, 'suite-shape-stamp'))['/Name']).toBe('/Draft');

    // pdf.js: subtipo, apariencia y caja de cada forma escrita.
    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const page = await loaded.value.doc.getPage(1);
      const raw: unknown = await page.getAnnotations();
      const list: readonly unknown[] = Array.isArray(raw) ? raw : [];
      const annots = list.map(asRecord);
      for (const e of expected) {
        const found = annots.find((a) => a?.subtype === e.subtype && sameRect(a.rect, e.rect));
        expect(found, e.subtype).toBeDefined();
        expect(found?.hasAppearance, e.subtype).toBe(true);
        if (e.subtype === 'Line') expect(found?.lineEndings).toEqual(['None', 'OpenArrow']);
      }
    } finally {
      await loaded.value.destroy();
    }
  }, FILE_TIMEOUT);
});

/** Anotación sin los campos que cambian al volver del fichero (id, origen, fecha de modificación). */
function sinIdentidad(a: Annotation): Annotation {
  return { ...a, id: 'x', origin: { kind: 'new' }, modified: 'x' };
}

describe('interoperabilidad · formas escritas y reabiertas (PDF-107)', () => {
  it('rectángulo con relleno, elipse, flecha de derecha a izquierda, polígono y sello suite- salen editables y iguales', async () => {
    const shapes: Annotation[] = [
      { ...newBoxShape({ ...base, id: 'suite-ida-square', kind: 'square', rect: SQUARE_RECT, width: 2 }), interior: [1, 1, 0] },
      newBoxShape({ ...base, id: 'suite-ida-circle', kind: 'circle', rect: CIRCLE_RECT, width: 2 }),
      newLineShape({ ...base, id: 'suite-ida-line', points: [300, 500, 100, 500], arrow: true, width: 2 }),
      newPolygonShape({ ...base, id: 'suite-ida-polygon', vertices: POLYGON_VERTICES, width: 2 }),
      newStamp({ ...base, id: 'suite-ida-stamp', name: 'Approved', center: STAMP_CENTER }),
    ];
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data } = await saveAnnotations(original, additionsDiff(shapes));

    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const opened = await openForSave(memorySource(data));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const imported = await readPageAnnotations(await loaded.value.doc.getPage(1), STANDARD_DATE, opened.value);

      expect(imported.foreign).toEqual([]);
      expect(imported.supported).toHaveLength(shapes.length);
      for (const original of shapes) {
        const match = imported.supported.find((b) => annotationEquals(sinIdentidad(original), sinIdentidad(b)));
        expect(match, original.id).toBeDefined();
        expect(match?.id, original.id).toMatch(/^ref:\d+R\d*$/);
      }
      const line = imported.supported.find((a) => a.type === 'line');
      expect(line).toMatchObject({ points: [300, 500, 100, 500], endings: ['None', 'OpenArrow'] });
    } finally {
      await loaded.value.destroy();
    }
  }, FILE_TIMEOUT);
});

describe('interoperabilidad · /Square de annotated.pdf (PDF-107)', () => {
  it('el /Square es editable, el resto de ajenas no cambia, y sin lector no cambia nada', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'annotated.pdf')));
    const loaded = await loadPdf(memorySource(bytes), { assetBaseUrl });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const opened = await openForSave(memorySource(bytes));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const squares: Annotation[] = [];
      for (let n = 1; n <= loaded.value.doc.numPages; n++) {
        const page = await loaded.value.doc.getPage(n);
        const plain = await readPageAnnotations(page, STANDARD_DATE);
        const promoted = await readPageAnnotations(page, STANDARD_DATE, opened.value);
        expect(promoted.foreign).toEqual(plain.foreign.filter((a) => a.subtype !== 'Square'));
        expect(promoted.supported.slice(0, plain.supported.length)).toEqual(plain.supported);
        squares.push(...promoted.supported.slice(plain.supported.length));
        expect(plain.foreign.filter((a) => a.subtype === 'Square')).toHaveLength(promoted.supported.length - plain.supported.length);
      }
      expect(squares).toHaveLength(1);
      expect(squares[0]).toMatchObject({
        type: 'square',
        width: 2,
        color: [0, 0.6, 0],
        interior: null,
        author: 'Otra persona',
        opacity: 1,
      });
    } finally {
      await loaded.value.destroy();
    }
  }, FILE_TIMEOUT);

  it('moverlo y guardar pasa qpdf --check y reescribe el diccionario conservando /T y sin /RD ni /BE', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'annotated.pdf')));
    const loaded = await loadPdf(memorySource(bytes), { assetBaseUrl });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    let square: Annotation | undefined;
    try {
      const opened = await openForSave(memorySource(bytes));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      for (let n = 1; n <= loaded.value.doc.numPages && square === undefined; n++) {
        const imported = await readPageAnnotations(await loaded.value.doc.getPage(n), STANDARD_DATE, opened.value);
        square = imported.supported.find((a) => a.type === 'square');
      }
    } finally {
      await loaded.value.destroy();
    }
    if (square === undefined) throw new Error('annotated.pdf no tiene el /Square editable');
    if (square.origin.kind !== 'file') throw new Error('el /Square debe venir del fichero');

    const moved: Annotation = { ...square, rect: [square.rect[0] + 50, square.rect[1], square.rect[2] + 50, square.rect[3]] };
    const diff = diffAnnotations(new Map([[square.id, square]]), {
      upserts: new Map([[moved.id, moved]]),
      removed: new Set(),
      fields: new Map(),
    });
    const { data } = await saveAnnotations(bytes, diff);
    const outPath = join(workDir, 'annotated-square-moved.pdf');
    writeFileSync(outPath, data);

    expect(qpdfCheck(outPath).code).toBe(0);
    const dict = dictOf(outPath, square.origin.ref);
    expect(dict['/T']).toBeDefined();
    expect(dict['/RD']).toBeUndefined();
    expect(dict['/BE']).toBeUndefined();
    expect(numbersOf(dict['/Rect'])).toEqual([122, 600, 250, 700]);
  }, FILE_TIMEOUT);
});
