import type { ImportedPage } from '../core/annotations/import';
import type { AnnotationEdits } from '../core/annotations/model';
import {
  effectiveValue,
  isFillable,
  mergeFields,
  setFieldCommand,
  storageValue,
  valueEquals,
  type FieldValue,
  type FormField,
  type FormWidget,
} from '../core/forms';
import type { LoadedPdf, PDFDocumentProxy } from '../engine';
import { setWidgetStorageValue } from '../engine/form-storage';
import { bumpPageVersions, executeEdit, onEditsPublished, onPagesImported } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { services } from './services';
import { initialFormState, useForms, type FormState } from './form-store';

/** Clave de la preferencia de resaltado de campos (el almacén ya antepone el prefijo de la app). */
const HIGHLIGHT_PREF = 'formHighlight';

/** Suscripciones de la sesión de formularios de un documento. */
interface FormSession {
  readonly stopPages: () => void;
  readonly stopEdits: () => void;
}

let session: FormSession | null = null;

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/**
 * Arranca la sesión de formularios de un documento recién abierto (después de `startAnnotationSession`). Reinicia el
 * store, lee la preferencia de resaltado y se da de alta en los avisos de anotaciones. Llamar tras `endFormSession`.
 */
export function startFormSession(pdf: LoadedPdf): void {
  endFormSession();
  const doc = pdf.doc;
  const highlight = services().platform.prefs.get(HIGHLIGHT_PREF, isBoolean) ?? true;
  useForms.setState(initialFormState(highlight));
  session = {
    stopPages: onPagesImported((pages) => {
      importPages(doc, pages);
    }),
    stopEdits: onEditsPublished((before, after) => {
      applyEdits(doc, before, after);
    }),
  };
}

/** Cierra la sesión de formularios: se da de baja de los avisos y vacía el store (conserva el resaltado). */
export function endFormSession(): void {
  const current = session;
  session = null;
  current?.stopPages();
  current?.stopEdits();
  useForms.setState(initialFormState(useForms.getState().highlight));
}

/**
 * Valor efectivo de un campo (cambiado por el usuario o, si no, el del fichero). `null` si no existe el campo.
 */
export function fieldValue(name: string): FieldValue | null {
  const field = useForms.getState().fields.get(name);
  if (field === undefined) return null;
  return effectiveValue(field, useAnnotations.getState().edits);
}

/**
 * Cambia el valor de un campo con una entrada de deshacer «rellenar «etiqueta»». Un campo inexistente, de solo lectura
 * o cuyo valor no cambia no hace nada. Volver al valor del fichero guarda `undefined`.
 */
export function setFieldValue(name: string, value: FieldValue): void {
  const field = useForms.getState().fields.get(name);
  if (field === undefined || !isFillable(field)) return;
  if (valueEquals(effectiveValue(field, useAnnotations.getState().edits), value)) return;
  const stored = valueEquals(value, field.initial) ? undefined : value;
  executeEdit(setFieldCommand(name, stored, field.tooltip || name));
}

/** Guarda la preferencia de resaltado y la aplica al store. */
export function setFormHighlight(on: boolean): void {
  services().platform.prefs.set(HIGHLIGHT_PREF, on);
  useForms.setState({ highlight: on });
}

/** Incorpora los widgets de páginas recién importadas y pone en el lienzo los valores que ya tienen cambios. */
function importPages(doc: PDFDocumentProxy, pages: readonly ImportedPage[]): void {
  const incoming = pages.flatMap((page) => page.widgets);
  if (incoming.length === 0) return;
  const fields = mergeFields(useForms.getState().fields, incoming);
  useForms.setState({ fields, byPage: byPageOf(fields) });

  const { edits } = useAnnotations.getState();
  for (const incomingField of incoming) {
    const field = fields.get(incomingField.name);
    if (field === undefined) continue;
    for (const widget of incomingField.widgets) {
      showWidget(doc, field, widget, edits);
    }
  }
}

/** Pone en el lienzo el valor efectivo de un widget, si es distinto del del fichero. */
function showWidget(doc: PDFDocumentProxy, field: FormField, widget: FormWidget, edits: AnnotationEdits): void {
  if (!isFillable(field)) return;
  const value = effectiveValue(field, edits);
  if (valueEquals(value, field.initial)) return;
  setWidgetStorageValue(doc, widget.id, storageValue(field, widget, value));
}

/**
 * Por cada cambio de valor de un campo rellenable, actualiza el storage de sus widgets (o lo quita si vuelve al
 * valor del fichero) y sube la versión de sus páginas.
 */
function applyEdits(doc: PDFDocumentProxy, before: AnnotationEdits, after: AnnotationEdits): void {
  const { fields } = useForms.getState();
  const names = new Set([...before.fields.keys(), ...after.fields.keys()]);
  const pages = new Set<number>();
  for (const name of names) {
    const field = fields.get(name);
    if (field === undefined || !isFillable(field)) continue;
    const next = effectiveValue(field, after);
    if (valueEquals(effectiveValue(field, before), next)) continue;
    const unchanged = valueEquals(next, field.initial);
    for (const widget of field.widgets) {
      setWidgetStorageValue(doc, widget.id, unchanged ? undefined : storageValue(field, widget, next));
      pages.add(widget.pageIndex);
    }
  }
  bumpPageVersions(pages);
}

/** Nombres de campo por página, en orden de aparición (cada nombre una vez por página). */
function byPageOf(fields: FormState['fields']): ReadonlyMap<number, readonly string[]> {
  const sets = new Map<number, Set<string>>();
  for (const field of fields.values()) {
    for (const widget of field.widgets) {
      const names = sets.get(widget.pageIndex) ?? new Set<string>();
      names.add(field.name);
      sets.set(widget.pageIndex, names);
    }
  }
  return new Map([...sets].map(([page, names]) => [page, [...names]]));
}
