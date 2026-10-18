import { describe, expect, it } from 'vitest';
import { EMPTY_EDITS, type AnnotationEdits } from '../../src/core/annotations';
import {
  diffFields,
  effectiveValue,
  mergeFields,
  storageValue,
  type FieldValue,
  type FormField,
  type FormWidget,
} from '../../src/core/forms';
import { loadPdf, readPageAnnotations } from '../../src/engine';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;
const FALLBACK = '2026-10-17T12:00:00.000Z';

function widgetOf(over: Partial<FormWidget> = {}): FormWidget {
  return {
    id: '9R',
    ref: { num: 9, gen: 0 },
    pageIndex: 0,
    rect: [72, 700, 300, 720],
    onState: null,
    rotation: 0,
    background: null,
    border: null,
    ...over,
  };
}

function fieldOf(over: Partial<FormField> & Pick<FormField, 'name' | 'type' | 'initial'>): FormField {
  return {
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
    widgets: [widgetOf()],
    ...over,
  };
}

const NOMBRE = fieldOf({ name: 'nombre', type: 'text', initial: { kind: 'text', text: 'Ana' } });
const SOLO_LECTURA = fieldOf({
  name: 'solo_lectura',
  type: 'text',
  readOnly: true,
  initial: { kind: 'text', text: 'No editable' },
});
const FIELDS: ReadonlyMap<string, FormField> = new Map([
  [NOMBRE.name, NOMBRE],
  [SOLO_LECTURA.name, SOLO_LECTURA],
]);

function editsWith(entries: readonly (readonly [string, FieldValue])[]): AnnotationEdits {
  return { ...EMPTY_EDITS, fields: new Map(entries) };
}

describe('effectiveValue', () => {
  it('devuelve el valor cambiado por el usuario o, si no hay, el del fichero', () => {
    expect(effectiveValue(NOMBRE, EMPTY_EDITS)).toEqual(NOMBRE.initial);
    const changed: FieldValue = { kind: 'text', text: 'Luis' };
    expect(effectiveValue(NOMBRE, editsWith([['nombre', changed]]))).toEqual(changed);
  });
});

describe('diffFields', () => {
  it('incluye un campo rellenable cuyo valor cambia', () => {
    const changed: FieldValue = { kind: 'text', text: 'Luis' };
    const diff = diffFields(FIELDS, editsWith([['nombre', changed]]));
    expect(diff).toEqual([{ field: NOMBRE, value: changed }]);
  });

  it('no devuelve un campo vuelto a su valor del fichero, aunque se haya escrito explícitamente', () => {
    expect(diffFields(FIELDS, editsWith([['nombre', { kind: 'text', text: 'Ana' }]]))).toEqual([]);
  });

  it('ignora un campo de solo lectura aunque tenga un valor distinto', () => {
    expect(diffFields(FIELDS, editsWith([['solo_lectura', { kind: 'text', text: 'Otro' }]]))).toEqual([]);
  });

  it('ignora nombres que no están en el mapa de campos', () => {
    expect(diffFields(FIELDS, editsWith([['desconocido', { kind: 'text', text: 'x' }]]))).toEqual([]);
  });

  it('sigue el orden de los campos, no el de las ediciones', () => {
    const otherFields = new Map<string, FormField>([
      [NOMBRE.name, NOMBRE],
      ['apellido', fieldOf({ name: 'apellido', type: 'text', initial: { kind: 'text', text: '' } })],
    ]);
    const edits = editsWith([
      ['apellido', { kind: 'text', text: 'Pérez' }],
      ['nombre', { kind: 'text', text: 'Luis' }],
    ]);
    expect(diffFields(otherFields, edits).map((c) => c.field.name)).toEqual(['nombre', 'apellido']);
  });

  it('un campo sin cambios no aparece', () => {
    expect(diffFields(FIELDS, EMPTY_EDITS)).toEqual([]);
  });
});

describe('storageValue', () => {
  it('texto, casilla, lista y combo', () => {
    const text = fieldOf({ name: 't', type: 'text', initial: { kind: 'text', text: '' } });
    expect(storageValue(text, widgetOf(), { kind: 'text', text: 'Luis' })).toBe('Luis');

    const box = fieldOf({ name: 'acepto', type: 'checkbox', initial: { kind: 'checkbox', checked: false } });
    expect(storageValue(box, widgetOf({ onState: 'Si' }), { kind: 'checkbox', checked: true })).toBe(true);

    const list = fieldOf({ name: 'idiomas', type: 'list', initial: { kind: 'choice', selected: [] } });
    expect(storageValue(list, widgetOf(), { kind: 'choice', selected: ['Español', 'Inglés'] })).toEqual([
      'Español',
      'Inglés',
    ]);

    const combo = fieldOf({ name: 'pais', type: 'combo', initial: { kind: 'choice', selected: [] } });
    expect(storageValue(combo, widgetOf(), { kind: 'choice', selected: ['España'] })).toBe('España');
    expect(storageValue(combo, widgetOf(), { kind: 'choice', selected: [] })).toBe('');
  });

  it('una opción de grupo se marca solo si es la elegida', () => {
    const radio = fieldOf({ name: 'color', type: 'radio', initial: { kind: 'radio', selected: null } });
    const value: FieldValue = { kind: 'radio', selected: 'Azul' };
    const states = ['Rojo', 'Verde', 'Azul'].map((onState) => storageValue(radio, widgetOf({ onState }), value));
    expect(states).toEqual([false, false, true]);
  });

  it('una opción sin estado de exportación nunca se marca', () => {
    const radio = fieldOf({ name: 'color', type: 'radio', initial: { kind: 'radio', selected: null } });
    expect(storageValue(radio, widgetOf({ onState: null }), { kind: 'radio', selected: null })).toBe(false);
  });

  it('en form-full.pdf, color con «Azul» da false, false, true en sus tres widgets', async () => {
    const loaded = await loadPdf(fixtureSource('form-full.pdf'), { assetBaseUrl });
    if (!loaded.ok) throw new Error(`No se pudo abrir form-full.pdf: ${loaded.error.code}`);
    try {
      let fields: ReadonlyMap<string, FormField> = new Map();
      for (let n = 1; n <= 2; n++) {
        const page = await readPageAnnotations(await loaded.value.doc.getPage(n), FALLBACK);
        fields = mergeFields(fields, page.widgets);
      }
      const color = fields.get('color');
      if (color === undefined) throw new Error('El campo color debería existir');
      const value: FieldValue = { kind: 'radio', selected: 'Azul' };
      expect(color.widgets.map((w) => storageValue(color, w, value))).toEqual([false, false, true]);
    } finally {
      await loaded.value.destroy();
    }
  }, OPEN_TIMEOUT);
});
