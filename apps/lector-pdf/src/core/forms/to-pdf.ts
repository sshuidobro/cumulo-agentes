/**
 * Objetos PDF de los valores de formulario que cambia el usuario (ISO 32000-1 §12.7.3 y §12.7.4, ADR-0019).
 * Función pura sobre el lector: devuelve qué objetos escribir y con qué valor, sin tocar el fichero. El
 * escritor incremental (PDF-042) los anexa después de las anotaciones modificadas.
 */
import type { ObjectReader } from '../pdf/object-reader';
import {
  dict,
  dictGet,
  name,
  PdfSyntaxError,
  ref,
  withEntries,
  type PdfDict,
  type PdfName,
  type PdfRef,
  type PdfValue,
} from '../pdf/objects';
import { encodeTextString } from '../pdf/text-string';
import { buildFieldAppearance } from './appearance';
import type { FieldChange } from './diff';
import { isFillable, type FieldValue, type FormField, type FormWidget } from './model';

/** Objeto que hay que escribir en el incremento: número, generación y valor completo. */
export interface ObjectWrite {
  readonly num: number;
  readonly gen: number;
  readonly value: PdfValue;
}

/** Diccionario pendiente de escribir, con todos los cambios acumulados. */
interface Pending {
  readonly ref: PdfRef;
  readonly dict: PdfDict;
}

const OFF = 'Off';

/**
 * Objetos que hay que escribir para los campos cambiados. `allocate` da un número de objeto nuevo. Lanza
 * `PdfSyntaxError` si no puede leer un widget. Campos no rellenables o de solo lectura se ignoran.
 *
 * Un objeto que es campo y widget a la vez (con `/T`) se escribe una sola vez con todos sus cambios.
 * Los diccionarios van primero (en orden de primera lectura) y luego las apariencias nuevas (en orden de reserva).
 */
export async function planFieldWrites(
  reader: ObjectReader,
  changes: readonly FieldChange[],
  allocate: () => PdfRef,
): Promise<readonly ObjectWrite[]> {
  const pending = new Map<string, Pending>();
  const streams: ObjectWrite[] = [];

  const current = async (r: PdfRef): Promise<PdfDict> => {
    const known = pending.get(keyOf(r));
    if (known !== undefined) return known.dict;
    const dictionary = await reader.getDict(r);
    if (dictionary === null) throw unreadable(`objeto ${keyOf(r)}`);
    return dictionary;
  };
  const patch = async (r: PdfRef, changesOf: Record<string, PdfValue | undefined>): Promise<void> => {
    pending.set(keyOf(r), { ref: r, dict: withEntries(await current(r), changesOf) });
  };

  for (const { field, value } of changes) {
    if (!isFillable(field)) continue;
    const first = field.widgets[0];
    if (first === undefined) throw unreadable(`campo ${field.name} sin widgets`);

    const fieldRef = await fieldObjectOf(reader, first);
    await patch(fieldRef, { ...choiceEntries(field, value), V: valueEntry(field, value) });

    for (const widget of field.widgets) {
      const widgetRef = ref(widget.ref.num, widget.ref.gen);
      if (field.type === 'checkbox') {
        await patch(widgetRef, { AS: stateName(widget.onState, valueOf(value, 'checkbox', field).checked) });
      } else if (field.type === 'radio') {
        const selected = valueOf(value, 'radio', field).selected;
        const on = selected !== null && selected === widget.onState;
        await patch(widgetRef, { AS: stateName(widget.onState, on) });
      } else if (field.type === 'text' || field.type === 'combo' || field.type === 'list') {
        const apRef = allocate();
        const appearance = buildFieldAppearance(field, widget, value);
        if (appearance === null) throw unreadable(`apariencia de ${field.name}`);
        streams.push({ num: apRef.num, gen: apRef.gen, value: appearance });
        await patch(widgetRef, { AP: dict({ N: apRef }) });
      }
    }
  }

  const dicts: ObjectWrite[] = [...pending.values()].map((p) => ({ num: p.ref.num, gen: p.ref.gen, value: p.dict }));
  return [...dicts, ...streams];
}

function keyOf(r: PdfRef): string {
  return `${r.num} ${r.gen}`;
}

/** Objeto del campo: el propio widget si tiene `/T`; si no, su `/Parent`. */
async function fieldObjectOf(reader: ObjectReader, widget: FormWidget): Promise<PdfRef> {
  const widgetRef = ref(widget.ref.num, widget.ref.gen);
  const widgetDict = await reader.getDict(widgetRef);
  if (widgetDict === null) throw unreadable(`widget ${widget.id}`);
  if (dictGet(widgetDict, 'T') !== undefined) return widgetRef;
  const parent = dictGet(widgetDict, 'Parent');
  if (!isRefValue(parent)) throw unreadable(`estructura del widget ${widget.id}`);
  return parent;
}

/** Valor `/V` del campo según su tipo (los nombres de opción van como nombres PDF). */
function valueEntry(field: FormField, value: FieldValue): PdfValue {
  switch (field.type) {
    case 'text':
      return encodeTextString(valueOf(value, 'text', field).text);
    case 'checkbox': {
      const first = field.widgets[0];
      return stateName(first?.onState ?? null, valueOf(value, 'checkbox', field).checked);
    }
    case 'radio':
      return name(valueOf(value, 'radio', field).selected ?? OFF);
    case 'combo':
      return encodeTextString(valueOf(value, 'choice', field).selected[0] ?? '');
    case 'list': {
      const selected = valueOf(value, 'choice', field).selected;
      return field.multiSelect ? selected.map((s) => encodeTextString(s)) : encodeTextString(selected[0] ?? '');
    }
    default:
      throw unreadable(`tipo ${field.type} de ${field.name}`);
  }
}

/** `/I` (índices de las opciones elegidas, ordenados) en listas de selección múltiple; en el resto, se quita. */
function choiceEntries(field: FormField, value: FieldValue): Record<string, PdfValue | undefined> {
  if (field.type !== 'list' || !field.multiSelect) return { I: undefined };
  const selected = valueOf(value, 'choice', field).selected;
  const indices: number[] = [];
  field.options.forEach((option, index) => {
    if (selected.includes(option.exportValue)) indices.push(index);
  });
  return { I: indices };
}

/** Estado de un widget de casilla u opción: su estado activado si `on`, si no `Off`. */
function stateName(onState: string | null, on: boolean): PdfName {
  if (!on) return name(OFF);
  if (onState === null) throw unreadable('estado activado sin exportValue');
  return name(onState);
}

/** Valor del tipo esperado; si no coincide con el campo, es un dato incoherente. */
function valueOf<K extends FieldValue['kind']>(
  value: FieldValue,
  kind: K,
  field: FormField,
): Extract<FieldValue, { kind: K }> {
  if (value.kind !== kind) throw unreadable(`valor de ${field.name}`);
  return value as Extract<FieldValue, { kind: K }>;
}

function unreadable(where: string): PdfSyntaxError {
  return new PdfSyntaxError(`estructura no legible: ${where}`, 0);
}

function isRefValue(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}
