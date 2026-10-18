---
tipo: tarea
id: PDF-080
titulo: Valores de campo en el historial común y en los borradores
app: pdf
estado: en-test
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/model.ts` (campo `fields`, `EMPTY_EDITS`), `annotations/commands.ts` (conserva `fields`), `annotations/draft.ts` (v2, acepta v1), `forms/commands.ts` (nuevo, `setFieldCommand`), `forms/effective.ts` (nuevo, `effectiveValue`, `storageValue`), `forms/diff.ts` (nuevo, `diffFields`), `forms/index.ts`; tests nuevos `tests/unit/forms-commands.test.ts` y `tests/unit/forms-effective.test.ts`; ampliado `tests/unit/annotations/draft.test.ts`; añadido `fields: new Map()` en las construcciones a mano de `AnnotationEdits` de 9 ficheros de tests y `tests/support/save-annotations.ts`.
- Qué he hecho: `AnnotationEdits` lleva `fields` (valores de formulario que difieren del fichero) y el comando primitivo lo conserva; `setFieldCommand` con deshacer/rehacer; valor efectivo, valor para `annotationStorage` y diferencia para guardar; borrador v2 con `fields` (la v1 sigue leyéndose con `fields` vacío, duplicados o valores inválidos dan `null`).
- Comandos ejecutados y resultado: `pnpm lint` → 0; `pnpm typecheck` → 0; `pnpm coverage` (suite completa, una sola vez) → 0, 164 ficheros y 1895 tests en verde. Antes, tests dirigidos de anotaciones, borradores, formularios e incremental → en verde.
- Dudas o cosas que no he podido hacer:
  1. **Desviación de criterio, revisar:** la ficha pide «sin cambiar sus aserciones», pero la propia ficha hace que `toDraft` escriba la versión 2 y que la 2 sea válida. Tres aserciones que fijaban el número de versión han tenido que cambiar: `tests/unit/annotations/draft.test.ts` (`version: 1` → `2` en el ida y vuelta; la «versión distinta» usa ahora `version: 3`, porque la 2 ya es válida) y `tests/ui/draft-sync.test.tsx` (`version: 1` → `2`). No se ha tocado ninguna otra aserción.
  2. `storageValue` para opciones de grupo: he añadido la guarda `widget.onState !== null &&` para que un widget sin estado de exportación nunca salga marcado (con la fórmula literal, `null === null` daría `true`). Solo cambia el caso mal formado.
  3. Prettier marca ficheros existentes del proyecto (también `forms/import.ts`); no es parte de `pnpm lint`, no lo he tocado.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Lint y typecheck en 0; tests dirigidos (forms, anotaciones, pdf, draft-sync: 43 ficheros, 703 tests) en verde.
- Desviación declarada aceptada: `toDraft` debe escribir v2 por mandato de la ficha, así que las aserciones `version: 1` -> `2` y «versión distinta» 2 -> 3 son consecuencia inevitable; no se ha debilitado ninguna otra aserción. El resto de cambios en tests solo añade `fields: new Map()`.
- Guarda `onState !== null` en `storageValue` aceptada (solo afecta a casos mal formados y tiene test).
- Los criterios tienen test que falla si se incumplen (undo/redo, `color` -> false/false/true, `diffFields`, v1/v2 de borradores).
1. (opcional) `forms/commands.ts` — `invert` conserva bien el valor previo; sin cambios necesarios.
