import type { ImportedPage } from '../core/annotations/import';
import type { AnnotationEdits } from '../core/annotations/model';
import { setFieldCommand } from '../core/forms/commands';
import { effectiveValue, storageValue } from '../core/forms/effective';
import { mergeFields } from '../core/forms/import';
import { isFillable, valueEquals, type FieldValue, type FormField, type FormWidget } from '../core/forms/model';
import type { LoadedPdf, PDFDocumentProxy } from '../engine';
import { setWidgetStorageValue } from '../engine/form-storage';
import { bumpPageVersions, executeEdit, onEditsPublished, onPagesImported } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { services } from './services';
import { initialFormState, useForms, type FormState } from './form-store';
import { goToPage } from './navigation';
import { showNotice } from './notice';
import { registerTabParticipant, type TabParticipant } from './tabs';
import { useViewer } from './viewer-store';
import { formMsg } from '../ui/messages-forms';

/** Clave de la preferencia de resaltado de campos (el almacén ya antepone el prefijo de la app). */
const HIGHLIGHT_PREF = 'formHighlight';

/** Suscripciones de la sesión de formularios de un documento. */
interface FormSession {
  readonly pdf: LoadedPdf;
  readonly stopPages: () => void;
  readonly stopEdits: () => void;
}

let session: FormSession | null = null;
/** El aviso «hay campos que rellenar» se muestra una vez por documento (PDF-041). */
let fillableNoticeShown = false;
/** Widget que debe recibir el foco al montarse su página (Tab entre páginas, PDF-083). */
let pendingFocus: { readonly pageIndex: number; readonly widgetId: string } | null = null;

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/**
 * Arranca la sesión de formularios de un documento recién abierto (después de `startAnnotationSession`). Reinicia el
 * store, lee la preferencia de resaltado y se da de alta en los avisos de anotaciones. Llamar tras `endFormSession`.
 */
export function startFormSession(pdf: LoadedPdf): void {
  endFormSession();
  const highlight = services().platform.prefs.get(HIGHLIGHT_PREF, isBoolean) ?? true;
  useForms.setState(initialFormState(highlight));
  fillableNoticeShown = false;
  subscribeForms(pdf);
}

/** Se da de alta en los avisos de anotaciones para mantener los formularios de `pdf` al día (sin tocar el store). */
function subscribeForms(pdf: LoadedPdf): void {
  const doc = pdf.doc;
  session = {
    pdf,
    stopPages: onPagesImported((pages) => {
      importPages(doc, pages);
    }),
    stopEdits: onEditsPublished((before, after) => {
      applyEdits(doc, before, after);
    }),
  };
}

/** Lo que hace falta para volver a mostrar un documento suspendido con sus formularios (PDF-101). */
interface FormsSnapshot {
  /** Documento de la sesión, o `null` sin documento. */
  readonly pdf: LoadedPdf | null;
  readonly fields: FormState['fields'];
  readonly byPage: FormState['byPage'];
  readonly fillableNoticeShown: boolean;
  readonly pendingFocus: { readonly pageIndex: number; readonly widgetId: string } | null;
}

/**
 * Participante de pestañas de los formularios (orden 20). Suspender guarda campos y avisos, y deja el módulo como
 * `endFormSession()`. Los valores rellenados siguen en el documento pdf.js, que no se destruye aquí. Reanudar restaura
 * el store y vuelve a darse de alta en los avisos, sin volver a mostrar «hay campos que rellenar».
 */
const formsParticipant: TabParticipant<FormsSnapshot> = {
  id: 'forms',
  order: 20,
  suspend(): FormsSnapshot {
    const { fields, byPage } = useForms.getState();
    const snapshot: FormsSnapshot = {
      pdf: session?.pdf ?? null,
      fields,
      byPage,
      fillableNoticeShown,
      pendingFocus,
    };
    endFormSession();
    return snapshot;
  },
  resume(snapshot: FormsSnapshot): void {
    if (snapshot.pdf === null) return;
    useForms.setState({ fields: snapshot.fields, byPage: snapshot.byPage });
    fillableNoticeShown = snapshot.fillableNoticeShown;
    pendingFocus = snapshot.pendingFocus;
    subscribeForms(snapshot.pdf);
  },
  dispose: () => Promise.resolve(),
};

/** Da de alta el participante de formularios en el registro de pestañas. Llamar una vez al arrancar. */
export function registerFormsParticipant(): void {
  registerTabParticipant(formsParticipant);
}

/** Cierra la sesión de formularios: se da de baja de los avisos y vacía el store (conserva el resaltado). */
export function endFormSession(): void {
  const current = session;
  session = null;
  current?.stopPages();
  current?.stopEdits();
  fillableNoticeShown = false;
  pendingFocus = null;
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

/**
 * Lleva el foco al primer (dir 1) o último (dir −1) campo rellenable de la siguiente (o anterior) página que tenga
 * alguno. Pide al visor esa página con la posición del borde superior del widget. Devuelve false si no hay ninguna.
 */
export function focusAdjacentPage(pageIndex: number, dir: 1 | -1): boolean {
  const { dims } = useViewer.getState();
  if (dims === null) return false;
  const fillablePages = [...useForms.getState().byPage.keys()]
    .filter((page) => fillableWidgetsOf(page).length > 0)
    .sort((a, b) => a - b);
  const target = dir === 1 ? fillablePages.find((page) => page > pageIndex) : fillablePages.findLast((page) => page < pageIndex);
  if (target === undefined) return false;
  const widgets = fillableWidgetsOf(target);
  const widget = dir === 1 ? widgets[0] : widgets[widgets.length - 1];
  if (widget === undefined) return false;
  pendingFocus = { pageIndex: target, widgetId: widget.id };
  const height = dims.height(target);
  const top = widget.rect[3];
  goToPage(target, { yFraction: height > 0 ? (height - top) / height : 0 });
  return true;
}

/** Id del widget a enfocar al montarse la página `pageIndex`, o null. Lo consume: devuelve el id una sola vez. */
export function takePendingFocus(pageIndex: number): string | null {
  if (pendingFocus === null || pendingFocus.pageIndex !== pageIndex) return null;
  const { widgetId } = pendingFocus;
  pendingFocus = null;
  return widgetId;
}

/** Widgets rellenables de una página, en el orden en que los pinta `FormLayer` (por nombre, luego por widget). */
function fillableWidgetsOf(pageIndex: number): readonly FormWidget[] {
  const { fields, byPage } = useForms.getState();
  const widgets: FormWidget[] = [];
  for (const name of byPage.get(pageIndex) ?? []) {
    const field = fields.get(name);
    if (field === undefined || !isFillable(field)) continue;
    widgets.push(...field.widgets.filter((widget) => widget.pageIndex === pageIndex));
  }
  return widgets;
}

/** Incorpora los widgets de páginas recién importadas y pone en el lienzo los valores que ya tienen cambios. */
function importPages(doc: PDFDocumentProxy, pages: readonly ImportedPage[]): void {
  const incoming = pages.flatMap((page) => page.widgets);
  if (incoming.length === 0) return;
  const fields = mergeFields(useForms.getState().fields, incoming);
  useForms.setState({ fields, byPage: byPageOf(fields) });
  if (!fillableNoticeShown && incoming.some(isFillable)) {
    fillableNoticeShown = true;
    showNotice(formMsg.hasFields);
  }

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
