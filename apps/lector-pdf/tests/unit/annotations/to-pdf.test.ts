import { describe, expect, it } from 'vitest';
import { annotationDict, popupDict, updatedDict } from '../../../src/core/annotations/to-pdf';
import type { Annotation, AnnotationType } from '../../../src/core/annotations';
import { decodeTextString } from '../../../src/core/pdf/text-string';
import { dict, dictGet, name, ref, type PdfDict, type PdfString, type PdfValue } from '../../../src/core/pdf/objects';
import { newAnnotation } from './factories';

const PAGE = ref(3);
const AP = ref(9);
const POPUP = ref(10);
const NOW = '2026-10-18T09:30:00.000Z';

type Of<T extends AnnotationType> = Extract<Annotation, { readonly type: T }>;

/** Anotación de prueba del tipo `T` con los campos `over`; las fábricas devuelven la unión completa. */
function make<T extends AnnotationType>(type: T, over: object = {}): Of<T> {
  return { ...newAnnotation('a', type), ...over, type } as Of<T>;
}

function str(v: PdfValue | undefined): string {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !('kind' in v) || v.kind !== 'string') {
    throw new Error('se esperaba una cadena PDF');
  }
  return decodeTextString(v as PdfString);
}

function nameOf(v: PdfValue | undefined): string {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !('kind' in v) || v.kind !== 'name') {
    throw new Error('se esperaba un nombre PDF');
  }
  return v.value;
}

function build(a: Annotation, popupRef: typeof POPUP | null = null): PdfDict {
  return annotationDict(a, { pageRef: PAGE, apRef: AP, popupRef, now: NOW });
}

describe('annotationDict', () => {
  it('comunes: tipo, rect, comentario, autor, id, fechas, página, flags, color, opacidad y apariencia', () => {
    const d = build({ ...newAnnotation('suite-1', 'highlight'), contents: 'Ojo', author: 'Ana', opacity: 0.5 });
    expect(nameOf(dictGet(d, 'Type'))).toBe('Annot');
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Highlight');
    expect(dictGet(d, 'Rect')).toEqual([10, 20, 110, 40]);
    expect(str(dictGet(d, 'Contents'))).toBe('Ojo');
    expect(str(dictGet(d, 'T'))).toBe('Ana');
    expect(str(dictGet(d, 'NM'))).toBe('suite-1');
    expect(str(dictGet(d, 'M'))).toBe('D:20261018093000Z');
    expect(str(dictGet(d, 'CreationDate'))).toBe('D:20261017120000Z');
    expect(dictGet(d, 'P')).toEqual(PAGE);
    expect(dictGet(d, 'F')).toBe(4);
    expect(dictGet(d, 'C')).toEqual([1, 1, 0]);
    expect(dictGet(d, 'CA')).toBe(0.5);
    expect(dictGet(d, 'AP')).toMatchObject({ kind: 'dict' });
    expect((dictGet(d, 'AP') as PdfDict).entries.get('N')).toEqual(AP);
    expect(dictGet(d, 'Popup')).toBeUndefined();
  });

  it('usa la fecha de creación del fichero si la hay', () => {
    const d = build({ ...newAnnotation('suite-2', 'ink'), created: '2026-01-02T03:04:05.000Z' });
    expect(str(dictGet(d, 'CreationDate'))).toBe('D:20260102030405Z');
  });

  it('resaltado, subrayado y tachado: QuadPoints aplanados y subtipo propio', () => {
    const quads = [
      [10, 40, 110, 40, 10, 20, 110, 20],
      [10, 60, 50, 60, 10, 50, 50, 50],
    ] as const;
    expect(nameOf(dictGet(build(make('highlight', { quads })), 'Subtype'))).toBe('Highlight');
    expect(nameOf(dictGet(build(make('underline', { quads })), 'Subtype'))).toBe('Underline');
    const strike = build(make('strikeout', { quads }));
    expect(nameOf(dictGet(strike, 'Subtype'))).toBe('StrikeOut');
    expect(dictGet(strike, 'QuadPoints')).toEqual([10, 40, 110, 40, 10, 20, 110, 20, 10, 60, 50, 60, 10, 50, 50, 50]);
  });

  it('nota: icono como nombre, Open, y Popup solo si hay popup', () => {
    const note = { ...newAnnotation('n', 'note'), icon: 'Help' as const, open: true };
    const without = build(note);
    expect(nameOf(dictGet(without, 'Subtype'))).toBe('Text');
    expect(nameOf(dictGet(without, 'Name'))).toBe('Help');
    expect(dictGet(without, 'Open')).toBe(true);
    expect(dictGet(without, 'Popup')).toBeUndefined();
    expect(dictGet(build(note, POPUP), 'Popup')).toEqual(POPUP);
  });

  it('texto libre: DA con fuente Helv, color del texto, Q 0 y borde de 1 pt', () => {
    const d = build(make('freetext', { fontSize: 14.5, textColor: [1, 0, 0.5] }));
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('FreeText');
    const da = dictGet(d, 'DA');
    expect(typeof da === 'object' && da !== null && 'bytes' in da ? new TextDecoder().decode(da.bytes) : '')
      .toBe('/Helv 14.5 Tf 1 0 0.5 rg');
    expect(dictGet(d, 'Q')).toBe(0);
    expect(dictGet(d, 'BS')).toMatchObject({ kind: 'dict' });
    expect(((dictGet(d, 'BS') as PdfDict).entries.get('W'))).toBe(1);
  });

  it('dibujo: InkList con un array por trazo y grosor en BS', () => {
    const d = build(make('ink', { paths: [[1, 2, 3, 4], [5, 6]], width: 4 }));
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Ink');
    expect(dictGet(d, 'InkList')).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect((dictGet(d, 'BS') as PdfDict).entries.get('W')).toBe(4);
  });
});

describe('popupDict', () => {
  it('caja de 200 × 100 pt a la derecha y arriba de la nota, hija de ella, oculta por flags 28', () => {
    const p = popupDict(ref(7), [10, 20, 30, 50], true);
    expect(nameOf(dictGet(p, 'Subtype'))).toBe('Popup');
    expect(dictGet(p, 'Rect')).toEqual([30, -50, 230, 50]);
    expect(dictGet(p, 'Parent')).toEqual(ref(7));
    expect(dictGet(p, 'Open')).toBe(true);
    expect(dictGet(p, 'F')).toBe(28);
  });
});

describe('updatedDict', () => {
  const original = ((): PdfDict => {
    const d = build({ ...newAnnotation('ref:5R', 'highlight'), contents: 'Viejo' }, POPUP);
    return withExtra(d);
  })();

  /** Añade una respuesta (`/IRT`) y texto enriquecido (`/RC`), claves que `updatedDict` debe conservar o quitar. */
  function withExtra(d: PdfDict): PdfDict {
    const entries = new Map<string, PdfValue>(d.entries);
    entries.set('IRT', ref(40));
    entries.set('RC', { kind: 'string', bytes: new Uint8Array([1]), hex: false });
    return { kind: 'dict', entries };
  }

  it('actualiza rect, comentario, fecha, color, opacidad y apariencia, y conserva el resto de claves', () => {
    const a: Annotation = {
      ...newAnnotation('ref:5R', 'highlight'),
      rect: [1, 2, 3, 4],
      contents: 'Nuevo',
      color: [0, 0, 1],
      opacity: 0.25,
      origin: { kind: 'file', ref: { num: 5, gen: 0 }, popupRef: null },
    };
    const u = updatedDict(original, a, { apRef: ref(77), now: NOW });
    expect(dictGet(u, 'Rect')).toEqual([1, 2, 3, 4]);
    expect(str(dictGet(u, 'Contents'))).toBe('Nuevo');
    expect(str(dictGet(u, 'M'))).toBe('D:20261018093000Z');
    expect(dictGet(u, 'C')).toEqual([0, 0, 1]);
    expect(dictGet(u, 'CA')).toBe(0.25);
    expect((dictGet(u, 'AP') as PdfDict).entries.get('N')).toEqual(ref(77));
    // Conserva lo que no cambia: página, popup, respuesta y claves privadas.
    expect(dictGet(u, 'P')).toEqual(PAGE);
    expect(dictGet(u, 'Popup')).toEqual(POPUP);
    expect(dictGet(u, 'IRT')).toEqual(ref(40));
    expect(dictGet(u, 'T')).toEqual(dictGet(original, 'T'));
  });

  it('si cambia el texto, quita /RC; si no cambia, lo conserva', () => {
    const same = updatedDict(original, { ...newAnnotation('ref:5R', 'highlight'), contents: 'Viejo', origin: { kind: 'file', ref: { num: 5, gen: 0 }, popupRef: null } }, { apRef: AP, now: NOW });
    expect(dictGet(same, 'RC')).toBeDefined();
    const changed = updatedDict(original, { ...newAnnotation('ref:5R', 'highlight'), contents: 'Otro', origin: { kind: 'file', ref: { num: 5, gen: 0 }, popupRef: null } }, { apRef: AP, now: NOW });
    expect(dictGet(changed, 'RC')).toBeUndefined();
    expect(dictGet(changed, 'IRT')).toEqual(ref(40));
  });

  it('cambia las claves propias del tipo: DA en texto libre, InkList en dibujos y Name/Open en notas', () => {
    const base = withExtra(build(newAnnotation('ref:6R', 'freetext')));
    const ft = make('freetext', { fontSize: 8, textColor: [0, 1, 0], origin: { kind: 'file', ref: { num: 6, gen: 0 }, popupRef: null } });
    const u = updatedDict(base, ft, { apRef: AP, now: NOW });
    expect(new TextDecoder().decode((dictGet(u, 'DA') as { bytes: Uint8Array }).bytes)).toBe('/Helv 8 Tf 0 1 0 rg');

    const ink = make('ink', { paths: [[0, 0, 9, 9]], width: 3, origin: { kind: 'file', ref: { num: 7, gen: 0 }, popupRef: null } });
    const ui = updatedDict(build(newAnnotation('ref:7R', 'ink')), ink, { apRef: AP, now: NOW });
    expect(dictGet(ui, 'InkList')).toEqual([[0, 0, 9, 9]]);
    expect((dictGet(ui, 'BS') as PdfDict).entries.get('W')).toBe(3);

    const note = make('note', { icon: 'Key', open: true, origin: { kind: 'file', ref: { num: 8, gen: 0 }, popupRef: null } });
    const un = updatedDict(build(newAnnotation('ref:8R', 'note')), note, { apRef: AP, now: NOW });
    expect(nameOf(dictGet(un, 'Name'))).toBe('Key');
    expect(dictGet(un, 'Open')).toBe(true);
  });

  it('sin /Contents previo, un texto nuevo cuenta como cambio y borra /RC', () => {
    const bare: PdfDict = { kind: 'dict', entries: new Map<string, PdfValue>([['RC', name('x')]]) };
    const u = updatedDict(bare, { ...newAnnotation('ref:9R', 'highlight'), contents: 'algo', origin: { kind: 'file', ref: { num: 9, gen: 0 }, popupRef: null } }, { apRef: AP, now: NOW });
    expect(dictGet(u, 'RC')).toBeUndefined();
    expect(str(dictGet(u, 'Contents'))).toBe('algo');
  });

  it('el texto con caracteres fuera de PDFDocEncoding se guarda en UTF-16 y se lee igual', () => {
    const a: Annotation = { ...newAnnotation('ref:10R', 'note'), contents: 'Ñandú 😀', origin: { kind: 'file', ref: { num: 10, gen: 0 }, popupRef: null } };
    const u = updatedDict(build(newAnnotation('ref:10R', 'note')), a, { apRef: AP, now: NOW });
    expect(str(dictGet(u, 'Contents'))).toBe('Ñandú 😀');
  });
});

describe('formas y sellos (PDF-057)', () => {
  const shape = {
    id: 'suite-f',
    pageIndex: 0,
    rect: [10, 20, 110, 70] as const,
    color: [1, 0, 0] as const,
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: NOW,
    created: NOW,
    origin: { kind: 'new' } as const,
  };

  it('/Square con relleno: subtipo, /BS con grosor y trazo continuo, /IC y sin /RD ni /BE', () => {
    const d = build({ ...shape, type: 'square', width: 3, interior: [0, 1, 0] } as Annotation);
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Square');
    const bs = dictGet(d, 'BS');
    expect(bs).toEqual(dict({ W: 3, S: name('S') }));
    expect(dictGet(d, 'IC')).toEqual([0, 1, 0]);
    expect(dictGet(d, 'RD')).toBeUndefined();
    expect(dictGet(d, 'BE')).toBeUndefined();
  });

  it('/Circle sin relleno: no lleva /IC', () => {
    const d = build({ ...shape, type: 'circle', width: 1, interior: null } as Annotation);
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Circle');
    expect(dictGet(d, 'IC')).toBeUndefined();
  });

  it('/Line con flecha: /L en orden inicio→fin, /LE, /IT /LineArrow', () => {
    const d = build({
      ...shape,
      type: 'line',
      points: [10, 20, 110, 70],
      width: 2,
      endings: ['None', 'OpenArrow'],
      interior: null,
    } as Annotation);
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Line');
    expect(dictGet(d, 'L')).toEqual([10, 20, 110, 70]);
    expect(dictGet(d, 'LE')).toEqual([name('None'), name('OpenArrow')]);
    expect(nameOf(dictGet(d, 'IT'))).toBe('LineArrow');
  });

  it('/Line sin puntas: no lleva /IT', () => {
    const d = build({
      ...shape,
      type: 'line',
      points: [10, 20, 110, 70],
      width: 2,
      endings: ['None', 'None'],
      interior: null,
    } as Annotation);
    expect(dictGet(d, 'IT')).toBeUndefined();
  });

  it('/Polygon: /Vertices con los vértices', () => {
    const d = build({ ...shape, type: 'polygon', vertices: [0, 0, 10, 0, 5, 8], width: 1, interior: null } as Annotation);
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Polygon');
    expect(dictGet(d, 'Vertices')).toEqual([0, 0, 10, 0, 5, 8]);
  });

  it('/Stamp: /Name estándar del sello', () => {
    const d = build({ ...shape, type: 'stamp', name: 'Draft' } as Annotation);
    expect(nameOf(dictGet(d, 'Subtype'))).toBe('Stamp');
    expect(nameOf(dictGet(d, 'Name'))).toBe('Draft');
    expect(dictGet(d, 'BS')).toBeUndefined();
  });

  it('updatedDict sobre un /Square con /RD y /IC los quita si el relleno es null', () => {
    const original = dict({
      Type: name('Annot'),
      Subtype: name('Square'),
      RD: [1, 1, 1, 1],
      IC: [0, 1, 0],
      BE: dict({ S: name('C') }),
    });
    const a = { ...shape, type: 'square', width: 2, interior: null } as Annotation;
    const u = updatedDict(original, a, { apRef: AP, now: NOW });
    expect(dictGet(u, 'RD')).toBeUndefined();
    expect(dictGet(u, 'IC')).toBeUndefined();
    expect(dictGet(u, 'BE')).toBeUndefined();
    expect(dictGet(u, 'BS')).toEqual(dict({ W: 2, S: name('S') }));
  });

  it('updatedDict conserva /IC si la forma sigue con relleno', () => {
    const original = dict({ Type: name('Annot'), Subtype: name('Square'), IC: [0, 1, 0] });
    const a = { ...shape, type: 'square', width: 2, interior: [1, 1, 0] } as Annotation;
    expect(dictGet(updatedDict(original, a, { apRef: AP, now: NOW }), 'IC')).toEqual([1, 1, 0]);
  });
});
