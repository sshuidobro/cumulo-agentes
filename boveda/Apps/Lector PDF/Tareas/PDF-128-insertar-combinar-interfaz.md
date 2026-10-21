---
tipo: tarea
id: PDF-128
titulo: Insertar desde archivo y combinar archivos - interfaz
app: pdf
estado: hecha
depende_de: [PDF-055, PDF-127, COM-019]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-5, organizar, ui]
---

# PDF-128 · Insertar desde archivo y combinar archivos: interfaz

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] · Antes: [[PDF-055-insertar-combinar]], [[PDF-127-extraer-dividir-interfaz]], [[COM-019-importar-varios-ficheros]]

## Objetivo
En la vista Organizar, «Insertar desde archivo…» añade las páginas de otro PDF (también protegido) en la posición elegida, con miniaturas, deshacer y guardado. «Combinar archivos…» (menú y pantalla de inicio) junta varios PDF en uno nuevo, en el orden que elija el usuario, y lo abre.

## Contexto
- Ops `'organize'` (con importados) y `'combine'` (PDF-055); `'page-rotations'` (PDF-118).
- `src/state/organize-actions.ts` (PDF-124) y `src/core/organize/plan.ts` → `insertImportedCommand`.
- `src/ui/organize/OrganizeView.tsx`, `OrganizeCell.tsx`, `OrganizeToolbar.tsx` (PDF-125/126/127).
- `src/state/password-prompt.ts` → `askPassword`; `src/engine` → `loadPdf` (miniaturas de los importados con `memorySource`).
- `services().platform.importFile` / `importFiles` (COM-018/019), `saveAs`; `src/state/document-actions.ts` → `openRequested` (abrir un `OpenedFile`, con pestañas), `PDF_FILTERS`.
- `src/state/extract-actions.ts` → `useDocOpJob`, `cancelDocOp`; `src/ui/kit/DocOpProgress.tsx` (PDF-127).
- `src/ui/open/EmptyState.tsx`, `src/ui/toolbar/DocumentMenu.tsx`.

## Qué hay que hacer
1. Insertar (en `organize-actions.ts`):
```ts
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
export async function insertFromFile(where: 'before' | 'after'): Promise<void>;
```
   - `importFile(PDF_FILTERS, MAX_IMPORT_BYTES)` → op `'page-rotations'` sobre los bytes con contraseña `null`; `save-wrong-password` → `askPassword(nombre)` y reintenta (cancelar → nada); otro error → aviso `organizeMsg.importFailed(nombre)`; `out-of-range` → aviso `organizeMsg.importTooBig`.
   - Se guarda en el estado `imported: readonly { name; bytes; password; doc: PDFDocumentProxy }[]` (el `doc` de pdf.js se carga con `loadPdf(memorySource(bytes), …)` para las miniaturas y se destruye al cerrar la vista o la pestaña) y se ejecuta `insertImportedCommand(at, docIndex, rotations)`.
   - `saveOrganize` pasa los bytes de los importados como fuentes `1..k` y sus contraseñas.
   - El participante de pestañas de la vista incluye `imported` en su instantánea; `dispose` destruye sus `doc`.
2. `OrganizeCell.tsx`: los huecos `imported` dibujan la página con el `doc` importado y muestran debajo el nombre corto del fichero (`title` con el nombre completo).
3. `OrganizeToolbar.tsx`: el menú «Insertar» gana «Desde archivo…, antes / después de la selección».
4. Combinar: `src/state/combine-actions.ts`:
```ts
export interface CombineItem { readonly id: string; readonly name: string; readonly pages: number; readonly source: 'current' | { readonly bytes: Uint8Array; readonly password: string | null } }
export const useCombineDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly items: readonly CombineItem[] }>>;
export function openCombineDialog(): void;        // si hay documento abierto, lo añade primero (con sus cambios sin guardar)
export async function addCombineFiles(): Promise<void>;   // importFiles(PDF_FILTERS, MAX_IMPORT_BYTES, 50); pide contraseña de los protegidos
export function moveCombineItem(id: string, delta: -1 | 1): void;
export function removeCombineItem(id: string): void;
export async function combineFiles(): Promise<'saved' | 'downloaded' | 'cancelled' | 'failed'>;
```
   - Fuente del documento actual: `concatSource(file.source, prefix)` como en PDF-127.
   - `combineFiles`: al menos 2 elementos (si no, el botón está deshabilitado) → op `'combine'` con progreso (`useDocOpJob`) → `saveAs('<primero>-combinado.pdf', PDF_FILTERS, { kind: 'bytes', bytes })` → `'saved'` → se abre con `openRequested(file)` (pestaña nueva si hay documento); `'downloaded'` → aviso.
5. `src/ui/organize/CombineDialog.tsx` (+ CSS, `lazy`): lista (`role="listbox"`) con nombre, «N páginas», botones «Subir», «Bajar», «Quitar» (con `aria-label` que incluye el nombre); Alt+↑/↓ mueve el elemento con foco; «Añadir archivos…»; «Combinar» (primario); aviso `organizeMsg.newIsUnprotected` si alguno estaba protegido.
6. Entradas: `DocumentMenu.tsx` → «Combinar archivos…»; `EmptyState.tsx` → botón secundario «Combinar archivos…».
7. `organizeMsg`: `insertFromFile`, `importFailed(name)`, `importTooBig` «El fichero es demasiado grande (máximo 512 MB).», `combine` «Combinar archivos…», `combineTitle` «Combinar archivos», `addFiles` «Añadir archivos…», `moveUp`, `moveDown`, `remove`, `pagesOf(n)`, `combineAction` «Combinar», `combined(name)`, `progressCombine(done, total)`.
8. Tests: `tests/unit/combine-actions.test.ts`, casos nuevos en `tests/unit/organize-actions.test.ts`, `tests/ui/combine-dialog.test.tsx`, `tests/e2e/insert-combine.spec.ts`.

## Criterios de aceptación
- [ ] E2E: `basic-5.pdf` → Organizar → seleccionar la 2 → Insertar desde archivo, después → `outline.pdf` → 35 miniaturas, las 3-32 con el nombre «outline.pdf» → Guardar → el visor tiene 35 páginas y la 3.ª es «Página 1 de 30».
- [ ] E2E: insertar `encrypted-aes-256.pdf` pide su contraseña; con `usuario` inserta 5 páginas legibles; Cancelar no inserta nada.
- [ ] E2E: Ctrl+Z tras insertar quita las páginas insertadas; guardar sin ellas no cambia el número de páginas.
- [ ] E2E (**criterio original**): Combinar archivos con `basic-5.pdf` abierto + `outline.pdf` → se abre una pestaña con 35 páginas y el índice con las ramas «basic-5» y «outline».
- [ ] E2E: desde la pantalla de inicio, «Combinar archivos…» con dos ficheros, reordenados con «Bajar» → el resultado sigue el orden de la lista.
- [ ] Unit: más de 50 ficheros o uno > 512 MB → aviso y nada añadido; error de op → aviso en español; cancelar → nada guardado.
- [ ] Teclado y accesibilidad: lista operable solo con teclado; axe sin violaciones en diálogo y vista; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Combinar ficheros que no sean PDF (imágenes: [[PDF-129-pdf-desde-imagenes-interfaz]]). Arrastrar ficheros al diálogo. Elegir solo un rango de cada fichero al combinar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `src/state/import-pdf.ts` (nuevo: comprobar y abrir un PDF importado, contraseña), `src/state/combine-actions.ts` (nuevo), `src/state/organize-actions.ts` (`insertFromFile`, `MAX_IMPORT_BYTES`, importados en el guardado y en pestañas), `src/state/organize-store.ts` (`imported`), `src/state/extract-actions.ts` (exporta `beginJob`, `endJob`, `jobOptions`, `sourceWithChanges`), `src/ui/organize/CombineDialog.tsx` + `.module.css` (nuevos), `src/ui/organize/OrganizeCell.tsx`, `OrganizeToolbar.tsx`, `OrganizeView.module.css`, `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/open/EmptyState.tsx`, `open.module.css`, `src/ui/App.tsx`, `src/ui/messages-organize.ts`; tests `tests/unit/combine-actions.test.ts` (nuevo), `tests/unit/organize-actions.test.ts` (casos nuevos), `tests/ui/combine-dialog.test.tsx` (nuevo), `tests/e2e/insert-combine.spec.ts` (nuevo, 6 casos).
- Qué he hecho: «Desde archivo…» (antes/después del foco, o al final) con contraseña, miniaturas y deshacer; «Combinar archivos» desde el menú y la pantalla de inicio, con lista ordenable (botones y Alt+↑/↓), guardado con el diálogo del sistema y progreso. Los importados viajan como fuentes `1..k` en `organize` y se liberan al cerrar la vista o la pestaña.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` OK (304 ficheros, 3943 tests); `pnpm --filter lector-pdf bundle:check` OK (596 912 de 600 000 bytes, margen de ~3 KB); `pnpm --filter lector-pdf e2e` (completo): 349 pasan, 1 falla: `iteration4-performance.spec.ts` «cifrado AES-256 … p1 pintada ≤ 1,5 ×» (medido 1,95). Falla igual sin mis cambios (`git stash`), es previa y no la he tocado. E2E `insert-combine.spec.ts`: 6/6.
- Dudas o cosas que no he podido hacer:
  1. `memorySource` de la ficha no existe en la app: uso `bytesSource` (`core/doc-ops/bytes.ts`).
  2. `ImportedDoc` lleva además `close` (libera el `LoadedPdf`) junto a `doc`.
  3. Límite de 50 ficheros contando el documento abierto, con el mensaje nuevo `organizeMsg.combineLimit` (el selector devuelve `out-of-range` tanto por número como por tamaño y no se distingue). Mensajes añadidos: `importFailed`, `combineHint`, `pagesOf`, `fromFileBefore/After` (en lugar de un único `insertFromFile`).
  4. En la web, «Guardar como» descarga y no abre la pestaña: el criterio «se abre una pestaña con 35 páginas» lo cubre el test unitario de la ruta `saved`; el E2E comprueba el PDF descargado (35 páginas, ramas «basic-5» y «outline»).
  5. Tema oscuro: no tengo test específico; queda sin verificar.
  6. Ajustes por axe: los botones de fila van fuera del `listbox`, y la celda importada incluye el nombre del fichero en su nombre accesible.

### [revisor] ronda 1 — 2026-10-20 — CAMBIOS
Comprobado: lint, typecheck y coverage OK (98,3 % líneas); bundle:check OK (591 097 de 600 000); `insert-combine.spec.ts` 6/6. Lógica de `combine-actions`, `import-pdf` e `insertFromFile` correcta (generación, liberación de `doc`, cancelar, límite 50/512 MB).
1. `tests/e2e/insert-combine.spec.ts:192` — el criterio «axe sin violaciones en diálogo y vista; tema oscuro» no está cubierto: el test de axe corre solo en tema claro y el programador lo declara «sin verificar» — repetir el test de axe (diálogo «Combinar archivos» y vista Organizar con importado) en claro y oscuro con `page.emulateMedia({ colorScheme })` como en `tests/e2e/organize-a11y.spec.ts:29`, y corregir los contrastes de `CombineDialog.module.css` y del nombre de fichero de `OrganizeCell` si fallan.
2. (opcional) Ficha, criterio `e2e` con código 0: el fallo de `iteration4-performance.spec.ts` (AES-256 ≤ 1,5×) se dice previo; confirmar en la ronda siguiente que sigue siendo ajeno al cambio o anotarlo para el líder.

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/insert-combine.spec.ts` (el test de axe y teclado se repite en tema claro y oscuro con `colorScheme`, comprobando `prefers-color-scheme` como en `organize-a11y.spec.ts`).
- Qué he hecho: atendido el comentario 1 del revisor. Sin cambios de CSS: axe no encuentra violaciones en el diálogo ni en la vista con tema oscuro, así que no hizo falta corregir contrastes.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf e2e -- tests/e2e/insert-combine.spec.ts` 7/7 OK (incluye claro y oscuro); `pnpm lint` OK; `pnpm typecheck` OK.
- Dudas o cosas que no he podido hacer: el comentario 2 (opcional) sobre `iteration4-performance.spec.ts` no se ha tocado en esta ronda; no está relacionado con esta ficha.

### [revisor] ronda 2 — 2026-10-20 — APROBADO
Lint y typecheck OK; `insert-combine.spec.ts` 7/7 (axe y teclado en claro y oscuro con `prefers-color-scheme` verificado). Comentario 1 resuelto. El fallo previo de `iteration4-performance.spec.ts` (AES-256) no pertenece a esta ficha (PDF-148 lo trata); el tester debe confirmarlo.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| E2E insertar outline.pdf (35 pág., «Página 1 de 30» en la 3.ª), cifrado AES-256 (cancelar / `usuario`), Ctrl+Z, combinar (35 pág., ramas basic-5 y outline), inicio con «Bajar» | OK | `insert-combine.spec.ts` 7/7 sobre HEAD limpio (worktree) |
| Axe y teclado, tema claro y oscuro | OK | tests 6 y 7 del mismo spec |
| Unit/UI (límites, errores, cancelar) | OK | `pnpm coverage`: 98,31 % líneas, todo verde |
| lint, typecheck | OK | 0 avisos |
| bundle:check | OK en HEAD (596 912 / 600 000). Con el árbol de trabajo actual da 627 248: lo causan los cambios sin commitear de PDF-148 (`password-probe.ts`, `document-actions.ts`), ajenos a esta ficha. Aviso para el líder/PDF-148. |
| Fallo previo `iteration4-performance` AES-256 | Ajeno (PDF-148) | No tocado por esta ficha |
Tests añadidos: ninguno adicional. Rendimiento: sin presupuesto propio.
