import { describe, expect, it } from 'vitest';
import { importPageAnnotations, type ImportedPage, type RawAnnotation } from '../../src/core/annotations/import';
import {
  importWidget,
  isFillable,
  isFieldValue,
  mergeFields,
  valueEquals,
  type FieldValue,
  type FormField,
} from '../../src/core/forms';
import { loadPdf, type LoadedPdf } from '../../src/engine';
import { readPageAnnotations } from '../../src/engine/annotations-import';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;
const FALLBACK = '2026-10-17T12:00:00.000Z';

/** Widget crudo mínimo de tipo texto con todos los datos válidos; `over` lo sobrescribe. */
function widgetRaw(over: Record<string, unknown> = {}): RawAnnotation {
  return {
    id: '9R',
    subtype: 'Widget',
    fieldName: 'nombre',
    fieldType: 'Tx',
    fieldValue: 'Ana',
    rect: [300, 720, 72, 700],
    annotationFlags: 4,
    hidden: false,
    rotation: 0,
    backgroundColor: null,
    borderColor: null,
    defaultAppearanceData: null,
    ...over,
  };
}

function importW(over: Record<string, unknown> = {}, pageIndex = 0): FormField {
  const field = importWidget(widgetRaw(over), pageIndex);
  if (field === null) throw new Error('El widget debería importarse');
  return field;
}

function fieldOf(field: FormField | null): FormField {
  if (field === null) throw new Error('El widget debería importarse');
  return field;
}

async function openFixture(name: string): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
  if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
  return result.value;
}

describe('importWidget · tipos de campo', () => {
  it('un campo de texto con valores por defecto', () => {
    const field = importW();
    expect(field).toEqual({
      name: 'nombre',
      type: 'text',
      readOnly: false,
      required: false,
      multiline: false,
      password: false,
      comb: false,
      maxLen: 0,
      multiSelect: false,
      editable: false,
      options: [],
      align: 0,
      fontSize: 0,
      textColor: [0, 0, 0],
      tooltip: '',
      initial: { kind: 'text', text: 'Ana' },
      widgets: [{
        id: '9R',
        ref: { num: 9, gen: 0 },
        pageIndex: 0,
        rect: [72, 700, 300, 720],
        onState: null,
        rotation: 0,
        background: null,
        border: null,
      }],
    });
  });

  it('lee las banderas, longitud, alineación, apariencia, colores y tooltip de un campo de texto', () => {
    const field = importW({
      fieldName: 'codigo',
      readOnly: true,
      required: true,
      multiLine: true,
      password: true,
      comb: true,
      maxLen: 6,
      textAlignment: 2,
      alternativeText: 'Código',
      defaultAppearanceData: { fontSize: 10, fontColor: [0, 0, 255] },
      backgroundColor: new Uint8ClampedArray([255, 0, 0]),
      borderColor: { 0: 0, 1: 255, 2: 0 },
      rotation: 90,
    });
    expect(field).toMatchObject({
      name: 'codigo',
      readOnly: true,
      required: true,
      multiline: true,
      password: true,
      comb: true,
      maxLen: 6,
      align: 2,
      fontSize: 10,
      textColor: [0, 0, 1],
      tooltip: 'Código',
    });
    expect(field.widgets[0]).toMatchObject({ rotation: 90, background: [1, 0, 0], border: [0, 1, 0] });
  });

  it('un valor de texto que es lista toma su primer elemento; otro tipo queda vacío', () => {
    expect(importW({ fieldValue: ['Primero', 'Segundo'] }).initial).toEqual({ kind: 'text', text: 'Primero' });
    expect(importW({ fieldValue: [3] }).initial).toEqual({ kind: 'text', text: '' });
    expect(importW({ fieldValue: 42 }).initial).toEqual({ kind: 'text', text: '' });
    expect(importW({ fieldValue: undefined }).initial).toEqual({ kind: 'text', text: '' });
  });

  it('una referencia con generación se lee completa y una rotación no válida es 0', () => {
    const field = importW({ id: '12R3', rotation: 45 });
    expect(field.widgets[0]).toMatchObject({ id: '12R3', ref: { num: 12, gen: 3 }, rotation: 0 });
  });

  it('los colores ausentes o no válidos toman su valor por defecto', () => {
    const field = importW({ defaultAppearanceData: { fontColor: 'rojo', fontSize: -4 }, backgroundColor: [1, 2] });
    expect(field.textColor).toEqual([0, 0, 0]);
    expect(field.fontSize).toBe(0);
    expect(field.widgets[0]?.background).toBeNull();
    expect(field.widgets[0]?.border).toBeNull();
    expect(importW({ defaultAppearanceData: 'x', textAlignment: 7 }).align).toBe(0);
  });

  it('una casilla toma su estado activado de exportValue y se marca si el valor coincide', () => {
    const on = importW({ fieldName: 'acepto', fieldType: 'Btn', checkBox: true, exportValue: 'Si', fieldValue: 'Si' });
    expect(on.type).toBe('checkbox');
    expect(on.initial).toEqual({ kind: 'checkbox', checked: true });
    expect(on.widgets[0]?.onState).toBe('Si');
    const off = importW({ fieldType: 'Btn', checkBox: true, exportValue: 'Si', fieldValue: 'Off' });
    expect(off.initial).toEqual({ kind: 'checkbox', checked: false });
    const noExport = importW({ fieldType: 'Btn', checkBox: true, fieldValue: 'Off' });
    expect(noExport.widgets[0]?.onState).toBeNull();
    expect(noExport.initial).toEqual({ kind: 'checkbox', checked: false });
  });

  it('un botón de opción toma buttonValue y selecciona el estado salvo Off, vacío o ausente', () => {
    const chosen = importW({ fieldName: 'color', fieldType: 'Btn', radioButton: true, buttonValue: 'Verde', fieldValue: 'Verde' });
    expect(chosen.type).toBe('radio');
    expect(chosen.widgets[0]?.onState).toBe('Verde');
    expect(chosen.initial).toEqual({ kind: 'radio', selected: 'Verde' });
    expect(importW({ fieldType: 'Btn', radioButton: true, buttonValue: 'Rojo', fieldValue: 'Off' }).initial)
      .toEqual({ kind: 'radio', selected: null });
    expect(importW({ fieldType: 'Btn', radioButton: true, buttonValue: 'Rojo', fieldValue: '' }).initial)
      .toEqual({ kind: 'radio', selected: null });
    expect(importW({ fieldType: 'Btn', radioButton: true, buttonValue: 'Rojo', fieldValue: undefined }).initial)
      .toEqual({ kind: 'radio', selected: null });
    expect(importW({ fieldType: 'Btn', radioButton: true, buttonValue: 'Rojo', fieldValue: ['Rojo'] }).initial)
      .toEqual({ kind: 'radio', selected: null });
  });

  it('un botón de pulsación es de tipo button con valor vacío', () => {
    const field = importW({ fieldName: 'enviar', fieldType: 'Btn', pushButton: true, fieldValue: 'algo' });
    expect(field.type).toBe('button');
    expect(field.initial).toEqual({ kind: 'text', text: '' });
    expect(isFillable(field)).toBe(false);
  });

  it('un botón sin ninguna de sus tres banderas no se importa', () => {
    expect(importWidget(widgetRaw({ fieldType: 'Btn' }), 0)).toBeNull();
  });

  it('un combo con el bit Edit es editable; sus opciones usan displayValue o exportValue', () => {
    const field = importW({
      fieldName: 'pais',
      fieldType: 'Ch',
      combo: true,
      fieldFlags: 262144 | 131072,
      options: [
        { exportValue: 'es', displayValue: 'España' },
        { exportValue: 'fr', displayValue: 1 },
        { exportValue: 'pt' },
        'no es opción',
      ],
      fieldValue: 'es',
    });
    expect(field.type).toBe('combo');
    expect(field.editable).toBe(true);
    expect(field.options).toEqual([
      { exportValue: 'es', displayValue: 'España' },
      { exportValue: 'fr', displayValue: 'fr' },
      { exportValue: 'pt', displayValue: 'pt' },
    ]);
    expect(field.initial).toEqual({ kind: 'choice', selected: ['es'] });
    expect(importW({ fieldType: 'Ch', combo: true, fieldFlags: 0 }).editable).toBe(false);
    expect(importW({ fieldType: 'Ch', combo: true, fieldFlags: 'x' }).editable).toBe(false);
  });

  it('una lista usa multiSelect y su valor como lista; cadena vacía equivale a ninguno', () => {
    const field = importW({
      fieldName: 'idiomas',
      fieldType: 'Ch',
      combo: false,
      multiSelect: true,
      options: null,
      fieldValue: ['Español', 'Inglés'],
    });
    expect(field.type).toBe('list');
    expect(field.multiSelect).toBe(true);
    expect(field.options).toEqual([]);
    expect(field.initial).toEqual({ kind: 'choice', selected: ['Español', 'Inglés'] });
    expect(importW({ fieldType: 'Ch', fieldValue: '' }).initial).toEqual({ kind: 'choice', selected: [] });
    expect(importW({ fieldType: 'Ch', fieldValue: ['ok', 2] }).initial).toEqual({ kind: 'choice', selected: ['ok'] });
    expect(importW({ fieldType: 'Ch', fieldValue: 5 }).initial).toEqual({ kind: 'choice', selected: [] });
    expect(importW({ fieldType: 'Ch', options: 'mal' }).options).toEqual([]);
  });

  it('una firma es de tipo signature, no rellenable', () => {
    const field = importW({ fieldName: 'firma', fieldType: 'Sig', fieldValue: null });
    expect(field.type).toBe('signature');
    expect(field.initial).toEqual({ kind: 'text', text: '' });
    expect(isFillable(field)).toBe(false);
  });

  it('un widget que pdf.js marca como oculto o con la bandera Hidden no se importa', () => {
    expect(importWidget(widgetRaw({ hidden: true }), 0)).toBeNull();
    expect(importWidget(widgetRaw({ annotationFlags: 6 }), 0)).toBeNull();
    expect(importW({ annotationFlags: 'x' }).name).toBe('nombre');
  });
});

describe('importWidget · entradas inválidas', () => {
  it('devuelve null y nunca lanza con seis datos inválidos', () => {
    const invalid: RawAnnotation[] = [
      widgetRaw({ fieldName: undefined }),
      widgetRaw({ fieldType: 'Xx' }),
      widgetRaw({ hidden: true }),
      widgetRaw({ subtype: 'Link' }),
      widgetRaw({ fieldType: 'Btn' }),
      widgetRaw({ rect: [1, 2, 'x', 4] }),
    ];
    expect(invalid).toHaveLength(6);
    for (const raw of invalid) {
      expect(() => importWidget(raw, 0)).not.toThrow();
      expect(importWidget(raw, 0)).toBeNull();
    }
  });

  it('sin id de referencia válido, sin rectángulo o sin nada, devuelve null', () => {
    expect(importWidget(widgetRaw({ id: 'abc' }), 0)).toBeNull();
    expect(importWidget(widgetRaw({ id: 7 }), 0)).toBeNull();
    expect(importWidget(widgetRaw({ id: '0R' }), 0)).toBeNull();
    expect(importWidget(widgetRaw({ rect: undefined }), 0)).toBeNull();
    expect(importWidget(widgetRaw({ fieldName: 5 }), 0)).toBeNull();
    expect(importWidget(undefined as unknown as RawAnnotation, 0)).toBeNull();
  });
});

describe('importPageAnnotations · widgets', () => {
  it('los widgets válidos van a `widgets` y los inválidos se descartan sin afectar al resto', () => {
    const page = importPageAnnotations(3, [
      widgetRaw(),
      widgetRaw({ id: '10R', hidden: true }),
      widgetRaw({ id: '11R', subtype: 'Popup' }),
      { id: '12R', subtype: 'Highlight', rect: [0, 0, 1, 1], quadPoints: [0, 1, 1, 1, 0, 0, 1, 0], color: [255, 255, 0], opacity: 1, annotationFlags: 4, contentsObj: { str: '' }, titleObj: { str: '' } },
    ], FALLBACK);
    expect(page.widgets).toHaveLength(1);
    expect(page.widgets[0]?.widgets[0]?.pageIndex).toBe(3);
    expect(page.supported).toHaveLength(1);
    expect(page.foreign).toEqual([]);
  });
});

describe('mergeFields', () => {
  const nombre1 = importW({}, 0);
  const nombre2 = importW({ id: '20R' }, 1);

  it('sin novedades devuelve el mismo mapa', () => {
    const current = new Map([['nombre', nombre1]]);
    expect(mergeFields(current, [])).toBe(current);
  });

  it('añade campos nuevos y agrupa los widgets del mismo nombre en orden de llegada', () => {
    const other = importW({ fieldName: 'otro', id: '30R' });
    const merged = mergeFields(new Map(), [nombre1, other, nombre2]);
    expect([...merged.keys()]).toEqual(['nombre', 'otro']);
    expect(merged.get('nombre')?.widgets.map((w) => w.id)).toEqual(['9R', '20R']);
    expect(merged.get('nombre')?.widgets.map((w) => w.pageIndex)).toEqual([0, 1]);
  });

  it('no duplica un widget cuyo id ya está y conserva las propiedades del primero', () => {
    const current = new Map([['nombre', nombre1]]);
    const again = importW({ required: true, id: '9R' });
    const merged = mergeFields(current, [again, nombre2]);
    expect(merged.get('nombre')?.widgets.map((w) => w.id)).toEqual(['9R', '20R']);
    expect(merged.get('nombre')?.required).toBe(false);
    expect(current.get('nombre')?.widgets).toHaveLength(1);
  });

  it('un campo nuevo con el mismo nombre pero sin widgets distintos no cambia el resultado', () => {
    const current = new Map([['nombre', nombre1]]);
    const merged = mergeFields(current, [nombre1]);
    expect(merged.get('nombre')).toBe(nombre1);
  });
});

describe('valueEquals', () => {
  const cases: readonly (readonly [FieldValue, FieldValue, boolean])[] = [
    [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'a' }, true],
    [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }, false],
    [{ kind: 'checkbox', checked: true }, { kind: 'checkbox', checked: true }, true],
    [{ kind: 'checkbox', checked: true }, { kind: 'checkbox', checked: false }, false],
    [{ kind: 'radio', selected: null }, { kind: 'radio', selected: null }, true],
    [{ kind: 'radio', selected: null }, { kind: 'radio', selected: 'Rojo' }, false],
    [{ kind: 'choice', selected: ['a', 'b'] }, { kind: 'choice', selected: ['a', 'b'] }, true],
    [{ kind: 'choice', selected: ['a', 'b'] }, { kind: 'choice', selected: ['b', 'a'] }, false],
    [{ kind: 'choice', selected: ['a'] }, { kind: 'choice', selected: ['a', 'a'] }, false],
    [{ kind: 'text', text: '' }, { kind: 'checkbox', checked: false }, false],
    [{ kind: 'choice', selected: [] }, { kind: 'radio', selected: null }, false],
  ];
  it.each(cases)('compara %j con %j → %s', (a, b, expected) => {
    expect(valueEquals(a, b)).toBe(expected);
  });
});

describe('isFieldValue', () => {
  it('acepta cada variante con su forma exacta', () => {
    expect(isFieldValue({ kind: 'text', text: '' })).toBe(true);
    expect(isFieldValue({ kind: 'checkbox', checked: false })).toBe(true);
    expect(isFieldValue({ kind: 'radio', selected: null })).toBe(true);
    expect(isFieldValue({ kind: 'radio', selected: 'Rojo' })).toBe(true);
    expect(isFieldValue({ kind: 'choice', selected: [] })).toBe(true);
    expect(isFieldValue({ kind: 'choice', selected: ['Español'] })).toBe(true);
  });

  it('rechaza valores de otra forma, de tipo incorrecto o con claves de más o de menos', () => {
    expect(isFieldValue({ kind: 'choice', selected: [1] })).toBe(false);
    expect(isFieldValue({ kind: 'text', text: 'a', extra: true })).toBe(false);
    expect(isFieldValue({ kind: 'text' })).toBe(false);
    expect(isFieldValue({ kind: 'text', text: 3 })).toBe(false);
    expect(isFieldValue({ kind: 'checkbox', checked: 'si' })).toBe(false);
    expect(isFieldValue({ kind: 'radio' })).toBe(false);
    expect(isFieldValue({ kind: 'radio', selected: 1 })).toBe(false);
    expect(isFieldValue({ kind: 'choice', selected: 'a' })).toBe(false);
    expect(isFieldValue({ kind: 'signature', text: '' })).toBe(false);
    expect(isFieldValue({ text: 'a' })).toBe(false);
    expect(isFieldValue(null)).toBe(false);
    expect(isFieldValue(undefined)).toBe(false);
    expect(isFieldValue('texto')).toBe(false);
    expect(isFieldValue(['text'])).toBe(false);
  });
});

describe('isFillable', () => {
  it('son rellenables los tipos editables que no son de solo lectura', () => {
    expect(isFillable(importW({}))).toBe(true);
    expect(isFillable(importW({ fieldType: 'Btn', checkBox: true }))).toBe(true);
    expect(isFillable(importW({ fieldType: 'Btn', radioButton: true }))).toBe(true);
    expect(isFillable(importW({ fieldType: 'Ch', combo: true }))).toBe(true);
    expect(isFillable(importW({ fieldType: 'Ch' }))).toBe(true);
    expect(isFillable(importW({ readOnly: true }))).toBe(false);
    expect(isFillable(importW({ fieldType: 'Btn', pushButton: true }))).toBe(false);
  });
});

describe('form-full.pdf', () => {
  it('importa las dos páginas y une los campos en 14 con sus propiedades', async () => {
    const loaded = await openFixture('form-full.pdf');
    try {
      const pages: ImportedPage[] = [];
      for (let n = 1; n <= 2; n++) {
        pages.push(await readPageAnnotations(await loaded.doc.getPage(n), FALLBACK));
      }
      expect(pages.map((p) => p.widgets.length)).toEqual([15, 2]);
      let fields: ReadonlyMap<string, FormField> = new Map();
      for (const page of pages) fields = mergeFields(fields, page.widgets);
      expect(fields.size).toBe(14);
      const f = (name: string): FormField => fieldOf(fields.get(name) ?? null);

      const nombre = f('nombre');
      expect(nombre.widgets.map((w) => w.pageIndex)).toEqual([0, 1]);
      expect(nombre.initial).toEqual({ kind: 'text', text: 'Ana' });

      const color = f('color');
      expect(color.type).toBe('radio');
      expect(color.widgets.map((w) => w.onState)).toEqual(['Rojo', 'Verde', 'Azul']);
      expect(color.initial).toEqual({ kind: 'radio', selected: 'Verde' });

      expect(f('acepto')).toMatchObject({ type: 'checkbox', initial: { kind: 'checkbox', checked: false } });
      expect(f('acepto').widgets[0]?.onState).toBe('Si');

      expect(f('pais')).toMatchObject({ type: 'combo', options: expect.any(Array) });
      expect(f('pais').options).toHaveLength(3);

      expect(f('idiomas')).toMatchObject({
        type: 'list',
        multiSelect: true,
        initial: { kind: 'choice', selected: ['Español', 'Inglés'] },
      });

      const importe = f('importe');
      expect(importe.align).toBe(2);
      expect(importe.fontSize).toBe(0);
      expect(importe.textColor).toEqual([0, 0, 1]);

      expect(f('rotado').widgets[0]?.rotation).toBe(90);
      expect(isFillable(f('solo_lectura'))).toBe(false);
      expect(f('firma').type).toBe('signature');
      expect(f('obligatorio').tooltip).toBe('Campo obligatorio');
      expect(f('codigo')).toMatchObject({ comb: true, maxLen: 6 });
      expect(f('comentarios').multiline).toBe(true);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('annotated.pdf no tiene widgets', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      for (let n = 1; n <= loaded.doc.numPages; n++) {
        expect((await readPageAnnotations(await loaded.doc.getPage(n), FALLBACK)).widgets).toEqual([]);
      }
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});
