/**
 * Modelo de los campos AcroForm (ADR-0019). Puro y en inglés en el código; todo inmutable.
 * Un `FormField` agrupa por nombre completo todos sus widgets (uno por página o por botón de opción).
 */
import type { PdfObjRef, RectPt, Rgb } from '../annotations/model';

export type FieldType = 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'signature' | 'button';

export type FieldValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  | { readonly kind: 'radio'; readonly selected: string | null } // estado del botón elegido
  | { readonly kind: 'choice'; readonly selected: readonly string[] }; // valores de exportación

export interface ChoiceOption {
  readonly exportValue: string;
  readonly displayValue: string;
}

export interface FormWidget {
  readonly id: string; // id de pdf.js, p. ej. "9R"
  readonly ref: PdfObjRef;
  readonly pageIndex: number;
  readonly rect: RectPt; // normalizado x1<=x2, y1<=y2
  readonly onState: string | null; // casilla: exportValue; opción: buttonValue; resto null
  readonly rotation: 0 | 90 | 180 | 270;
  readonly background: Rgb | null; // /MK /BG en [0,1]
  readonly border: Rgb | null; // /MK /BC en [0,1]
}

export interface FormField {
  readonly name: string;
  readonly type: FieldType;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly multiline: boolean;
  readonly password: boolean;
  readonly comb: boolean;
  readonly maxLen: number; // 0 = sin límite
  readonly multiSelect: boolean;
  readonly editable: boolean; // combo con bit Edit (fieldFlags & 262144)
  readonly options: readonly ChoiceOption[];
  readonly align: 0 | 1 | 2;
  readonly fontSize: number; // 0 = automático
  readonly textColor: Rgb;
  readonly tooltip: string; // /TU o ''
  readonly initial: FieldValue;
  readonly widgets: readonly FormWidget[];
}

/** Igualdad profunda; en listas importa el orden. Supone dos valores válidos. */
export function valueEquals(a: FieldValue, b: FieldValue): boolean {
  switch (a.kind) {
    case 'text':
      return b.kind === 'text' && a.text === b.text;
    case 'checkbox':
      return b.kind === 'checkbox' && a.checked === b.checked;
    case 'radio':
      return b.kind === 'radio' && a.selected === b.selected;
    case 'choice':
      return (
        b.kind === 'choice' &&
        a.selected.length === b.selected.length &&
        a.selected.every((v, i) => v === b.selected[i])
      );
  }
}

const VALUE_KEYS: Readonly<Record<FieldValue['kind'], readonly string[]>> = {
  text: ['kind', 'text'],
  checkbox: ['kind', 'checked'],
  radio: ['kind', 'selected'],
  choice: ['kind', 'selected'],
};

/** Validación completa de un valor (p. ej. de un borrador): forma exacta, sin claves extra. */
export function isFieldValue(v: unknown): v is FieldValue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  if (typeof rec.kind !== 'string' || !isKind(rec.kind)) return false;
  const keys = Object.keys(rec);
  const expected = VALUE_KEYS[rec.kind];
  if (keys.length !== expected.length || !expected.every((k) => keys.includes(k))) return false;
  switch (rec.kind) {
    case 'text':
      return typeof rec.text === 'string';
    case 'checkbox':
      return typeof rec.checked === 'boolean';
    case 'radio':
      return rec.selected === null || typeof rec.selected === 'string';
    case 'choice':
      return Array.isArray(rec.selected) && rec.selected.every((s: unknown) => typeof s === 'string');
    default:
      return false;
  }
}

function isKind(k: string): k is FieldValue['kind'] {
  return k === 'text' || k === 'checkbox' || k === 'radio' || k === 'choice';
}

const FILLABLE_TYPES: readonly FieldType[] = ['text', 'checkbox', 'radio', 'combo', 'list'];

/** Se puede rellenar: no es de solo lectura y es de un tipo con valor editable. */
export function isFillable(f: FormField): boolean {
  return !f.readOnly && FILLABLE_TYPES.includes(f.type);
}
