---
tipo: tarea
id: PDF-081
titulo: Estado de formularios y sincronización con el lienzo de pdf.js
app: pdf
estado: pendiente
depende_de: [PDF-080]
intentos: 0
skills: [stack-typescript-react, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, estado]
---

# PDF-081 · Estado de formularios y sincronización con el lienzo de pdf.js

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]]

## Objetivo
La app conoce los campos del documento abierto (store `useForms`), cambia sus valores con deshacer/rehacer por la pila común y el lienzo los repinta (pdf.js con `annotationStorage`). Los borradores recuperados restauran también los campos.

## Contexto
- Leer: `src/state/annotation-actions.ts` (`apply`, `publish`, `mergePages`, `recoverEdits`, `startAnnotationSession`, `pageVersion`), `src/state/annotation-store.ts`, `src/engine/annotation-visibility.ts` (uso de `annotationStorage`), `src/state/document-actions.ts` (`openDocument`), `src/core/forms/*` (PDF-079, PDF-080).
- Sin ciclos de importación: `form-actions.ts` importa de `annotation-actions.ts`, nunca al revés (este expone *listeners*).
- El lienzo ya se dibuja con `ENABLE_STORAGE` (`engine/render.ts`): no se toca.

## Qué hay que hacer
1. `src/engine/form-storage.ts` (solo aquí se toca el storage de widgets):
```ts
/** Pone (o quita, con `undefined`) el valor de un widget en `doc.annotationStorage` (clave = id de pdf.js). */
export function setWidgetStorageValue(doc: PDFDocumentProxy, widgetId: string, value: string | boolean | readonly string[] | undefined): void;
```
   Con valor: `doc.annotationStorage.setValue(widgetId, { value })`; sin valor: `remove(widgetId)`.
2. `src/state/annotation-actions.ts` (añadir, sin cambiar el comportamiento actual):
```ts
export type EditsListener = (before: AnnotationEdits, after: AnnotationEdits) => void;
export function onEditsPublished(listener: EditsListener): () => void;   // se llama al final de publish()
export type PagesListener = (pages: readonly ImportedPage[]) => void;
export function onPagesImported(listener: PagesListener): () => void;    // se llama en mergePages y en la importación perezosa por página
export function executeEdit(cmd: Command<AnnotationEdits>): void;        // apply(() => stack.execute(cmd))
export function bumpPageVersions(pages: Iterable<number>): void;         // sube pageVersion de esas páginas
```
   `recoverEdits`: dentro del mismo `stack.group`, además de las anotaciones, ejecuta `setFieldCommand(name, value, 'recuperar cambios')` por cada entrada de `recovered.fields`.
3. `src/state/form-store.ts`:
```ts
export interface FormState {
  readonly fields: ReadonlyMap<string, FormField>;
  /** Nombres de campo con algún widget en cada página (0-based), en orden de aparición. */
  readonly byPage: ReadonlyMap<number, readonly string[]>;
  /** Resaltar campos (preferencia `formHighlight`, por defecto true). */
  readonly highlight: boolean;
}
export const useForms: UseBoundStore<StoreApi<FormState>>;
```
4. `src/state/form-actions.ts`:
   - `startFormSession(pdf: LoadedPdf): void` — reinicia el store (lee `highlight` de las preferencias) y se suscribe con `onPagesImported` y `onEditsPublished`; guarda las funciones de baja; `endFormSession()` las llama y vacía el store. Llamarlas desde `openDocument` (junto a `startAnnotationSession`) y desde `releaseSession` en `document-actions.ts`.
   - Al importar páginas: `mergeFields` + recalcular `byPage`; para cada widget nuevo de un campo con valor en `edits.fields`, aplicar `setWidgetStorageValue` (caso: borrador recuperado antes de que se importe la página).
   - Al publicar cambios: para cada nombre cuyo valor difiera entre `before.fields` y `after.fields`: si el campo existe, por cada widget `setWidgetStorageValue(doc, w.id, valueEquals(efectivo, initial) ? undefined : storageValue(...))`; después `bumpPageVersions` con las páginas de esos widgets.
   - `setFieldValue(name: string, value: FieldValue): void` — si el campo no existe o no es `isFillable`, no hace nada; si es igual al efectivo, nada; si no, `executeEdit(setFieldCommand(name, valueEquals(value, initial) ? undefined : value, label))` con `label = field.tooltip || name`.
   - `fieldValue(name: string): FieldValue | null` (efectivo) y `setFormHighlight(on: boolean)` (guarda la preferencia).
5. Tests `tests/ui/form-actions.test.ts` (jsdom, documento real `form-full.pdf` con la app de pruebas como hacen los tests de `annotation-actions`).

## Criterios de aceptación
- [ ] Abrir `form-full.pdf` → `useForms.getState().fields.size === 14` y `byPage.get(0)` empieza por `['nombre', 'comentarios', 'codigo', …]`.
- [ ] `setFieldValue('nombre', {kind:'text', text:'Luis'})` → `doc.annotationStorage.getValue('<id de cada widget de nombre>', null)?.value === 'Luis'` en los 2 widgets, `pageVersion` de las páginas 0 y 1 sube en 1, `useAnnotations.getState().undo.undoLabel === 'rellenar «nombre»'` e `isDirty === true`.
- [ ] `undo()` → el storage ya no tiene esas claves e `isDirty === false`; `redo()` → vuelven.
- [ ] `setFieldValue('solo_lectura', …)` y `setFieldValue('no_existe', …)` no cambian nada (sin entrada de deshacer).
- [ ] `setFieldValue('color', {kind:'radio', selected:'Azul'})` → storage `false/false/true` en los 3 widgets.
- [ ] Recuperar un borrador v2 con `nombre: 'Eva'` → el storage de los widgets de `nombre` vale `'Eva'` y una sola entrada de deshacer «recuperar cambios».
- [ ] Abrir otro documento vacía `useForms` y no deja *listeners* vivos (test: tras cerrar, `setFieldValue` no hace nada).
- [ ] Los tests existentes de anotaciones, borradores, guardar y recuperar siguen en verde.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Controles de edición (PDF-041, PDF-083). Guardar en el PDF (PDF-042).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
