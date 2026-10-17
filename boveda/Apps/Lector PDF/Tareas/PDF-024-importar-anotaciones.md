---
tipo: tarea
id: PDF-024
titulo: Importar las anotaciones existentes del PDF al modelo (y las no soportadas como solo lectura)
app: pdf
estado: en-revision
depende_de: [PDF-023, PDF-005, PDF-003]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, motor, anotaciones]
---

# PDF-024 · Importar anotaciones existentes

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Leer con pdf.js las anotaciones que ya tiene el PDF (de Adobe, de otros programas o guardadas por nosotros): las de tipos soportados se convierten al modelo de PDF-023 (línea base editable); las demás (formas, sellos, etc.) se exponen como "ajenas" de solo lectura para el panel de comentarios. Se puede leer una página o recorrer todo el documento por lotes.

## Contexto
- Leer: `src/core/annotations/model.ts` (PDF-023), `src/engine/page-dims.ts` (patrón de escaneo por lotes), [[ADR-0009-anotaciones-escritor-incremental]].
- Campos de `page.getAnnotations()` comprobados por el líder (pdf.js 6.4.299): `id` (`'9R'`), `subtype`, `rect`, `quadPoints` (`Float32Array`, 8 por cuadrilátero, orden Z), `color` (`Uint8ClampedArray` 0-255 o `null`), `opacity`, `contentsObj.str`, `titleObj.str`, `modificationDate`/`creationDate` (cadenas `D:...` o `null`), `inkLists` (array de `Float32Array`), `borderStyle.width`, `name` (icono de la nota), `open`, `popupRef` (`'11R'` o `null`), `textContent` (FreeText, array de líneas), `defaultAppearanceData` (`{ fontSize, fontName, fontColor }`, color 0-255), `annotationFlags`. **No** expone `/NM`.
- Tipos soportados: `Highlight`, `Underline`, `StrikeOut`, `Text`, `FreeText`, `Ink`. Se ignoran del todo: `Popup` (se asocia vía `popupRef`), `Link` y `Widget` (tienen su propia capa). El resto son "ajenas".

## Qué hay que hacer
1. (Usa `parsePdfDate` de `src/core/pdf-date.ts`, creado en PDF-023.)
2. `src/core/annotations/import.ts` (puro, recibe objetos planos):
   ```ts
   export interface RawAnnotation { readonly [k: string]: unknown }   // lo que devuelve pdf.js
   export interface ForeignAnnotation { readonly id: string; readonly pageIndex: number; readonly subtype: string; readonly rect: RectPt; readonly contents: string; readonly author: string; readonly modified: string | null }
   export interface ImportedPage { readonly supported: readonly Annotation[]; readonly foreign: readonly ForeignAnnotation[] }
   export function importPageAnnotations(pageIndex: number, raws: readonly RawAnnotation[], fallbackDate: string): ImportedPage;
   ```
   Reglas: `id` = `'ref:' + raw.id`; `origin = { kind: 'file', ref: parsea '<num>R' o '<num>R<gen>', popupRef }`; `rect` normalizado; color `/255` (si `null`: amarillo `[1, 0.92, 0.23]` para resaltado, negro para el resto); `opacity` (por defecto 1); `contents`, `author` (por defecto `''`); `modified` = `parsePdfDate(modificationDate) ?? fallbackDate`; `created` = `parsePdfDate(creationDate)`. Marcado de texto sin `quadPoints` válidos → `quads = [quadFromRect(rect)]`. Nota: `icon` = `name` si es un `NoteIcon` válido, si no `'Note'`; `open` = `open === true`. Texto libre: `contents` = `contentsObj.str` o, si está vacío, `textContent.join('\n')`; `fontSize` = `defaultAppearanceData.fontSize` o 12; `textColor` de `fontColor` o negro. Tinta: `paths` desde `inkLists`; `width` = `borderStyle.width` o 1. Cualquier dato con tipos inesperados → la anotación pasa a "ajena" (nunca lanza). Anotaciones con la bandera *Hidden* (bit 2 de `annotationFlags`) se ignoran.
3. `src/engine/annotations-import.ts`:
   ```ts
   export async function readPageAnnotations(page: PDFPageProxy, fallbackDate: string): Promise<ImportedPage>; // getAnnotations({ intent: 'display' })
   export async function scanAnnotations(doc: PDFDocumentProxy, opts: { readonly signal?: AbortSignal; readonly batchSize?: number; readonly fallbackDate: string; readonly onBatch: (pages: readonly ImportedPage[]) => void }): Promise<'done' | 'cancelled'>;
     // mismo patrón que scanPageDims (lotes de 50 páginas, cede el hilo entre lotes)
   ```
4. Tests: `tests/unit/annotations/import.test.ts` (objetos crudos sintéticos, incluidos inválidos) y `tests/unit/annotations/engine-import.test.ts` (motor real con `annotated.pdf` y el corpus `7.18.1-t02-pass-a.pdf`).

## Criterios de aceptación
- [ ] (T) `annotated.pdf`: p1 → 2 soportadas (`highlight` con `contents 'Comentario previo'`, autor `Otra persona`, `origin.popupRef` no nulo; `underline` azul `[0,0,1]`); p2 → `note` (`icon 'Comment'`, `contents 'Nota previa'`), `freetext` (`fontSize 12`, `contents 'Texto libre previo'`), `ink` con 2 trazos; p3 → 1 ajena `Square` y ningún `Link` en ninguna lista.
- [ ] (T) Un `Highlight` crudo con `quadPoints` de 7 números o `color` de tipo cadena → no lanza y queda como ajena; uno con la bandera *Hidden* se ignora.
- [ ] (T) `scanAnnotations` sobre `pages-5000.pdf` (sin anotaciones) termina en < 10 s con lotes de 50 y ningún lote > 100 ms; abortar → `'cancelled'`.
- [ ] (T) Corpus veraPDF `7.18.1-t02-pass-a.pdf` → 1 `highlight` importado.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `import.ts` ≥ 95 % de líneas.

## Fuera de alcance
- Guardar en el store y mostrar (PDF-030/031). Respuestas (`/IRT`) y estados (PDF-058).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/import.ts` (nuevo), `apps/lector-pdf/src/core/annotations/index.ts` (export), `apps/lector-pdf/src/engine/annotations-import.ts` (nuevo), `apps/lector-pdf/src/engine/index.ts` (export), `apps/lector-pdf/tests/unit/annotations/import.test.ts` (nuevo), `apps/lector-pdf/tests/unit/annotations/engine-import.test.ts` (nuevo), `apps/lector-pdf/tests/perf/annotations-import.perf.test.ts` (nuevo).
- Qué he hecho: `importPageAnnotations` (puro, nunca lanza) convierte Highlight/Underline/StrikeOut/Text/FreeText/Ink al modelo y el resto a ajenas de solo lectura; Popup, Link y Widget se ignoran y las anotaciones con bandera Hidden también. `readPageAnnotations` y `scanAnnotations` (lotes de 50, cede el hilo, aborta a `cancelled`) en el motor. Criterios (T) cubiertos con `annotated.pdf`, `pages-5000.pdf` y `7.18.1-t02-pass-a.pdf`.
- Criterios de decisión tomados (la ficha no los fijaba): `quadPoints` ausente o vacío usa el rectángulo, pero con longitud inválida la anotación pasa a ajena; un campo presente con tipo inesperado hace la anotación ajena, uno ausente toma su valor por defecto; `popupRef` no parseable hace la anotación ajena; un `id` ausente o no parseable produce una ajena con id provisional (`ref:?<página>.<índice>` o `ref:<id>`) y rectángulo `[0,0,0,0]` si falta; el icono no válido de una nota vale `Note`; `fontSize` no positivo vale 12.
- Comandos ejecutados y resultado: `pnpm lint` (0, sin avisos), `pnpm typecheck` (0), `pnpm test` (0; 62 ficheros, 830 tests), `pnpm coverage` (0; `import.ts` 98,29 % líneas), `pnpm perf -- annotations-import` (0; `scanAnnotations` 5000 páginas: total 536,1 ms, máximo entre lotes 8,3 ms, 100 lotes).
- Dudas o cosas que no he podido hacer: ninguna bloqueante. Los tests de rendimiento están en `tests/perf/` porque la regla del proyecto prohíbe `performance.now()` en `tests/unit/`. No he hecho commit de otros ficheros del árbol de trabajo: solo los míos.
