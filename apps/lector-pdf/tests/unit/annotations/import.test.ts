import { describe, expect, it } from 'vitest';
import { importPageAnnotations, type RawAnnotation } from '../../../src/core/annotations/import';

const FALLBACK = '2026-10-17T12:00:00.000Z';
const IMPORT_DATE = '2026-01-02T03:04:05.000Z';

/** Anotación cruda mínima de tipo Highlight con todos los campos válidos; `over` la sobrescribe. */
function raw(over: Record<string, unknown> = {}): RawAnnotation {
  return {
    id: '9R',
    subtype: 'Highlight',
    rect: [300, 720, 72, 700],
    quadPoints: new Float32Array([72, 720, 300, 720, 72, 700, 300, 700]),
    color: new Uint8ClampedArray([255, 255, 0]),
    opacity: 1,
    contentsObj: { str: 'Comentario previo', dir: 'ltr' },
    titleObj: { str: 'Otra persona', dir: 'ltr' },
    modificationDate: 'D:20261017120000Z',
    creationDate: "D:20261016100000+02'00'",
    popupRef: '11R',
    annotationFlags: 4,
    ...over,
  };
}

function importOne(item: RawAnnotation, pageIndex = 0) {
  return importPageAnnotations(pageIndex, [item], FALLBACK);
}

describe('importPageAnnotations · anotaciones de marcado de texto', () => {
  it('convierte un Highlight completo al modelo con origen de fichero', () => {
    const page = importOne(raw());
    expect(page.foreign).toEqual([]);
    expect(page.supported).toEqual([
      {
        id: 'ref:9R',
        pageIndex: 0,
        type: 'highlight',
        rect: [72, 700, 300, 720],
        quads: [[72, 720, 300, 720, 72, 700, 300, 700]],
        color: [1, 1, 0],
        opacity: 1,
        contents: 'Comentario previo',
        author: 'Otra persona',
        modified: '2026-10-17T12:00:00.000Z',
        created: '2026-10-16T08:00:00.000Z',
        origin: { kind: 'file', ref: { num: 9, gen: 0 }, popupRef: { num: 11, gen: 0 } },
      },
    ]);
  });

  it('normaliza el rectángulo y usa el rectángulo como quad si no hay quadPoints', () => {
    const page = importOne(raw({ quadPoints: undefined, rect: [100, 40, 10, 20] }));
    const [annotation] = page.supported;
    expect(annotation).toMatchObject({ rect: [10, 20, 100, 40], quads: [[10, 40, 100, 40, 10, 20, 100, 20]] });
  });

  it('trata quadPoints vacío como ausente', () => {
    const page = importOne(raw({ quadPoints: new Float32Array(0), rect: [0, 0, 10, 5] }));
    expect(page.supported[0]).toMatchObject({ quads: [[0, 5, 10, 5, 0, 0, 10, 0]] });
  });

  it('importa varios cuadriláteros en orden', () => {
    const quadPoints = new Float32Array([0, 10, 10, 10, 0, 0, 10, 0, 20, 30, 30, 30, 20, 20, 30, 20]);
    const page = importOne(raw({ quadPoints, rect: [0, 0, 30, 30] }));
    expect(page.supported[0]).toMatchObject({ quads: [[0, 10, 10, 10, 0, 0, 10, 0], [20, 30, 30, 30, 20, 20, 30, 20]] });
  });

  it('un Highlight con quadPoints de 7 números queda como ajena y no lanza', () => {
    const page = importOne(raw({ quadPoints: new Float32Array([1, 2, 3, 4, 5, 6, 7]) }));
    expect(page.supported).toEqual([]);
    expect(page.foreign).toEqual([
      {
        id: 'ref:9R',
        pageIndex: 0,
        subtype: 'Highlight',
        rect: [72, 700, 300, 720],
        contents: 'Comentario previo',
        author: 'Otra persona',
        modified: '2026-10-17T12:00:00.000Z',
      },
    ]);
  });

  it('un Highlight con color de tipo cadena queda como ajena', () => {
    const page = importOne(raw({ color: 'yellow' }));
    expect(page.supported).toEqual([]);
    expect(page.foreign).toHaveLength(1);
  });

  it('usa amarillo como color por defecto del resaltado y negro para el subrayado', () => {
    const highlight = importOne(raw({ color: null })).supported[0];
    const underline = importOne(raw({ subtype: 'Underline', color: null })).supported[0];
    expect(highlight).toMatchObject({ type: 'highlight', color: [1, 0.92, 0.23] });
    expect(underline).toMatchObject({ type: 'underline', color: [0, 0, 0] });
  });

  it('convierte el subrayado azul y el tachado', () => {
    const underline = importOne(raw({ subtype: 'Underline', color: [0, 0, 255] })).supported[0];
    const strike = importOne(raw({ subtype: 'StrikeOut', color: [0, 0, 0] })).supported[0];
    expect(underline).toMatchObject({ type: 'underline', color: [0, 0, 1] });
    expect(strike).toMatchObject({ type: 'strikeout' });
  });

  it('una lista de color con tamaño distinto de 3 queda como ajena', () => {
    expect(importOne(raw({ color: [1, 0] })).foreign).toHaveLength(1);
  });

  it('acota los componentes de color fuera de 0-255', () => {
    const [annotation] = importOne(raw({ color: [300, -5, 127.5] })).supported;
    expect(annotation).toMatchObject({ color: [1, 0, 0.5] });
  });
});

describe('importPageAnnotations · notas, texto libre y tinta', () => {
  it('convierte una nota con icono y estado abierto', () => {
    const page = importOne(raw({ subtype: 'Text', name: 'Comment', open: true, contentsObj: { str: 'Nota previa' } }));
    expect(page.supported[0]).toMatchObject({ type: 'note', icon: 'Comment', open: true, contents: 'Nota previa' });
  });

  it('usa el icono Note si el nombre no es válido o falta, y open solo es true si es booleano true', () => {
    const invalid = importOne(raw({ subtype: 'Text', name: 'Estrella', open: 'sí' })).supported[0];
    const missing = importOne(raw({ subtype: 'Text', name: undefined, color: null })).supported[0];
    expect(invalid).toMatchObject({ icon: 'Note', open: false });
    expect(missing).toMatchObject({ icon: 'Note', open: false, color: [0, 0, 0] });
  });

  it('convierte texto libre con tamaño y color de la apariencia por defecto', () => {
    const page = importOne(raw({
      subtype: 'FreeText',
      contentsObj: { str: 'Texto libre previo' },
      defaultAppearanceData: { fontSize: 14, fontName: 'Helv', fontColor: [255, 0, 0] },
    }));
    expect(page.supported[0]).toMatchObject({ type: 'freetext', fontSize: 14, textColor: [1, 0, 0], contents: 'Texto libre previo' });
  });

  it('el texto libre sin contenido toma las líneas de textContent', () => {
    const page = importOne(raw({
      subtype: 'FreeText',
      contentsObj: { str: '' },
      textContent: ['primera', 'segunda'],
    }));
    expect(page.supported[0]).toMatchObject({ contents: 'primera\nsegunda', fontSize: 12, textColor: [0, 0, 0] });
  });

  it('el texto libre sin apariencia usa 12 pt y negro', () => {
    const page = importOne(raw({ subtype: 'FreeText', defaultAppearanceData: null }));
    expect(page.supported[0]).toMatchObject({ fontSize: 12, textColor: [0, 0, 0] });
  });

  it('un tamaño de fuente no positivo usa 12 pt', () => {
    const page = importOne(raw({ subtype: 'FreeText', defaultAppearanceData: { fontSize: 0, fontColor: null } }));
    expect(page.supported[0]).toMatchObject({ fontSize: 12 });
  });

  it('un texto libre con textContent que no es lista de cadenas queda como ajena', () => {
    expect(importOne(raw({ subtype: 'FreeText', textContent: [1, 2] })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'FreeText', textContent: 'hola' })).foreign).toHaveLength(1);
  });

  it('un texto libre con defaultAppearanceData que no es objeto o con fontSize no numérico queda como ajena', () => {
    expect(importOne(raw({ subtype: 'FreeText', defaultAppearanceData: 'Helv 12' })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'FreeText', defaultAppearanceData: { fontSize: '12' } })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'FreeText', defaultAppearanceData: { fontColor: 'rojo' } })).foreign).toHaveLength(1);
  });

  it('convierte tinta con sus trazos y el grosor del borde', () => {
    const page = importOne(raw({
      subtype: 'Ink',
      inkLists: [new Float32Array([72, 310, 120, 390, 160, 320]), [150, 350, 200, 400]],
      borderStyle: { width: 2 },
      color: [255, 0, 0],
    }));
    expect(page.supported[0]).toMatchObject({
      type: 'ink',
      paths: [[72, 310, 120, 390, 160, 320], [150, 350, 200, 400]],
      width: 2,
      color: [1, 0, 0],
    });
  });

  it('la tinta sin grosor declarado o con grosor no positivo usa 1', () => {
    const none = importOne(raw({ subtype: 'Ink', inkLists: [[0, 0, 1, 1]] })).supported[0];
    const zero = importOne(raw({ subtype: 'Ink', inkLists: [[0, 0, 1, 1]], borderStyle: { width: 0 } })).supported[0];
    expect(none).toMatchObject({ width: 1 });
    expect(zero).toMatchObject({ width: 1 });
  });

  it('la tinta sin trazos, con un trazo impar o con borderStyle no válido queda como ajena', () => {
    expect(importOne(raw({ subtype: 'Ink' })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'Ink', inkLists: [] })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'Ink', inkLists: [[1, 2, 3]] })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'Ink', inkLists: [[1]] })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'Ink', inkLists: 'trazo' })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'Ink', inkLists: [[0, 0]], borderStyle: 'fino' })).foreign).toHaveLength(1);
    expect(importOne(raw({ subtype: 'Ink', inkLists: [[0, 0]], borderStyle: { width: 'dos' } })).foreign).toHaveLength(1);
  });
});

describe('importPageAnnotations · campos comunes', () => {
  it('la opacidad por defecto es 1 y se acota a 0..1', () => {
    expect(importOne(raw({ opacity: undefined })).supported[0]).toMatchObject({ opacity: 1 });
    expect(importOne(raw({ opacity: 0.5 })).supported[0]).toMatchObject({ opacity: 0.5 });
    expect(importOne(raw({ opacity: 3 })).supported[0]).toMatchObject({ opacity: 1 });
    expect(importOne(raw({ opacity: -1 })).supported[0]).toMatchObject({ opacity: 0 });
  });

  it('una opacidad que no es número queda como ajena', () => {
    expect(importOne(raw({ opacity: '0.5' })).foreign).toHaveLength(1);
    expect(importOne(raw({ opacity: Number.NaN })).foreign).toHaveLength(1);
  });

  it('sin comentario ni autor usa cadenas vacías; sin fechas usa la de respaldo y created nulo', () => {
    const [annotation] = importOne(raw({
      contentsObj: undefined,
      titleObj: null,
      modificationDate: undefined,
      creationDate: null,
    })).supported;
    expect(annotation).toMatchObject({ contents: '', author: '', modified: FALLBACK, created: null });
  });

  it('una fecha de modificación no válida usa la de respaldo', () => {
    const [annotation] = importOne(raw({ modificationDate: 'D:20261340000000Z' })).supported;
    expect(annotation).toMatchObject({ modified: FALLBACK });
  });

  it('una fecha que no es cadena queda como ajena', () => {
    expect(importOne(raw({ modificationDate: 20261017 })).foreign).toHaveLength(1);
    expect(importOne(raw({ creationDate: 20261017 })).foreign).toHaveLength(1);
  });

  it('un contentsObj o titleObj que no son objetos quedan como ajena', () => {
    expect(importOne(raw({ contentsObj: 'texto' })).foreign).toHaveLength(1);
    expect(importOne(raw({ titleObj: ['autor'] })).foreign).toHaveLength(1);
    expect(importOne(raw({ contentsObj: { str: 7 } })).foreign).toHaveLength(1);
  });

  it('un rectángulo que no tiene 4 números queda como ajena con rectángulo nulo', () => {
    const page = importOne(raw({ rect: [1, 2, 3] }));
    expect(page.supported).toEqual([]);
    expect(page.foreign[0]).toMatchObject({ rect: [0, 0, 0, 0] });
  });

  it('popupRef sin valor es nulo; una referencia mal formada o de otro tipo queda como ajena', () => {
    expect(importOne(raw({ popupRef: null })).supported[0]).toMatchObject({ origin: { popupRef: null } });
    expect(importOne(raw({ popupRef: undefined })).supported[0]).toMatchObject({ origin: { popupRef: null } });
    expect(importOne(raw({ popupRef: 'abc' })).foreign).toHaveLength(1);
    expect(importOne(raw({ popupRef: 11 })).foreign).toHaveLength(1);
  });

  it('la referencia con generación se interpreta como num y gen', () => {
    const [annotation] = importOne(raw({ id: '12R3' })).supported;
    expect(annotation).toMatchObject({ id: 'ref:12R3', origin: { kind: 'file', ref: { num: 12, gen: 3 } } });
  });

  it('un id que no es referencia válida queda como ajena con su id', () => {
    const page = importOne(raw({ id: '0R' }));
    expect(page.supported).toEqual([]);
    expect(page.foreign[0]).toMatchObject({ id: 'ref:0R' });
  });

  it('un id que no es cadena queda como ajena con un id provisional por página e índice', () => {
    const page = importPageAnnotations(4, [raw({ id: undefined, subtype: 'Square' })], FALLBACK);
    expect(page.foreign[0]).toMatchObject({ id: 'ref:?4.0', pageIndex: 4 });
  });

  it('el id provisional usa el índice de la anotación dentro de la página', () => {
    const page = importPageAnnotations(0, [raw({ subtype: 'Square' }), raw({ id: 7, subtype: 'Square' })], FALLBACK);
    expect(page.foreign.map((f) => f.id)).toEqual(['ref:9R', 'ref:?0.1']);
  });

  it('una anotación sin subtipo de texto queda como ajena con subtipo Unknown', () => {
    const page = importOne(raw({ subtype: 42 }));
    expect(page.foreign[0]).toMatchObject({ subtype: 'Unknown' });
  });
});

describe('importPageAnnotations · filtrado', () => {
  it('ignora Popup, Link y Widget', () => {
    const page = importPageAnnotations(0, [
      raw({ id: '10R', subtype: 'Popup' }),
      raw({ id: '11R', subtype: 'Link' }),
      raw({ id: '12R', subtype: 'Widget' }),
    ], FALLBACK);
    expect(page).toEqual({ supported: [], foreign: [], widgets: [] });
  });

  it('ignora las anotaciones ocultas, con la bandera Hidden (bit 2)', () => {
    expect(importOne(raw({ annotationFlags: 2 }))).toEqual({ supported: [], foreign: [], widgets: [] });
    expect(importOne(raw({ subtype: 'Square', annotationFlags: 3 }))).toEqual({ supported: [], foreign: [], widgets: [] });
  });

  it('una bandera que no es número queda como ajena', () => {
    const page = importOne(raw({ annotationFlags: '2' }));
    expect(page.supported).toEqual([]);
    expect(page.foreign).toHaveLength(1);
  });

  it('una bandera ausente equivale a 0 y no oculta la anotación', () => {
    expect(importOne(raw({ annotationFlags: undefined })).supported).toHaveLength(1);
  });

  it('ignora los elementos que no son objetos', () => {
    const page = importPageAnnotations(0, [null, 'texto', [1], raw()] as unknown as RawAnnotation[], FALLBACK);
    expect(page.supported).toHaveLength(1);
    expect(page.foreign).toEqual([]);
  });

  it('una anotación de tipo no soportado pasa a ajena con sus datos visibles', () => {
    const page = importOne(raw({
      id: '20R',
      subtype: 'Square',
      rect: [72, 600, 200, 700],
      contentsObj: { str: 'Recuadro' },
      titleObj: { str: 'Otra persona' },
      modificationDate: 'D:20261017120000Z',
    }));
    expect(page).toEqual({
      supported: [],
      widgets: [],
      foreign: [{
        id: 'ref:20R',
        pageIndex: 0,
        subtype: 'Square',
        rect: [72, 600, 200, 700],
        contents: 'Recuadro',
        author: 'Otra persona',
        modified: '2026-10-17T12:00:00.000Z',
      }],
    });
  });

  it('una ajena sin datos usa cadenas vacías y fecha nula', () => {
    const page = importPageAnnotations(2, [{ id: '5R', subtype: 'Stamp' }], FALLBACK);
    expect(page.foreign).toEqual([{
      id: 'ref:5R',
      pageIndex: 2,
      subtype: 'Stamp',
      rect: [0, 0, 0, 0],
      contents: '',
      author: '',
      modified: null,
    }]);
  });

  it('una ajena con contentsObj o titleObj de tipo incorrecto usa cadenas vacías', () => {
    const page = importOne(raw({ subtype: 'Square', contentsObj: 9, titleObj: 9, modificationDate: 9 }));
    expect(page.foreign[0]).toMatchObject({ contents: '', author: '', modified: null });
  });

  it('conserva el orden de las anotaciones de la página', () => {
    const page = importPageAnnotations(0, [
      raw({ id: '1R', subtype: 'Square' }),
      raw({ id: '2R' }),
      raw({ id: '3R', subtype: 'Ink', inkLists: [[0, 0, 1, 1]] }),
      raw({ id: '4R', subtype: 'Circle' }),
    ], FALLBACK);
    expect(page.supported.map((a) => a.id)).toEqual(['ref:2R', 'ref:3R']);
    expect(page.foreign.map((f) => f.id)).toEqual(['ref:1R', 'ref:4R']);
  });

  it('una lista vacía no produce nada', () => {
    expect(importPageAnnotations(0, [], FALLBACK)).toEqual({ supported: [], foreign: [], widgets: [] });
  });

  it('usa la fecha de importación solo como respaldo de modified', () => {
    const page = importPageAnnotations(0, [raw({ modificationDate: undefined })], IMPORT_DATE);
    expect(page.supported[0]).toMatchObject({ modified: IMPORT_DATE });
  });
});
