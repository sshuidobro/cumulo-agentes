/**
 * Importa los widgets de formulario de cada página a partir de `page.getAnnotations()` de pdf.js
 * (ADR-0019). Puro: nunca lanza. Un widget da un `FormField` de un solo widget; `mergeFields` los
 * agrupa por nombre completo del campo.
 */
import type { RectPt, Rgb } from '../annotations/model';
import type { RawAnnotation } from '../annotations/import';
import type { ChoiceOption, FieldType, FieldValue, FormField, FormWidget } from './model';

/** Bit 2 de `/F`: el widget está oculto (ISO 32000 §12.5.3). */
const HIDDEN_FLAG = 2;
/** Bit 19 (Edit) de `/Ff` en campos de elección: el combo admite texto libre. */
const EDIT_FLAG = 262144;
/** `<num>R` o `<num>R<gen>`, tal como lo escribe pdf.js en `id`. */
const REF_PATTERN = /^(\d+)R(\d*)$/;
const ROTATIONS: readonly number[] = [0, 90, 180, 270];
const BLACK: Rgb = [0, 0, 0];

/** Importa un widget; `null` si no es un widget válido o no se puede rellenar ni mostrar. */
export function importWidget(raw: RawAnnotation, pageIndex: number): FormField | null {
  if (!isRecord(raw) || raw.subtype !== 'Widget') return null;
  if (raw.hidden === true || hiddenOf(raw.annotationFlags)) return null;
  const name = raw.fieldName;
  if (typeof name !== 'string') return null;
  const type = typeOf(raw);
  const id = raw.id;
  const ref = typeof id === 'string' ? parseRef(id) : null;
  const rect = toRect(raw.rect);
  if (type === undefined || typeof id !== 'string' || ref === null || rect === undefined) return null;

  const onState = onStateOf(type, raw);
  const widget: FormWidget = {
    id,
    ref,
    pageIndex,
    rect,
    onState,
    rotation: rotationOf(raw.rotation),
    background: colorOrNull(raw.backgroundColor),
    border: colorOrNull(raw.borderColor),
  };
  const appearance: Record<string, unknown> = isRecord(raw.defaultAppearanceData) ? raw.defaultAppearanceData : {};
  return {
    name,
    type,
    readOnly: raw.readOnly === true,
    required: raw.required === true,
    multiline: raw.multiLine === true,
    password: raw.password === true,
    comb: raw.comb === true,
    maxLen: positiveOr(raw.maxLen, 0),
    multiSelect: raw.multiSelect === true,
    editable: type === 'combo' && flagsOf(raw.fieldFlags),
    options: optionsOf(raw.options),
    align: alignOf(raw.textAlignment),
    fontSize: positiveOr(appearance.fontSize, 0),
    textColor: colorOrNull(appearance.fontColor) ?? BLACK,
    tooltip: typeof raw.alternativeText === 'string' ? raw.alternativeText : '',
    initial: initialOf(type, raw, onState),
    widgets: [widget],
  };
}

/**
 * Agrupa campos por nombre. Si el nombre ya existe, se añaden sus widgets nuevos (por `id`) en orden
 * de llegada y el resto de propiedades se conserva del primero. Sin novedades devuelve `current`.
 */
export function mergeFields(
  current: ReadonlyMap<string, FormField>,
  incoming: readonly FormField[],
): ReadonlyMap<string, FormField> {
  if (incoming.length === 0) return current;
  const out = new Map(current);
  for (const field of incoming) {
    const existing = out.get(field.name);
    if (existing === undefined) {
      out.set(field.name, field);
      continue;
    }
    const known = new Set(existing.widgets.map((w) => w.id));
    const added = field.widgets.filter((w) => !known.has(w.id));
    if (added.length > 0) out.set(field.name, { ...existing, widgets: [...existing.widgets, ...added] });
  }
  return out;
}

function typeOf(raw: Record<string, unknown>): FieldType | undefined {
  switch (raw.fieldType) {
    case 'Tx':
      return 'text';
    case 'Btn':
      if (raw.checkBox === true) return 'checkbox';
      if (raw.radioButton === true) return 'radio';
      if (raw.pushButton === true) return 'button';
      return undefined;
    case 'Ch':
      return raw.combo === true ? 'combo' : 'list';
    case 'Sig':
      return 'signature';
    default:
      return undefined;
  }
}

function onStateOf(type: FieldType, raw: Record<string, unknown>): string | null {
  const key = type === 'checkbox' ? raw.exportValue : type === 'radio' ? raw.buttonValue : undefined;
  return typeof key === 'string' ? key : null;
}

/** Valor inicial a partir de `fieldValue` de pdf.js, según el tipo. */
function initialOf(type: FieldType, raw: Record<string, unknown>, onState: string | null): FieldValue {
  const value = raw.fieldValue;
  switch (type) {
    case 'text':
      return { kind: 'text', text: textValue(value) };
    case 'checkbox':
      return { kind: 'checkbox', checked: onState !== null && value === onState };
    case 'radio':
      return { kind: 'radio', selected: typeof value === 'string' && value !== '' && value !== 'Off' ? value : null };
    case 'combo':
    case 'list':
      return { kind: 'choice', selected: choiceValue(value) };
    case 'signature':
    case 'button':
      return { kind: 'text', text: '' };
  }
}

/** Cadena tal cual; de una lista, su primer elemento; cualquier otra cosa, `''`. */
function textValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  const items: readonly unknown[] = v;
  const first = items[0];
  return typeof first === 'string' ? first : '';
}

function choiceValue(v: unknown): readonly string[] {
  if (typeof v === 'string') return v === '' ? [] : [v];
  if (!Array.isArray(v)) return [];
  const items: readonly unknown[] = v;
  return items.filter(isString);
}

function optionsOf(v: unknown): readonly ChoiceOption[] {
  if (!Array.isArray(v)) return [];
  const items: readonly unknown[] = v;
  const out: ChoiceOption[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.exportValue !== 'string') continue;
    out.push({
      exportValue: item.exportValue,
      displayValue: typeof item.displayValue === 'string' ? item.displayValue : item.exportValue,
    });
  }
  return out;
}

function alignOf(v: unknown): 0 | 1 | 2 {
  return v === 1 ? 1 : v === 2 ? 2 : 0;
}

function rotationOf(v: unknown): 0 | 90 | 180 | 270 {
  return typeof v === 'number' && ROTATIONS.includes(v) ? (v as 0 | 90 | 180 | 270) : 0;
}

/** Número positivo o `fallback` (ausente, no finito o ≤ 0). */
function positiveOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Bit Edit de `/Ff`. */
function flagsOf(v: unknown): boolean {
  return typeof v === 'number' && (v & EDIT_FLAG) !== 0;
}

/** Bandera `/F` numérica con el bit Hidden activo. Ausente o no numérica: no oculta. */
function hiddenOf(v: unknown): boolean {
  return typeof v === 'number' && (v & HIDDEN_FLAG) !== 0;
}

/** Color de pdf.js (0-255, typed array u objeto `{0,1,2}`) → RGB en [0, 1]; `null` si falta o no encaja. */
function colorOrNull(v: unknown): Rgb | null {
  const parts = componentsOf(v);
  if (parts === undefined || parts.length !== 3) return null;
  const [r = 0, g = 0, b = 0] = parts;
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

function componentsOf(v: unknown): readonly number[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return numbersOf(Array.from(v as unknown as ArrayLike<unknown>));
  if (Array.isArray(v)) return numbersOf(asList(v));
  if (isRecord(v)) return numbersOf([v['0'], v['1'], v['2']]);
  return undefined;
}

/** Rectángulo normalizado; `undefined` si no tiene cuatro números finitos. */
function toRect(v: unknown): RectPt | undefined {
  if (!Array.isArray(v)) return undefined;
  const nums = numbersOf(asList(v));
  if (nums === undefined || nums.length !== 4) return undefined;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = nums;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** Lista de números finitos; `undefined` si algún elemento no lo es. */
function numbersOf(items: readonly unknown[]): readonly number[] | undefined {
  const out: number[] = [];
  for (const x of items) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
    out.push(x);
  }
  return out;
}

/** `<num>R` o `<num>R<gen>`; `null` si no es una referencia válida. */
function parseRef(s: string): { readonly num: number; readonly gen: number } | null {
  const m = REF_PATTERN.exec(s);
  if (m === null) return null;
  const num = Number(m[1] ?? '');
  const gen = Number(m[2] ?? '');
  return num >= 1 ? { num, gen } : null;
}

function asList(v: unknown[]): readonly unknown[] {
  return v;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
