---
tipo: tarea
id: PDF-080
titulo: Valores de campo en el historial común y en los borradores
app: pdf
estado: pendiente
depende_de: [PDF-079]
intentos: 0
skills: [stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, core, undo]
---

# PDF-080 · Valores de campo en el historial común y en los borradores

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]] · [[ADR-0005-modelo-deshacer-rehacer]]

## Objetivo
Los valores de formulario cambiados viven en el mismo documento de deshacer que las anotaciones (`AnnotationEdits.fields`), con su comando, su cálculo de «valor efectivo», su diferencia para guardar y su sitio en el borrador de recuperación.

## Contexto
- Leer: `src/core/annotations/model.ts` (`AnnotationEdits`, `EMPTY_EDITS`), `commands.ts` (`setEntryCommand`), `draft.ts` (`toDraft`, `fromDraft`), `src/core/forms/model.ts` (PDF-079), `packages/shared/src/undo/types.ts` (`Command`).
- `AnnotationEdits` mantiene su nombre (cambiarlo tocaría decenas de ficheros); documenta en su comentario que también lleva los campos.

## Qué hay que hacer
1. `model.ts`: `AnnotationEdits` gana `readonly fields: ReadonlyMap<string, FieldValue>` (nombre completo → valor, **solo** los que difieren del fichero). `EMPTY_EDITS` con `fields: new Map()`.
2. `commands.ts`: `setEntryCommand.apply` devuelve `{ upserts, removed: removedIds, fields: doc.fields }` (conserva los campos).
3. `src/core/forms/commands.ts`:
```ts
/** Fija el valor de un campo; `undefined` = vuelve al valor del fichero. Etiqueta: `rellenar «${label}»`. */
export function setFieldCommand(name: string, value: FieldValue | undefined, label: string): Command<AnnotationEdits>;
```
   `apply` copia `fields` y pone o borra la clave (conserva `upserts` y `removed`); `invert(before)` = `setFieldCommand(name, before.fields.get(name), label)`.
4. `src/core/forms/effective.ts`:
```ts
export function effectiveValue(field: FormField, edits: AnnotationEdits): FieldValue; // edits.fields.get(name) ?? field.initial
/** Valor a guardar en `annotationStorage` de pdf.js para un widget (ADR-0019). */
export function storageValue(field: FormField, widget: FormWidget, value: FieldValue): string | boolean | readonly string[];
```
   `storageValue`: texto → `text`; casilla → `checked`; opción → `selected === widget.onState`; combo → `selected[0] ?? ''`; lista → `selected`.
5. `src/core/forms/diff.ts`:
```ts
export interface FieldChange { readonly field: FormField; readonly value: FieldValue }
/** Campos cuyo valor efectivo difiere del fichero, en el orden de `fields`. Ignora nombres que no estén en `fields` y campos no rellenables. */
export function diffFields(fields: ReadonlyMap<string, FormField>, edits: AnnotationEdits): readonly FieldChange[];
```
6. `draft.ts`: `AnnotationDraft` pasa a `version: 2` con `fields: readonly (readonly [string, FieldValue])[]`. `toDraft` escribe la versión 2. `fromDraft` acepta la 1 (sin `fields` → mapa vacío) y la 2 (cada valor con `isFieldValue`, nombres repetidos → `null`).
7. `src/core/forms/index.ts` reexporta los nuevos módulos.
8. Tests: `tests/unit/forms-commands.test.ts` (comando, `invert`, deshacer/rehacer con `UndoStack`, que no toca `upserts`/`removed`), `tests/unit/forms-effective.test.ts`, ampliar el test existente de borradores (v1 sigue valiendo, v2 ida y vuelta, v2 con valor inválido → `null`).

## Criterios de aceptación
- [ ] Con `UndoStack<AnnotationEdits>`: `setFieldCommand('nombre', {kind:'text',text:'Luis'})` → `doc.fields.get('nombre')` es ese valor; `undo()` → la clave no existe; `redo()` → vuelve. Un `addAnnotationCommand` posterior conserva `fields`.
- [ ] `storageValue` del campo `color` de `form-full.pdf` con `selected: 'Azul'` da `false`, `false`, `true` para sus 3 widgets.
- [ ] `diffFields` con `nombre` vuelto a `'Ana'` (igual que el fichero) no lo devuelve; con `solo_lectura` cambiado tampoco.
- [ ] `fromDraft` de un borrador v1 de PDF-038 (el del test existente) da `fields` vacío; ida y vuelta v2 con 3 campos de tipos distintos es idéntica.
- [ ] Todos los tests existentes de anotaciones, borradores y `annotation-actions` siguen en verde sin cambiar sus aserciones (solo se permite añadir `fields: new Map()` donde construyan `AnnotationEdits` a mano).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Estado de la app y sincronización con pdf.js (PDF-081). UI. Guardar (PDF-042).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
