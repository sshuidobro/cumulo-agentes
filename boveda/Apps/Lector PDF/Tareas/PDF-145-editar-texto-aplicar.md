---
tipo: tarea
id: PDF-145
titulo: Editar texto - aplicar las líneas editadas y operaciones del Worker (núcleo)
app: pdf
estado: en-revision
depende_de: [PDF-144]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion]
---

# PDF-145 · Editar texto: aplicar las líneas editadas y operaciones del Worker (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0042-editar-texto-linea-simple]], [[ADR-0039-redaccion-real]], [[ADR-0037-proteger-reescritura-aes256]], [[ADR-0034-operaciones-en-worker]] · Antes: [[PDF-144-editar-texto-localizar-linea]] · Siguen: [[PDF-146-editar-texto-estado]]

## Objetivo
Dadas varias líneas editadas (página, caja de la línea y texto nuevo), borrar de verdad sus glifos sin mover el resto, escribir el texto nuevo con la fuente estándar, el tamaño y el color de la línea original en su misma línea base, y devolver el fichero **reescrito entero** (sin revisiones antiguas con el texto viejo). Más una operación para consultar si una línea es editable.

## Contexto
- [[ADR-0042-editar-texto-linea-simple]].
- `src/core/edit-text/` (PDF-144) → `locateLine`, `findEditableLine`, `standardBaseFont`, `EditableLine`, `LineIssue`; `src/core/annotations/winansi.ts` → `toWinAnsi`, `firstUnmappable`.
- `src/core/content/index.ts` → `interpretPage`, `removeGlyphs`, `serializeContent`, `ContentOp` (PDF-143).
- Patrón a copiar: `src/core/redact/apply.ts:134-171` → `buildRedactionUpdate`/`writeRedaction` (delta: `startDelta`, `createAllocator`, `catalogRef`, `reserveXref`, `finishDelta`) y `:673-680` → `flateStream`, `opOf`.
- `src/core/pdf/page-content.ts` → `effectiveResources`, `freeResourceName`, `withResource`; `src/core/pdf/objects.ts` → `dict`, `name`, `bytesString`, `withEntries`.
- Ops del Worker: `src/core/doc-ops/ops/signature.ts` (op en fichero propio, `openForSave`) y `src/core/doc-ops/ops/index.ts:625-700` → `parseRedactArgs`, op `redact` (delta → `concatSource` → `openForSave` → `rewriteDocument` con `keepEncryption: true`), `:703` → `DOC_OPS`.
- `src/core/errors.ts` → códigos y mensajes.

## Qué hay que hacer
1. `errors.ts`: códigos nuevos con su mensaje:
   - `'edit-line-missing'`: «No se ha podido guardar: una de las líneas editadas ya no se encuentra en la página. Vuelve a editarla.»
   - `'edit-text-invalid'`: «No se puede guardar el texto editado: contiene caracteres que los tipos de letra estándar no admiten o saltos de línea.»
2. `src/core/edit-text/apply.ts` (nuevo):
```ts
export interface LineEdit {
  readonly pageIndex: number;
  readonly hint: RectPt;   // la misma caja que se usó en findEditableLine
  readonly text: string;   // una línea; '' = borrar la línea
}
export interface EditTextInput {
  readonly source: ByteSource; readonly reader: ObjectReader;
  readonly edits: readonly LineEdit[];
  readonly now: string; readonly random?: RandomBytes; readonly signal?: AbortSignal;
}
export async function buildTextEditUpdate(input: EditTextInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>>;
```
   - Validación previa: `pageIndex` entero en rango, `hint` finito y de área > 0 → si no, `RangeError` (bug de la interfaz). `firstUnmappable(text) !== null` → `err(pdfError('edit-text-invalid'))` (los saltos de línea ya cuentan como no representables).
   - Ediciones agrupadas por página (ascendente); en cada página, en el orden recibido. Señal abortada entre páginas → `err(pdfError('cancelled'))`.
   - Por página: `interpretPage` (lanza → `edit-line-missing`) y `effectiveResources` una vez; para cada edición `locateLine(reader, resources, content, hint)`; si no es `ok` → `err(pdfError('edit-line-missing'))`. Dos ediciones con algún glifo en común → `RangeError`.
   - `ops = removeGlyphs(content, (_, index) => quitados.has(index))`.
   - Fuentes: un objeto por nombre estándar en **todo** el incremento (`<< /Type /Font /Subtype /Type1 /BaseFont /<standardBaseFont(style.font)> /Encoding /WinAnsiEncoding >>`); en cada página, nombre de recurso `freeResourceName(res, 'Font', 'SuiteEd')` + `withResource`, uno por fuente usada en esa página.
   - Contenido nuevo (un único flujo Flate que sustituye a `/Contents`): `q`, …`ops`, `Q` y, por cada edición con `text !== ''`: `BT`, `/<res> <fontSize> Tf`, `0 Tc`, `0 Tw`, `100 Tz`, `0 Ts`, `0 Tr`, `<r> <g> <b> rg`, `1 0 0 1 <origin.x> <origin.y> Tm`, `<bytesString(toWinAnsi(text), false)> Tj`, `ET` (con `serializeContent`).
   - Página: `withEntries(page, { Contents: ref, Resources: res })`. Las anotaciones, imágenes y demás páginas no se tocan. Sin ediciones → delta vacío.
3. `src/core/doc-ops/ops/edit-text.ts` (nuevo), registrado en `DOC_OPS`:
   - `'edit-text-probe'`: args `{ password: string | null; pageIndex: number; hint: RectPt }` → `ok<EditTextProbe>` con `export type EditTextProbe = { readonly line: EditableLine } | { readonly issue: LineIssue }`.
   - `'edit-text'`: args `{ password: string | null; edits: readonly LineEdit[]; now: string }` → `buildTextEditUpdate` → `concatSource(fuente, delta)` → `openForSave` → `rewriteDocument({ encryption: null, keepEncryption: true, now, signal, onProgress })` → `ok({ bytes })`, igual que la op `redact`.
   - Argumentos con forma incorrecta → `TypeError` con mensaje (como `parseRedactArgs`).
4. `src/core/edit-text/index.ts` exporta `buildTextEditUpdate`, `LineEdit`.
5. Tests `tests/unit/edit-text/apply.test.ts` (pdf.js `loadPdf` en Node, `qpdfCheck` y `run` de `tests/support/qpdf.ts`, `pdftotext` por `node:child_process`) y `tests/unit/doc-ops/edit-text-op.test.ts`.

## Criterios de aceptación
- [ ] **Criterio original**: `basic-5.pdf`, página índice 1, `hint` `[71, 674, 500, 687]`, texto «Texto de búsqueda en la hoja dos.» → op `'edit-text'`; `pdftotext` de la página 2 contiene «Texto de búsqueda en la hoja dos.» y no «la página dos»; la salida de `qpdf --qdf --object-streams=disable` no contiene `gina dos`.
- [ ] pdf.js `getTextContent()` de la página 2: el ítem nuevo tiene `transform[4]` = 72 ± 0,5, `transform[5]` = 676 ± 0,5 y altura 18 ± 0,1; los ítems de las líneas 720 y 698 conservan su `transform` exacto; `getAnnotations()` igual que antes.
- [ ] La página 2 tiene en `/Resources /Font` un `SuiteEd` con `/BaseFont /Helvetica`; dos ediciones en páginas 1 y 3 con la misma fuente → un solo objeto de fuente nuevo en el fichero.
- [ ] Texto `''` → la línea desaparece de `pdftotext` y no se escribe `BT` nuevo.
- [ ] Color: línea con `0 0 1 rg` → el contenido nuevo tiene `0 0 1 rg` antes de su `Tj`. Fuente `Georgia-Bold` → recurso con `/BaseFont /Times-Bold`.
- [ ] «Hola 😀» → `edit-text-invalid` y nada escrito; `hint` que ya no tiene texto → `edit-line-missing`.
- [ ] `encrypted-aes-256.pdf` (`usuario`) → resultado cifrado, abre con `usuario`, contiene el texto nuevo y no el viejo; `qpdf --check --password=usuario` 0.
- [ ] El resultado es una reescritura completa (una sola xref, sin `/Prev`); `qpdf --check` 0 en todos los casos.
- [ ] `'edit-text-probe'` sobre la línea de `basic-5.pdf` → `{ line }` con `origin` `[72, 676]`; sobre una zona vacía → `{ issue: 'no-text' }`.
- [ ] Cobertura ≥ 90 % en `src/core/edit-text/apply.ts` y `src/core/doc-ops/ops/edit-text.ts`. `pnpm lint && pnpm typecheck && pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz ([[PDF-146-editar-texto-estado]], [[PDF-147-editar-texto-interfaz]]). Reflujo, fuente original, editar texto dentro de Form XObjects o girado.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/edit-text/apply.ts` (nuevo), `apps/lector-pdf/src/core/edit-text/index.ts`, `apps/lector-pdf/src/core/errors.ts` (`edit-line-missing`, `edit-text-invalid`), `apps/lector-pdf/src/core/doc-ops/ops/edit-text.ts` (nuevo), `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (registro en `DOC_OPS`), `apps/lector-pdf/tests/unit/edit-text/apply.test.ts` (nuevo), `apps/lector-pdf/tests/unit/doc-ops/edit-text-op.test.ts` (nuevo).
- Qué he hecho: `buildTextEditUpdate` agrupa ediciones por página, localiza cada línea con `locateLine`, quita sus glifos con `removeGlyphs` y escribe un único `/Contents` Flate con el texto nuevo (fuente estándar compartida por incremento, `SuiteEd` por página). Ops `edit-text-probe` y `edit-text` (reescritura completa con `keepEncryption`). Un `RangeError` se propaga sin convertirlo en error de usuario.
- Comandos ejecutados y resultado: `pnpm lint` OK. `pnpm typecheck` OK en `apps/lector-pdf`. `pnpm coverage`: 299 ficheros y 3889 tests en verde; `edit-text/apply.ts` 97,4 % líneas / 91,9 % ramas; `doc-ops/ops/edit-text.ts` 100 % líneas / 94,3 % ramas. No he ejecutado `qpdf` fuera de los tests (los tests lo usan y pasan).
- Dudas o cosas que no he podido hacer: en el árbol de trabajo hay cambios ajenos sin commitear (`OrganizeView`, `OrganizeCell`, `grid.ts`, `PDF-126`) que en un momento hicieron fallar `typecheck` (`OrganizeView.tsx`, `onPointerDown`); no los he tocado y el commit incluye solo mis ficheros. Los criterios de aceptación están cubiertos por los tests, pero las casillas de la ficha no las he marcado (lo hará el tester). Caso «ediciones con página sin diccionario» cubierto solo de forma parcial (rama `PdfSyntaxError`).
