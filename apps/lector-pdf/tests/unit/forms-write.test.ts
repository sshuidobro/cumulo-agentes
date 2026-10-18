import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { pdfText } from '../../src/core/annotations/appearance';
import type { AnnotationDiff } from '../../src/core/annotations/diff';
import { EMPTY_EDITS } from '../../src/core/annotations/model';
import {
  diffFields,
  planFieldWrites,
  valueEquals,
  type FieldChange,
  type FormField,
} from '../../src/core/forms';
import { decodeStreamData } from '../../src/core/pdf/filters';
import { ObjectReader } from '../../src/core/pdf/object-reader';
import { dictGet, PdfSyntaxError, ref, type PdfDict, type PdfRef, type PdfValue } from '../../src/core/pdf/objects';
import { loadPdf } from '../../src/engine';
import { FIXTURES_DIR } from '../fixtures/paths';
import { nodeAssetBase } from '../helpers/pdfjs-node';
import { changesFor, FORM_FULL_VALUES, readFormFields, saveFormChanges } from '../support/form-fields';
import { qpdfCheck, qpdfObjects, type QpdfObjects } from '../support/qpdf';
import { additionsDiff } from '../support/save-annotations';
import { standardAnnotations } from '../support/standard-annotations';

const ORIGINAL = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'form-full.pdf')));
const CHANGES = FORM_FULL_VALUES;
/** Nombres de los campos de `CHANGES`. */
const CHANGES_NAMES = Object.keys(CHANGES);
const assetBaseUrl = nodeAssetBase();

/** Guarda sobre form-full.pdf original. */
const save = (changes: readonly FieldChange[], diff?: AnnotationDiff): ReturnType<typeof saveFormChanges> =>
  saveFormChanges(ORIGINAL, changes, diff);

/** Escribe `bytes` en un directorio temporal y lo valida con qpdf (código 0 = sin errores ni avisos). Devuelve la ruta. */
function checkWithQpdf(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'forms-write-'));
  const path = join(dir, 'salida.pdf');
  writeFileSync(path, bytes);
  const result = qpdfCheck(path);
  expect(result.code, result.output).toBe(0);
  return path;
}

/** Diccionario de un objeto según `qpdf --json=2` (claves con barra). */
function dictOf(objects: QpdfObjects, num: number): Record<string, unknown> {
  const value = (objects[`obj:${num} 0 R`] as { readonly value?: unknown } | undefined)?.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`sin diccionario: ${num}`);
  return value as Record<string, unknown>;
}

/** Números de objeto que aparecen como `N G obj` en el incremento. */
function objectNumbersIn(delta: Uint8Array): number[] {
  const text = new TextDecoder('latin1').decode(delta);
  return [...text.matchAll(/(?:^|\s)(\d+) \d+ obj\b/g)].map((m) => Number(m[1]));
}

function fieldNamed(fields: ReadonlyMap<string, FormField>, name: string): FormField {
  const field = fields.get(name);
  if (field === undefined) throw new Error(`falta el campo ${name}`);
  return field;
}

function widgetNums(fields: ReadonlyMap<string, FormField>, name: string): number[] {
  return fieldNamed(fields, name).widgets.map((w) => w.ref.num);
}

function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

/** Número del `/Parent` de un objeto, o `undefined` si no tiene. */
async function parentNumOf(reader: ObjectReader, num: number): Promise<number | undefined> {
  const dict = await reader.getDict(ref(num));
  const parent = dict === null ? undefined : dictGet(dict, 'Parent');
  return isRef(parent) ? parent.num : undefined;
}

/** Entrada `/N` (diccionario de apariencias) de un diccionario de widget, si existe. */
function normalEntry(widget: PdfDict): PdfValue | undefined {
  const ap = dictGet(widget, 'AP');
  return isDict(ap) ? ap.entries.get('N') : undefined;
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

describe('planFieldWrites · casos sueltos', () => {
  it('campos no rellenables o de solo lectura no producen objetos', async () => {
    const fields = await readFormFields(ORIGINAL);
    const reader = await ObjectReader.open(memorySource(ORIGINAL));
    const base = fieldNamed(fields, 'nombre');
    const writes = await planFieldWrites(
      reader,
      [
        { field: { ...base, readOnly: true }, value: { kind: 'text', text: 'X' } },
        { field: { ...base, type: 'button' }, value: { kind: 'text', text: 'X' } },
      ],
      () => ref(reader.xref.size),
    );
    expect(writes).toEqual([]);
  });

  it('un widget que no se puede leer lanza PdfSyntaxError', async () => {
    const fields = await readFormFields(ORIGINAL);
    const reader = await ObjectReader.open(memorySource(ORIGINAL));
    const field = fieldNamed(fields, 'nombre');
    const first = field.widgets[0];
    if (first === undefined) throw new Error('sin widgets');
    const broken = { ...field, widgets: [{ ...first, ref: { num: 999_999, gen: 0 } }] };
    await expect(
      planFieldWrites(reader, [{ field: broken, value: { kind: 'text', text: 'X' } }], () => ref(reader.xref.size)),
    ).rejects.toBeInstanceOf(PdfSyntaxError);
  });

  it('un valor de otro tipo que el del campo lanza PdfSyntaxError', async () => {
    const fields = await readFormFields(ORIGINAL);
    const reader = await ObjectReader.open(memorySource(ORIGINAL));
    const change = { field: fieldNamed(fields, 'nombre'), value: { kind: 'checkbox', checked: true } as const };
    await expect(planFieldWrites(reader, [change], () => ref(reader.xref.size))).rejects.toBeInstanceOf(PdfSyntaxError);
  });
});

describe('forms-write · núcleo con form-full.pdf', () => {
  it('sin cambios de campos ni de anotaciones el incremento está vacío', async () => {
    const { delta } = await save([]);
    expect(delta.length).toBe(0);
  });

  it('pdf.js abre original + incremento con los valores nuevos y apariencia en los 17 widgets', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { data } = await save(changesFor(fields, CHANGES));
    checkWithQpdf(data);

    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    if (!loaded.ok) throw new Error(loaded.error.code);
    try {
      const pages = [await loaded.value.doc.getPage(1), await loaded.value.doc.getPage(2)];
      const widgets = (await Promise.all(pages.map((p) => p.getAnnotations({ intent: 'display' }))))
        .flat()
        .filter((a) => a.subtype === 'Widget');
      const byName = (name: string) => widgets.filter((a) => a.fieldName === name);

      expect(widgets).toHaveLength(17);
      expect(byName('nombre').map((a) => a.fieldValue)).toEqual(['María José', 'María José']);
      expect(byName('acepto')[0]?.fieldValue).toBe('Si');
      expect(byName('color').map((a) => a.fieldValue)).toEqual(['Azul', 'Azul', 'Azul']);
      expect(byName('idiomas')[0]?.fieldValue).toEqual(['Francés', 'Alemán']);
      expect(byName('persona.apellido')[0]?.fieldValue).toBe('Núñez');
      expect(byName('rotado')[0]?.fieldValue).toBe('Hola');
      for (const widget of widgets) expect(widget.hasAppearance, widget.fieldName).toBe(true);
    } finally {
      await loaded.value.destroy();
    }
  });

  it('qpdf: el widget Rojo queda en /Off, el Azul en /Azul e idiomas con /I [2 3]', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { data } = await save(changesFor(fields, CHANGES));
    const objects = qpdfObjects(checkWithQpdf(data));

    const [rojo, verde, azul] = fieldNamed(fields, 'color').widgets.map((w) => dictOf(objects, w.ref.num));
    expect(rojo?.['/AS']).toBe('/Off');
    expect(verde?.['/AS']).toBe('/Off');
    expect(azul?.['/AS']).toBe('/Azul');

    const idiomas = dictOf(objects, widgetNums(fields, 'idiomas')[0] ?? -1);
    expect(idiomas['/I']).toEqual([2, 3]);
  });

  it('persona.apellido (campo y widget fusionados) aparece una sola vez; los campos no tocados no están en el incremento', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { delta } = await save(changesFor(fields, CHANGES));
    const written = objectNumbersIn(delta);

    const [apellido] = widgetNums(fields, 'persona.apellido');
    expect(written.filter((n) => n === apellido)).toHaveLength(1);

    for (const untouched of ['comentarios', 'codigo', 'importe', 'obligatorio', 'firma']) {
      for (const num of widgetNums(fields, untouched)) expect(written).not.toContain(num);
    }
  });

  it('no reescribe el catálogo y solo escribe widgets/campos cambiados, padres de campo y apariencias nuevas', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { delta } = await save(changesFor(fields, CHANGES));
    const reader = await ObjectReader.open(memorySource(ORIGINAL));
    const root = dictGet(reader.xref.trailer, 'Root');
    if (!isRef(root)) throw new Error('sin /Root');
    const written = objectNumbersIn(delta);
    expect(written).not.toContain(root.num);

    const allowed = new Set<number>();
    for (const name of CHANGES_NAMES) {
      for (const num of widgetNums(fields, name)) {
        allowed.add(num);
        const parent = await parentNumOf(reader, num);
        if (parent !== undefined) allowed.add(parent);
      }
    }
    const appearances = written.filter((n) => n >= reader.xref.size);
    for (const num of written) {
      expect(allowed.has(num) || appearances.includes(num), `objeto ${num} inesperado`).toBe(true);
    }
  });

  it('el delta de los 7 campos ocupa menos de 20 KB', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { delta } = await save(changesFor(fields, CHANGES));
    expect(delta.length).toBeLessThan(20 * 1024);
  });

  it('ida y vuelta: al reimportar el resultado, initial de cada campo es el valor guardado', async () => {
    const fields = await readFormFields(ORIGINAL);
    const changes = changesFor(fields, CHANGES);
    const { data } = await save(changes);
    const reimported = await readFormFields(data);
    for (const change of changes) {
      expect(valueEquals(fieldNamed(reimported, change.field.name).initial, change.value), change.field.name).toBe(true);
    }
    expect(diffFields(reimported, EMPTY_EDITS)).toEqual([]);
  });

  it('el widget nombre de la página 2 tiene una apariencia nueva con «María José»', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { data } = await save(changesFor(fields, CHANGES));
    const reader = await ObjectReader.open(memorySource(data));
    const [, second] = fieldNamed(fields, 'nombre').widgets;
    if (second === undefined) throw new Error('falta el widget de la página 2');
    const widget = await reader.getDict(ref(second.ref.num, second.ref.gen));
    if (widget === null) throw new Error('widget ilegible');
    const normal = await reader.resolve(normalEntry(widget));
    if (typeof normal !== 'object' || normal === null || !('kind' in normal) || normal.kind !== 'stream') {
      throw new Error('la apariencia no es un flujo');
    }
    expect(new TextDecoder('latin1').decode(decodeStreamData(normal))).toContain(pdfText('María José'));
  });

  it('casilla desmarcada y botones de opción sin selección quedan en /Off (/V y /AS)', async () => {
    const fields = await readFormFields(ORIGINAL);
    const { data } = await save(
      changesFor(fields, {
        acepto: { kind: 'checkbox', checked: false },
        color: { kind: 'radio', selected: null },
      }),
    );
    const objects = qpdfObjects(checkWithQpdf(data));
    const [acepto] = widgetNums(fields, 'acepto');
    expect(dictOf(objects, acepto ?? -1)['/AS']).toBe('/Off');
    const [color] = widgetNums(fields, 'color');
    const parent = dictOf(objects, color ?? -1)['/Parent'];
    if (typeof parent !== 'string') throw new Error('el widget de color no tiene /Parent');
    expect(dictOf(objects, Number(parent.split(' ')[0]))['/V']).toBe('/Off');
    for (const num of widgetNums(fields, 'color')) expect(dictOf(objects, num)['/AS']).toBe('/Off');
  });

  it('anotaciones y campos a la vez: un único incremento válido; pdf.js ve la anotación y los valores', async () => {
    const fields = await readFormFields(ORIGINAL);
    const diff = additionsDiff(standardAnnotations(0));
    const { data, delta } = await saveFormChanges(ORIGINAL, changesFor(fields, CHANGES), diff);
    expect(new TextDecoder('latin1').decode(delta).match(/%%EOF/g)).toHaveLength(1);
    checkWithQpdf(data);

    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    if (!loaded.ok) throw new Error(loaded.error.code);
    try {
      const annotations = await (await loaded.value.doc.getPage(1)).getAnnotations({ intent: 'display' });
      expect(annotations.some((a) => a.subtype === 'Highlight')).toBe(true);
      expect(annotations.find((a) => a.fieldName === 'nombre')?.fieldValue).toBe('María José');
    } finally {
      await loaded.value.destroy();
    }
  });
});
