/**
 * Formas y sellos ajenos que pasan a editables (PDF-107, ADR-0029). Diccionarios construidos a mano con `dict`,
 * `name` y `bytesString`; el lector es falso y solo responde `getDict`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  newBoxShape,
  promoteShapes,
  shapeFromDict,
  SHAPE_SUBTYPES,
  type ForeignAnnotation,
  type ImportedPage,
} from '../../../src/core/annotations';
import type { ObjectReader } from '../../../src/core/pdf/object-reader';
import { bytesString, dict, name, type PdfDict, type PdfValue } from '../../../src/core/pdf/objects';
import { encodeTextString } from '../../../src/core/pdf/text-string';

const FALLBACK = '2026-10-19T09:00:00.000Z';
const BLACK = [0, 0, 0] as const;
const CREATED = '2026-10-18T10:00:00.000Z';
const MODIFIED = '2026-10-17T08:00:00.000Z';

/** Anotación ajena tal como la deja `importForeign` (id `ref:<num>R`). */
function foreign(subtype: string, extra: Partial<ForeignAnnotation> = {}): ForeignAnnotation {
  return {
    id: 'ref:10R',
    pageIndex: 0,
    subtype,
    rect: [0, 0, 0, 0],
    contents: 'Revisar',
    author: 'Luis',
    modified: MODIFIED,
    ...extra,
  };
}

/** Diccionario de la anotación: `Rect` por defecto y el resto de claves de cada caso. */
function annot(subtype: string, entries: Record<string, PdfValue> = {}): PdfDict {
  return dict({ Type: name('Annot'), Subtype: name(subtype), Rect: [100, 100, 200, 150], ...entries });
}

function bs(entries: Record<string, PdfValue>): PdfValue {
  return dict(entries);
}

/** `/BS` de trazo continuo de grosor `w`. */
function solid(w: number): PdfValue {
  return bs({ W: w, S: name('S') });
}

function page(...items: readonly ForeignAnnotation[]): ImportedPage {
  return { supported: [], foreign: items, widgets: [] };
}

/** Lector falso con `getDict` por número de objeto; los ausentes dan `null` y `'throws'` lanza. */
function fakeReader(objects: Record<number, PdfDict | 'throws'>): { reader: ObjectReader; getDict: ReturnType<typeof vi.fn> } {
  const getDict = vi.fn(async (r: { num: number }) => {
    const o = objects[r.num];
    if (o === 'throws') throw new Error('objeto roto');
    return o ?? null;
  });
  return { reader: { getDict } as unknown as ObjectReader, getDict };
}

describe('SHAPE_SUBTYPES', () => {
  it('contiene solo los subtipos de formas y sellos que pueden pasar a editables', () => {
    expect([...SHAPE_SUBTYPES].sort()).toEqual(['Circle', 'Line', 'Polygon', 'Square', 'Stamp']);
  });
});

describe('shapeFromDict · rectángulo y elipse', () => {
  it('un /Square con /BS /W, /C, /IC y /CA pasa a rectángulo con esos datos', () => {
    const a = shapeFromDict(
      annot('Square', {
        BS: solid(2),
        C: [0, 0.6, 0],
        IC: [1, 1, 0],
        CA: 0.5,
        CreationDate: bytesString(new TextEncoder().encode('D:20261018100000Z')),
      }),
      foreign('Square'),
      FALLBACK,
    );
    expect(a).toEqual({
      id: 'ref:10R',
      type: 'square',
      pageIndex: 0,
      rect: [100, 100, 200, 150],
      color: [0, 0.6, 0],
      opacity: 0.5,
      contents: 'Revisar',
      author: 'Luis',
      modified: MODIFIED,
      created: CREATED,
      origin: { kind: 'file', ref: { num: 10, gen: 0 }, popupRef: null },
      width: 2,
      interior: [1, 1, 0],
    });
  });

  it('sin /BS, /C, /IC ni /CA: grosor 1, negro, sin relleno, opacidad 1 y sin fecha de creación', () => {
    const a = shapeFromDict(annot('Circle'), foreign('Circle', { modified: null }), FALLBACK);
    expect(a).toMatchObject({
      type: 'circle',
      width: 1,
      color: [0, 0, 0],
      interior: null,
      opacity: 1,
      created: null,
      modified: FALLBACK,
    });
  });

  it('sin /BS pero con /Border [0 0 3] el grosor es 3', () => {
    const a = shapeFromDict(
      annot('Square', { Border: [0, 0, 3] }),
      foreign('Square'),
      FALLBACK,
    );
    expect(a).toMatchObject({ type: 'square', width: 3 });
  });

  it('/BS /W tiene prioridad sobre /Border', () => {
    const a = shapeFromDict(annot('Square', { BS: bs({ W: 4 }), Border: [0, 0, 9] }), foreign('Square'), FALLBACK);
    expect(a).toMatchObject({ width: 4 });
  });

  it('/CA fuera de [0, 1] se acota; /CA que no es número deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { CA: 3 }), foreign('Square'), FALLBACK)).toMatchObject({ opacity: 1 });
    expect(shapeFromDict(annot('Square', { CA: name('x') }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/CreationDate con una fecha no válida da `created: null` sin dejar la anotación ajena', () => {
    const a = shapeFromDict(
      annot('Square', { CreationDate: bytesString(new TextEncoder().encode('D:20261332')) }),
      foreign('Square'),
      FALLBACK,
    );
    expect(a).toMatchObject({ created: null });
  });

  it('/CreationDate que no es cadena deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { CreationDate: 5 }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/Popup como referencia se guarda en el origen', () => {
    const a = shapeFromDict(annot('Square', { Popup: { kind: 'ref', num: 77, gen: 2 } }), foreign('Square'), FALLBACK);
    expect(a).toMatchObject({ origin: { kind: 'file', ref: { num: 10, gen: 0 }, popupRef: { num: 77, gen: 2 } } });
  });

  it('/Popup que no es referencia deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { Popup: 3 }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/Rect se normaliza (x1 > x2 o y1 > y2)', () => {
    const a = shapeFromDict(annot('Square', { Rect: [200, 150, 100, 100] }), foreign('Square'), FALLBACK);
    expect(a).toMatchObject({ rect: [100, 100, 200, 150] });
  });

  it('/Rect que no tiene cuatro números deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { Rect: [1, 2, 3] }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/C con otro tamaño o fuera de [0, 1] deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { C: [0, 1] }), foreign('Square'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Square', { C: [0, 0, 2] }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/IC con otro tamaño, fuera de rango o no numérico deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { IC: [1, 1] }), foreign('Square'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Square', { IC: [1, 1, -1] }), foreign('Square'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Square', { IC: [1, 1, name('x')] }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/IC vacío o nulo es sin relleno', () => {
    expect(shapeFromDict(annot('Square', { IC: null }), foreign('Square'), FALLBACK)).toMatchObject({ interior: null });
  });

  it('/BS /W de 0 es una forma invisible: sigue ajena', () => {
    expect(shapeFromDict(annot('Square', { BS: bs({ W: 0 }) }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/BS /W negativo o que no es número deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { BS: bs({ W: -1 }) }), foreign('Square'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Square', { BS: bs({ W: name('x') }) }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/BS /S distinto de /S (borde discontinuo) deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { BS: bs({ W: 2, S: name('D') }) }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/BS /S que no es nombre deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { BS: bs({ W: 2, S: 4 }) }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/BS que no es diccionario deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { BS: name('S') }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/BS sin /W ni /Border usa el grosor por defecto 1', () => {
    expect(shapeFromDict(annot('Square', { BS: bs({ S: name('S') }) }), foreign('Square'), FALLBACK)).toMatchObject({ width: 1 });
  });

  it('/BE /S /C (efecto nube) deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Circle', { BE: bs({ S: name('C'), I: 1 }) }), foreign('Circle'), FALLBACK)).toBeNull();
  });

  it('/BE sin efecto nube no impide que la anotación sea editable', () => {
    expect(shapeFromDict(annot('Circle', { BE: bs({ S: name('S') }) }), foreign('Circle'), FALLBACK)).toMatchObject({
      type: 'circle',
    });
  });

  it('/Border con patrón de trazo discontinuo (cuarto elemento) deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { Border: [0, 0, 1, [3, 2]] }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('/Border con grosor 0 o con menos de tres elementos deja la anotación ajena', () => {
    expect(shapeFromDict(annot('Square', { Border: [0, 0, 0] }), foreign('Square'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Square', { Border: [0, 0] }), foreign('Square'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Square', { Border: name('x') }), foreign('Square'), FALLBACK)).toBeNull();
  });

  it('un id que no es de referencia (`ref:?...`) no se puede promover', () => {
    expect(shapeFromDict(annot('Square'), foreign('Square', { id: 'ref:?0.1' }), FALLBACK)).toBeNull();
  });

  it('un subtipo que no es de formas no se promueve', () => {
    expect(shapeFromDict(annot('Highlight'), foreign('Highlight'), FALLBACK)).toBeNull();
  });
});

describe('shapeFromDict · línea y flecha', () => {
  it('una /Line con /L, /LE de flecha y /IT /LineArrow pasa a línea con su orden de puntos', () => {
    const a = shapeFromDict(
      annot('Line', { L: [300, 500, 100, 500], LE: [name('None'), name('OpenArrow')], IT: name('LineArrow'), BS: solid(2) }),
      foreign('Line'),
      FALLBACK,
    );
    expect(a).toMatchObject({ type: 'line', points: [300, 500, 100, 500], endings: ['None', 'OpenArrow'], width: 2, interior: null });
  });

  it('sin /LE los extremos son None y None; sin /IT es válida', () => {
    const a = shapeFromDict(annot('Line', { L: [1, 2, 3, 4] }), foreign('Line'), FALLBACK);
    expect(a).toMatchObject({ endings: ['None', 'None'], points: [1, 2, 3, 4] });
  });

  it('/LE con un extremo fuera de los soportados (/Diamond) deja la línea ajena', () => {
    const a = shapeFromDict(annot('Line', { L: [1, 2, 3, 4], LE: [name('None'), name('Diamond')] }), foreign('Line'), FALLBACK);
    expect(a).toBeNull();
  });

  it('/LE que no tiene dos nombres deja la línea ajena', () => {
    expect(shapeFromDict(annot('Line', { L: [1, 2, 3, 4], LE: [name('None')] }), foreign('Line'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Line', { L: [1, 2, 3, 4], LE: [name('None'), 2] }), foreign('Line'), FALLBACK)).toBeNull();
  });

  it('/IT distinto de /LineArrow (cota) deja la línea ajena', () => {
    const a = shapeFromDict(annot('Line', { L: [1, 2, 3, 4], IT: name('LineDimension') }), foreign('Line'), FALLBACK);
    expect(a).toBeNull();
  });

  it('/IT que no es nombre deja la línea ajena', () => {
    expect(shapeFromDict(annot('Line', { L: [1, 2, 3, 4], IT: 3 }), foreign('Line'), FALLBACK)).toBeNull();
  });

  it('/L que no tiene cuatro números deja la línea ajena', () => {
    expect(shapeFromDict(annot('Line', { L: [1, 2, 3] }), foreign('Line'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Line'), foreign('Line'), FALLBACK)).toBeNull();
  });
});

describe('shapeFromDict · polígono', () => {
  it('un /Polygon con seis o más números pares pasa a polígono con sus vértices', () => {
    const a = shapeFromDict(
      annot('Polygon', { Vertices: [0, 0, 10, 0, 5, 8] }),
      foreign('Polygon'),
      FALLBACK,
    );
    expect(a).toMatchObject({ type: 'polygon', vertices: [0, 0, 10, 0, 5, 8], width: 1, interior: null });
  });

  it('un /Polygon con 4 números (dos vértices) sigue ajeno', () => {
    expect(shapeFromDict(annot('Polygon', { Vertices: [0, 0, 10, 0] }), foreign('Polygon'), FALLBACK)).toBeNull();
  });

  it('un /Polygon con longitud impar o sin /Vertices sigue ajeno', () => {
    expect(shapeFromDict(annot('Polygon', { Vertices: [0, 0, 10, 0, 5] }), foreign('Polygon'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Polygon'), foreign('Polygon'), FALLBACK)).toBeNull();
  });

  it('un /Polygon con /IT (polilínea o cota) sigue ajeno; /IT nulo no cuenta', () => {
    expect(shapeFromDict(annot('Polygon', { Vertices: [0, 0, 10, 0, 5, 8], IT: name('PolygonCloud') }), foreign('Polygon'), FALLBACK)).toBeNull();
    expect(shapeFromDict(annot('Polygon', { Vertices: [0, 0, 10, 0, 5, 8], IT: null }), foreign('Polygon'), FALLBACK)).toMatchObject({
      type: 'polygon',
    });
  });
});

describe('shapeFromDict · sello', () => {
  const suiteStamp = (extra: Record<string, PdfValue> = {}): PdfDict =>
    annot('Stamp', { Name: name('Approved'), NM: encodeTextString('suite-3f2a'), ...extra });

  it('un /Stamp /Approved con /NM suite-… pasa a sello', () => {
    const a = shapeFromDict(suiteStamp({ C: [0, 0.5, 0] }), foreign('Stamp'), FALLBACK);
    expect(a).toMatchObject({ type: 'stamp', name: 'Approved', color: [0, 0.5, 0], id: 'ref:10R' });
  });

  it('un /Stamp sin /NM sigue ajeno (sello de otro programa)', () => {
    expect(shapeFromDict(annot('Stamp', { Name: name('Approved') }), foreign('Stamp'), FALLBACK)).toBeNull();
  });

  it('un /Stamp con /NM que no empieza por suite- sigue ajeno (p. ej. adobe-1)', () => {
    expect(shapeFromDict(suiteStamp({ NM: encodeTextString('adobe-1') }), foreign('Stamp'), FALLBACK)).toBeNull();
  });

  it('un /Stamp con /NM que no es texto sigue ajeno', () => {
    expect(shapeFromDict(suiteStamp({ NM: name('suite-1') }), foreign('Stamp'), FALLBACK)).toBeNull();
  });

  it('un /Stamp de suite con un /Name que no es un sello estándar (SuiteFirma) sigue ajeno', () => {
    expect(shapeFromDict(suiteStamp({ Name: name('SuiteFirma') }), foreign('Stamp'), FALLBACK)).toBeNull();
  });

  it('un /Stamp sin /Name o con /Name que no es nombre sigue ajeno', () => {
    expect(shapeFromDict(annot('Stamp', { NM: encodeTextString('suite-1') }), foreign('Stamp'), FALLBACK)).toBeNull();
    expect(shapeFromDict(suiteStamp({ Name: 4 }), foreign('Stamp'), FALLBACK)).toBeNull();
  });
});

describe('promoteShapes', () => {
  it('pasa a supported las formas que encajan, al final, y deja el resto de ajenas en su orden', async () => {
    const { reader } = fakeReader({
      10: annot('Square', { BS: solid(2) }),
      11: annot('Square', { BS: bs({ W: 2, S: name('D') }) }),
      12: annot('Stamp', { Name: name('Draft'), NM: encodeTextString('suite-x') }),
    });
    const imported: ImportedPage = {
      supported: [],
      foreign: [
        foreign('Square', { id: 'ref:10R' }),
        foreign('Square', { id: 'ref:11R' }),
        foreign('Text', { id: 'ref:9R' }),
        foreign('Stamp', { id: 'ref:12R' }),
      ],
      widgets: [],
    };
    const out = await promoteShapes(reader, imported, FALLBACK);
    expect(out.supported.map((a) => a.id)).toEqual(['ref:10R', 'ref:12R']);
    expect(out.foreign.map((a) => a.id)).toEqual(['ref:11R', 'ref:9R']);
    expect(out.widgets).toBe(imported.widgets);
  });

  it('conserva las anotaciones soportadas que ya había', async () => {
    const { reader } = fakeReader({ 10: annot('Circle') });
    const existing = newBoxShape({ id: 'suite-5', pageIndex: 0, color: BLACK, author: 'Ana', now: CREATED, kind: 'square', rect: [0, 0, 1, 1], width: 1 });
    const out = await promoteShapes(reader, { supported: [existing], foreign: [foreign('Circle', { id: 'ref:10R' })], widgets: [] }, FALLBACK);
    expect(out.supported.map((a) => a.id)).toEqual(['suite-5', 'ref:10R']);
    expect(out.foreign).toEqual([]);
  });

  it('sin formas que encajen devuelve la misma página sin leer nada más que las de SHAPE_SUBTYPES', async () => {
    const { reader, getDict } = fakeReader({});
    const input = page(foreign('Highlight', { id: 'ref:3R' }), foreign('Square', { id: 'ref:?0.1' }));
    const out = await promoteShapes(reader, input, FALLBACK);
    expect(out).toBe(input);
    expect(getDict).not.toHaveBeenCalled();
  });

  it('una forma cuyo objeto no existe o no se puede leer sigue ajena, sin lanzar', async () => {
    const { reader } = fakeReader({ 20: 'throws' });
    const out = await promoteShapes(
      reader,
      page(foreign('Square', { id: 'ref:20R' }), foreign('Square', { id: 'ref:21R' })),
      FALLBACK,
    );
    expect(out.supported).toEqual([]);
    expect(out.foreign.map((a) => a.id)).toEqual(['ref:20R', 'ref:21R']);
  });

  it('una forma con id que no es de referencia no se consulta', async () => {
    const { reader, getDict } = fakeReader({});
    const out = await promoteShapes(reader, page(foreign('Line', { id: 'ref:?0.1' })), FALLBACK);
    expect(out.foreign).toHaveLength(1);
    expect(getDict).not.toHaveBeenCalled();
  });

  it('una referencia con número 0 no se consulta', async () => {
    const { reader, getDict } = fakeReader({});
    const out = await promoteShapes(reader, page(foreign('Line', { id: 'ref:0R' })), FALLBACK);
    expect(out.foreign).toHaveLength(1);
    expect(getDict).not.toHaveBeenCalled();
  });

  it('un objeto que no es diccionario (null) deja la forma ajena', async () => {
    const { reader } = fakeReader({});
    const out = await promoteShapes(reader, page(foreign('Square', { id: 'ref:30R' })), FALLBACK);
    expect(out.foreign).toHaveLength(1);
    expect(out.supported).toEqual([]);
  });
});
