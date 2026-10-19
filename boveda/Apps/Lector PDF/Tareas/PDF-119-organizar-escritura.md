---
tipo: tarea
id: PDF-119
titulo: Organizar - escribir el plan (páginas en blanco y limpieza de formularios)
app: pdf
estado: pendiente
depende_de: [PDF-053]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-119 · Organizar: escribir el plan (páginas en blanco y limpieza de formularios)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0028-reescribir-pdfs]], [[ADR-0035-organizar-en-la-app]] · Antes: [[PDF-052-organizar-adr]], [[PDF-053-organizar-paginas]]

## Objetivo
`buildOrganizeUpdate` escribe en un solo incremento el plan de la vista Organizar: páginas originales reordenadas y giradas, **páginas en blanco** nuevas y, para las páginas borradas, sus widgets fuera de `/AcroForm`. El árbol de páginas de PDF-052 se separa en una función reutilizable que no abre ni cierra el incremento.

## Contexto
- `src/core/pdf/page-tree.ts` completo (352 líneas; se refactoriza): `writeUpdate`, `writeRotationsOnly`, `writeReordered`, `buildTree`, `isValidList`.
- `src/core/pdf/delta-writer.ts` → `startDelta`, `reserveXref`, `finishDelta`, `DeltaWriter`.
- `src/core/organize/plan.ts` → `SaveSlot` (PDF-053).
- `src/core/pdf/incremental.ts` → `toSaveError`.
- Tests de referencia: `tests/unit/pdf/page-tree.test.ts` (deben seguir pasando **sin cambios**).
- Fixtures: `form.pdf`, `form-full.pdf` (campos en varias páginas: comprobar con `qpdf --json` qué página tiene cada widget antes de escribir los tests).

## Qué hay que hacer
1. `src/core/pdf/page-tree-layout.ts` (nuevo): mueve `TreeChild`, `TreeNode`, `buildTree` (renombrada `planPageTree(slotCount: number): TreeNode`) y `PAGE_TREE_FANOUT` (reexportado desde `page-tree.ts` para no romper importaciones). Sin cambios de comportamiento.
2. `src/core/pdf/page-tree.ts`:
```ts
export interface ObjectAllocator { next(): PdfRef; readonly nextNum: number }
export function createAllocator(first: number): ObjectAllocator;
/** Página que no está en el fichero abierto. `dict` sin `/Parent`, con `/MediaBox` y `/Resources` propios. */
export interface AddedPage { readonly ref: PdfRef; readonly dict: PdfDict }
export interface PageTreeWrite {
  readonly reader: ObjectReader;
  readonly writer: DeltaWriter;
  readonly alloc: ObjectAllocator;
  /** `source` en [0, n) = página original; en [n, n + added.length) = `added[source - n]`. */
  readonly pages: readonly PageSlot[];
  readonly added?: readonly AddedPage[];
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}
/** Escribe giros o árbol nuevo en `writer`. No llama a `startDelta` ni `finishDelta`. Devuelve las páginas escritas. */
export async function writePageTree(w: PageTreeWrite): Promise<Result<number>>;
```
   - `isValidList` admite `source < n + added.length`. El caso «solo giros» solo se usa si no hay `added` usadas (todas las `source` son `0..n-1` en orden).
   - Las páginas añadidas se escriben con su `ref` y `withEntries(dict, { Parent, Rotate: rotate === 0 ? undefined : rotate })`.
   - Los nodos nuevos toman números de `alloc.next()`.
   - `buildPageTreeUpdate` queda como envoltorio: `startDelta` → `createAllocator(reader.xref.size)` → `writePageTree` → `reserveXref(reader, alloc.nextNum)` → `finishDelta`. Mismos bytes de salida que hoy (los tests golden/actuales lo comprueban).
3. `src/core/organize/forms-cleanup.ts`:
```ts
/** Quita de /AcroForm los widgets de `removedPages` (refs de páginas). Escribe solo los objetos que cambian. Devuelve los widgets quitados. */
export async function removePageWidgets(reader: ObjectReader, writer: DeltaWriter, removedPages: readonly PdfRef[], catalog: PdfRef): Promise<number>;
```
   - Widgets = refs de `/Annots` (directo o indirecto) de las páginas borradas cuyo diccionario tiene `/Subtype /Widget`. Si no hay ninguno → no escribe nada.
   - Recorre `/AcroForm /Fields` (máx. 32 niveles, cada nodo una vez): un nodo cuyo número es un widget quitado desaparece; un nodo con `/Kids` se filtra recursivamente y, si se queda sin hijos (y los tenía), desaparece; si pierde algunos, se reescribe con su número y `/Kids` nuevo (si `/Kids` era un array indirecto, se reescribe ese array).
   - `/Fields` y `/CO` filtrados igual. Si `/AcroForm` es indirecto se reescribe ese objeto; si es directo, se reescribe el catálogo (mismo número) con el `/AcroForm` nuevo; si `/Fields` es un array indirecto, se reescribe el array.
4. `src/core/organize/save.ts`:
```ts
export interface OrganizeInput {
  readonly source: ByteSource;
  readonly reader: ObjectReader;          // openForSave sobre `source`
  readonly slots: readonly SaveSlot[];
  readonly now: string;
  readonly random?: RandomBytes;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}
export async function buildOrganizeUpdate(input: OrganizeInput): Promise<Result<PageTreeOutput>>;
```
   - `slots` vacío, `source` repetida o fuera de rango, giro no válido, `blank` con medidas fuera de `[1, 14400]`, o cualquier `imported` → `err(pdfError('organize-invalid'))` (los `imported` los habilita [[PDF-055-insertar-combinar|PDF-055]]).
   - Páginas en blanco: `alloc.next()` cada una; `dict({ Type: /Page, MediaBox: [0, 0, width, height], Resources: dict({}) })` como `AddedPage`; su `PageSlot.source` = `n + k`.
   - Orden: `startDelta` → árbol (`writePageTree`) → `removePageWidgets` con las refs originales no presentes en `slots` → `reserveXref` + `finishDelta`. Sin cambios (plan idéntico al documento) → delta vacío.
   - Excepciones → `toSaveError`.
5. Tests `tests/unit/organize/save.test.ts` (pdf.js de `loadPdf` en Node y `qpdfCheck`, como `page-tree.test.ts`).

## Criterios de aceptación
- [ ] `tests/unit/pdf/page-tree.test.ts` y `delta-writer-golden.test.ts` pasan sin tocar.
- [ ] `basic-5.pdf` + `[original 0, blank 595×842, original 1..4]` → pdf.js da 6 páginas; la 2 mide 595×842 y no tiene texto; `qpdf --check` 0.
- [ ] Blank girada 90 → `getPage(n).rotate === 90`.
- [ ] `encrypted-aes-256.pdf` (`usuario`) + página en blanco al final → 6 páginas al abrir con la contraseña; `qpdf --check --password=usuario` 0.
- [ ] `form-full.pdf`: borrar una página con widgets → `qpdf --json` del resultado no tiene en `/AcroForm /Fields` (ni en `/Kids` de ningún campo) ninguna ref a esos widgets; los campos de las demás páginas siguen y pdf.js `getFieldObjects()` no lista los quitados.
- [ ] Un campo con dos widgets en páginas distintas (créalo con `tests/fixtures/pdf-builder.ts` en el test): borrar una de las páginas conserva el campo con un único hijo.
- [ ] `outline.pdf` borrando la página 3 → los enlaces del índice a páginas que siguen resuelven a su nuevo índice (como en PDF-052).
- [ ] Entradas no válidas (incluido un `imported`) → `organize-invalid`; `signal` abortado → `cancelled`.
- [ ] `pnpm perf` (`tests/perf/organize.perf.test.ts`): `pages-100000.pdf` con una página en blanco insertada en la mitad < 15 000 ms (mismo presupuesto que borrar en PDF-052).
- [ ] Cobertura ≥ 90 % de líneas en `organize/save.ts`, `organize/forms-cleanup.ts` y `pdf/page-tree.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Páginas de otro PDF ([[PDF-055-insertar-combinar]]). Limpiar el índice de entradas a páginas borradas ([[ADR-0035-organizar-en-la-app]] punto 3). Estructura etiquetada (`/StructTreeRoot`) de páginas borradas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
