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
  newBoxShape,
  newLineShape,
  newPolygonShape,
  newStamp,
  type Annotation,
  type NewShapeBase,
  type PdfObjRef,
  type RectPt,
} from '../../../src/core/annotations';
import { loadPdf } from '../../../src/engine';
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
