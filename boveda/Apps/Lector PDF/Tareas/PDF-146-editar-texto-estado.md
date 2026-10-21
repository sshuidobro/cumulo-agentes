---
tipo: tarea
id: PDF-146
titulo: Editar texto - localizar la línea con pdf.js, ediciones pendientes con deshacer y guardado
app: pdf
estado: hecha
depende_de: [PDF-145, PDF-137]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-21
tags: [tarea, pdf, iteracion-6, edicion]
---

# PDF-146 · Editar texto: localizar la línea con pdf.js, ediciones pendientes con deshacer y guardado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0042-editar-texto-linea-simple]] · Antes: [[PDF-145-editar-texto-aplicar]], [[PDF-137-redactar-interfaz]] (mismo patrón de cambios pendientes) · Siguen: [[PDF-147-editar-texto-interfaz]]

## Objetivo
Toda la lógica de interfaz sin componentes: a partir de un punto de la página, encontrar la línea y su texto con pdf.js y preguntar al Worker si es editable; guardar las líneas editadas como cambios pendientes con deshacer/rehacer, y al guardar aplicarlas con una confirmación clara y reabrir el documento reescrito.

## Contexto
- [[ADR-0042-editar-texto-linea-simple]].
- Ops `'edit-text-probe'` y `'edit-text'` → `src/core/doc-ops/ops/edit-text.ts` (PDF-145): `EditTextProbe`, `EditableLine`, `LineIssue`, `LineEdit`; `firstUnmappable` en `src/core/annotations/winansi.ts`.
- Patrón completo a copiar: `src/state/organize-actions.ts` → `newStack` (`UndoStack`, `maxDepth`), `organizeUndo`/`organizeRedo`, `saveOrganize` (`buildCurrentDelta`, `runDocOp`, `concatSource`, generación y `AbortController`), `failSave`, suscripción a `useViewer` (cierre al cambiar de fichero), `organizeParticipant` y `registerOrganizeParticipant`. También `src/state/redact-actions.ts` (PDF-137) para `writeDocument({ kind: 'replace', … })`.
- `src/state/save-actions.ts:36-60` → `DocumentWrite`, `PendingChanges`, `registerPendingChanges` (**solo uno a la vez**), `pendingChanges`; `src/state/choice.ts` → `askChoice`; `src/state/notice.ts` → `showNotice`; `src/state/document-actions.ts:95` → `currentPassword`; `src/state/viewer-store.ts` → `useViewer` (`pdf.doc`, `file`).
- `src/engine/text.ts` → `getPageTextContent`; `src/engine/search-source.ts` (cómo obtener los ítems de una página).
- Op `'verify-signatures'` (`src/core/doc-ops/ops/signature.ts:105`) → `readonly SignatureStatus[]`.

## Qué hay que hacer
1. `src/engine/line-hint.ts` (función pura sobre ítems de pdf.js, coordenadas de usuario de la página):
```ts
export interface TextItemLike { readonly str: string; readonly transform: readonly number[]; readonly width: number; readonly height: number }
export interface LineHint { readonly hint: RectPt; readonly text: string }
export function lineHintAt(items: readonly TextItemLike[], point: readonly [number, number]): LineHint | null;
```
   - `h` de un ítem = `height` o, si es 0, `hypot(t[2], t[3])`; caja `[t[4], t[5] − 0,25h, t[4] + width, t[5] + 0,8h]`. Se ignoran los ítems con `str.trim() === ''` para el clic y los girados (`|t[1]| > 0,01·h`).
   - Ítem pulsado = el primero cuya caja contiene `point`; ninguno → `null`. Misma línea = horizontales con `|t[5] − f0| ≤ 0,25·h0`, ordenados por `t[4]`; desde el pulsado se amplía a izquierda y derecha mientras el hueco entre cajas sea ≤ 1,0·h0.
   - `text` = `str` concatenados; entre dos ítems con hueco > 0,15·h0 y sin espacio en el borde se inserta un espacio. `hint` = `[minX − 0,5, f0 − 0,1·h0, maxX + 0,5, f0 + 0,6·h0]`.
2. `src/state/edit-text-store.ts` (zustand):
```ts
export interface LineEditDraft {
  readonly id: string;              // crypto.randomUUID()
  readonly pageIndex: number;
  readonly hint: RectPt;
  readonly line: EditableLine;      // de 'edit-text-probe'
  readonly original: string;        // texto de pdf.js
  readonly text: string;            // texto nuevo
}
export interface ActiveLineEdit { readonly pageIndex: number; readonly hint: RectPt; readonly line: EditableLine; readonly original: string; readonly editId: string | null }
export interface EditTextState {
  readonly active: boolean;                     // herramienta activa
  readonly edits: readonly LineEditDraft[];
  readonly editing: ActiveLineEdit | null;      // cuadro abierto
  readonly status: 'idle' | 'probing' | 'saving';
}
export const useEditText: UseBoundStore<StoreApi<EditTextState>>;
```
3. `src/state/edit-text-actions.ts`:
```ts
export function setEditTextTool(active: boolean): void;   // al desactivar con el cuadro abierto, lo confirma (commit del texto actual)
export async function beginLineEdit(pageIndex: number, point: readonly [number, number]): Promise<void>;
/** null = válido; si no, el mensaje de error para el cuadro (carácter no admitido). */
export function validateLineText(text: string): string | null;
export function commitLineEdit(text: string): void;
export function cancelLineEdit(): void;
export function removeLineEdit(id: string): void;         // restaura la línea original (deshacible)
export function editTextUndo(): void;
export function editTextRedo(): void;
export async function saveTextEdits(): Promise<SaveResult>;
export function registerEditTextParticipant(): void;      // { id: 'edit-text', order: 42 }
```
   - `beginLineEdit`: (a) si `point` cae dentro de `line.bounds` de una edición de esa página → `editing` con su `editId`, sin consultar al Worker; (b) si `pendingChanges()` no es `null` ni el nuestro → `showNotice(editTextMsg.otherPending)` y nada más; (c) `lineHintAt` con los ítems de la página (`getPageTextContent`); `null` → aviso `noText`; (d) op `'edit-text-probe'` con `{ password: currentPassword(), pageIndex, hint }` sobre `file.source`; `{ issue }` → aviso del mensaje de ese motivo; `{ line }` → `editing`.
   - `commitLineEdit(text)`: `validateLineText` no nulo → no hace nada (el cuadro muestra el error). Si es una edición nueva y `text === original` → solo cierra. Si no, crea o actualiza el borrador; si una edición existente vuelve a `text === original`, se quita. Cada cambio es un paso de `UndoStack<readonly LineEditDraft[]>` (profundidad 100). Con ≥ 1 edición, `registerPendingChanges({ isDirty: () => edits > 0, save: saveTextEdits, discard })`; con 0, `registerPendingChanges(null)`.
   - `validateLineText`: `firstUnmappable(text)`; `'\n'`/`'\r'`/`'\t'` → `editTextMsg.noLineBreaks`; otro → `editTextMsg.unsupportedChar(ch)`.
   - `saveTextEdits`: sin ediciones → `'nothing'`. `askChoice` con título `confirmTitle`, texto `confirmBody(n)` y, si `'verify-signatures'` devuelve ≥ 1 firma, además `signaturesWarning`; botones «Guardar» / «Cancelar» (Cancelar → `'cancelled'` sin cambios). Después `buildCurrentDelta(file)` → op `'edit-text'` con `{ password, edits: [{ pageIndex, hint, text }], now }` sobre `concatSource(file.source, prefijo)` con progreso y cancelación (como `saveOrganize`) → `writeDocument({ kind: 'replace', bytes, password: currentPassword() })` → si `'saved'`/`'downloaded'`: ediciones vacías, `registerPendingChanges(null)`, aviso `done(n)`. Error de op → `failSave(mensaje)`; ediciones intactas.
   - Al cambiar `useViewer.file` (otro documento o reapertura) se vacía todo sin preguntar. Pestañas: `suspend`/`resume` guardan `edits`, `active` y la pila.
4. `src/ui/messages-edit-text.ts` (`editTextMsg`): `tool` «Editar texto», `toolHint` «Doble clic en una línea para corregirla», `noText` «No hay texto en ese punto.», `issue: Record<LineIssue, string>` = `no-text` «No hay texto editable en ese punto.», `unsupported` «Esta línea no se puede editar: usa un tipo de letra o una estructura que la aplicación no sabe modificar sin riesgo.», `rotated` «Solo se pueden editar líneas horizontales.», `invisible` «Esta línea es texto oculto (por ejemplo, de un reconocimiento de texto) y no se puede editar.»; `otherPending` «Guarda o descarta antes los cambios de Organizar páginas o Redactar.»; `noLineBreaks` «El texto editado debe ocupar una sola línea.»; `unsupportedChar(ch)` «El carácter «ch» no se puede escribir con los tipos de letra estándar.»; `confirmTitle` «Guardar texto editado»; `confirmBody(n)` «Se reescribirán N líneas con un tipo de letra estándar (Helvetica, Times o Courier) parecido al original. El texto anterior se eliminará del fichero y no se podrá recuperar.» (1 → «1 línea»); `signaturesWarning` «Este documento tiene firmas digitales: dejarán de ser válidas.»; `save` «Guardar»; `cancel` «Cancelar»; `done(n)` «Se han guardado N líneas editadas.»; `edited(n)` «N líneas editadas»; `restore` «Restaurar texto original»; `editorLabel(page)` «Editar línea de la página N».
5. Tests: `tests/unit/line-hint.test.ts`, `tests/unit/edit-text-actions.test.ts` (Worker simulado con `setDocOpsRunner`).

## Criterios de aceptación
- [ ] `lineHintAt`: tres ítems en la misma línea base (`Texto de`, `búsqueda`, `en la página dos.`, h = 18, huecos de 5 pt) y otro a 22 pt por encima → clic en el segundo devuelve los tres, `text` «Texto de búsqueda en la página dos.» y `hint` con `y` `[674.2, 686.8]` para `f0` = 676; un ítem a 40 pt de hueco no entra; clic fuera de todo → `null`.
- [ ] `beginLineEdit` con probe `{ issue: 'rotated' }` → aviso «Solo se pueden editar líneas horizontales.» y `editing` sigue `null`.
- [ ] `commitLineEdit` con «Hola 😀» → no crea edición; con el mismo texto que el original → no crea edición ni registra cambios pendientes.
- [ ] Deshacer/rehacer: crear, modificar y restaurar una edición → tres pasos que `editTextUndo`/`editTextRedo` recorren en orden; con 0 ediciones no hay cambios pendientes registrados.
- [ ] Con Organizar abierto (cambios pendientes de otro), `beginLineEdit` muestra `otherPending` y no lanza.
- [ ] `saveTextEdits`: «Cancelar» → op no llamada y ediciones intactas; «Guardar» → op `'edit-text'` con los `edits` esperados y `writeDocument` `replace`; con firmas, el texto de la confirmación incluye `signaturesWarning`; error de op → aviso en español y ediciones intactas.
- [ ] Ningún texto de interfaz fuera de `messages-edit-text.ts`. Cobertura ≥ 90 % en `line-hint.ts` y `edit-text-actions.ts`. `pnpm lint && pnpm typecheck && pnpm coverage` con código 0.

## Fuera de alcance
- Componentes, barra, atajos y E2E ([[PDF-147-editar-texto-interfaz]]). Cambiar fuente, tamaño o color de la línea (se conserva el de la original).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-21
- Ficheros cambiados: `apps/lector-pdf/src/engine/line-hint.ts` (nuevo), `apps/lector-pdf/src/state/edit-text-store.ts` (nuevo), `apps/lector-pdf/src/state/edit-text-actions.ts` (nuevo), `apps/lector-pdf/src/ui/messages-edit-text.ts` (nuevo), `apps/lector-pdf/tests/unit/line-hint.test.ts` (nuevo), `apps/lector-pdf/tests/unit/edit-text-actions.test.ts` (nuevo).
- Qué he hecho: `lineHintAt` según la especificación (ítems pulsables sin blancos ni girados, línea por línea base, hueco ≤ 1 altura, espacios entre ítems, `hint` con f0). Store `useEditText` y acciones: localizar la línea (caché de edición existente, `otherPending`, probe), confirmar/cancelar, quitar, deshacer/rehacer (`UndoStack` de 100), `saveTextEdits` (verify-signatures, confirmación, op `edit-text`, `writeDocument` replace, progreso con `beginJob` y cancelación), participante de pestañas (orden 42) y vaciado al cambiar de fichero (sin vaciar en cambios de pestaña, como Redactar).
- Comandos ejecutados y resultado: `pnpm lint` OK (exit 0). `pnpm typecheck` OK (exit 0). `pnpm coverage` exit 0: 323 ficheros, 4153 tests pasan. Cobertura por módulo (medida con `--coverage.include` desde `apps/lector-pdf`, porque la cobertura raíz solo mide `src/core`): `line-hint.ts` 100 % líneas; `edit-text-actions.ts` 99,3 % líneas, 93 % ramas.
- Dudas o cosas que no he podido hacer:
  1. **`setEditTextTool`**: la ficha no dice de dónde sale el texto del cuadro al desactivar la herramienta, y el store no lo guarda. He añadido un parámetro opcional: `setEditTextTool(active, currentText?)`. Si se pasa, confirma el texto (o mantiene el cuadro si no es válido). Sin él, el cuadro se cierra sin confirmar. **PDF-147 debe pasar el texto del cuadro.**
  2. **Mensajes fuera de la lista de la ficha** en `messages-edit-text.ts`: `undoEdit`, `undoRestore` (etiquetas de «Deshacer»), `readFailed` (fallo de pdf.js) y `progress` (texto del progreso). Además, `done(1)` y `edited(1)` van en singular («1 línea editada»).
  3. **Progreso**: `EditTextState` no tiene campo de progreso, así que el progreso va por `beginJob`/`useDocOpJob` (el mismo overlay que Extraer).
  4. **Cambios de otra herramienta**: `registerPendingChanges` lanza si ya hay otro registrado. Si el usuario abre Organizar o Redactar con ediciones de texto pendientes, esa llamada fallará. PDF-147 debe impedirlo o el líder debe decidir cómo tratarlo.
  5. **Árbol de trabajo compartido**: durante la ronda había cambios sin commit de otros agentes (firma digital, `main.tsx`, `App.tsx`). Solo commiteo mis ficheros.

### [revisor] ronda 1 — 2026-10-21 — CAMBIOS
Lint, typecheck y tests de los dos ficheros OK; cobertura line-hint 100 %, edit-text-actions 99,3 % líneas. Resto de criterios cubiertos.
1. `apps/lector-pdf/src/state/edit-text-actions.ts:146-147` — `pdf.doc.getPage`/`getPageTextContent` pueden rechazar y `beginLineEdit` solo tiene `try/finally`: la promesa rechaza (error sin tratar, sin aviso al usuario), y `editTextMsg.readFailed` está definido pero no se usa en ningún sitio — añadir `catch` que haga `log.warn` y `showNotice(editTextMsg.readFailed)` (sin lanzar; solo si `gen === generation`), con un test que simule el fallo de `getTextContent`.
2. (opcional) `beginLineEdit` no impide dos consultas simultáneas (`status === 'probing'`); un doble clic rápido lanza dos probes. Considerar `if (status !== 'idle') return`.

### [programador] ronda 2 — 2026-10-21
- Ficheros cambiados: `apps/lector-pdf/src/state/edit-text-actions.ts`, `apps/lector-pdf/tests/unit/edit-text-actions.test.ts`.
- Qué he hecho: (1) `beginLineEdit` con `catch` que registra `log.warn` y muestra `editTextMsg.readFailed` (solo si la generación no ha cambiado), sin lanzar; test con `getTextContent` rechazado. (2) Opcional: `beginLineEdit` retorna si `status !== 'idle'`, para no lanzar dos consultas en un doble clic; test que comprueba una sola llamada a `edit-text-probe`.
- Comandos ejecutados y resultado: `pnpm lint` exit 0. `pnpm typecheck` exit 0. `pnpm coverage` exit 0: 4158 tests pasan. `line-hint.ts` 100 % líneas; `edit-text-actions.ts` cubierto por la suite. Una ejecución anterior de `pnpm lint`/`pnpm coverage` dio 3 errores de ESLint y 1 test fallido en ficheros de firma digital (de otro agente, sin commit); en la repetición no reaparecieron.
- Dudas o cosas que no he podido hacer: ninguna en esta ronda.

### [revisor] ronda 2 — 2026-10-21 — APROBADO
Lint, typecheck y 43 tests de la ficha OK. El `catch` con `log.warn` y `readFailed` (guardado por generación) y la guarda `status !== 'idle'` están en `edit-text-actions.ts:127,172-175`. 0 problemas. Nota para PDF-147 (de la dudas del programador): pasar el texto del cuadro a `setEditTextTool` e impedir abrir Organizar/Redactar con ediciones pendientes.

### [tester] ronda 1 — 2026-10-21 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| lineHintAt, probe rotated, commit emoji/igual, undo/redo 3 pasos, otherPending, saveTextEdits (cancelar/guardar/firmas/error) | OK | `vitest run line-hint + edit-text-actions`: 43 tests pasan |
| Sin textos fuera de messages-edit-text.ts | OK | grep sin coincidencias en `edit-text-actions.ts` |
| Cobertura ≥ 90 % | OK | `line-hint.ts` 100 % líneas; `edit-text-actions.ts` ≥ 99 % líneas (módulo conjunto 99,5 %) |
| lint + typecheck + coverage | OK | exit 0; resumen global líneas 98,34 % |
Tests añadidos: ninguno (la cobertura de la ficha es suficiente). Rendimiento: no aplica (lógica sin UI).
