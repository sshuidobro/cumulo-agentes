---
tipo: tarea
id: PDF-055
titulo: Insertar páginas de otro PDF y combinar PDFs - núcleo
app: pdf
estado: hecha
depende_de: [PDF-119, PDF-123, PDF-124]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-055 · Insertar páginas de otro PDF y combinar PDFs: núcleo

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] (puntos 4 y 5), [[ADR-0028-reescribir-pdfs]] · Paridad: [[Paridad Adobe Acrobat]] · Antes: [[PDF-119-organizar-escritura]], [[PDF-123-formularios-al-copiar]] · Sigue: [[PDF-128-insertar-combinar-interfaz]]

## Objetivo
1. El guardado de la vista Organizar admite páginas **importadas** de otros PDF: sus objetos se copian con números nuevos dentro del mismo incremento, con anotaciones y formularios.
2. Una operación `combine` crea un PDF nuevo con varios PDF completos, conservando el índice de cada uno como una rama y sus anotaciones.

## Contexto
- `src/core/organize/save.ts` → `buildOrganizeUpdate` (PDF-119; hoy rechaza `imported`), `src/core/pdf/page-tree.ts` → `writePageTree`, `AddedPage`, `createAllocator`.
- `src/core/pdf/object-copier.ts` (`resolveNames: true`), `src/core/pdf/new-document.ts` (formularios de PDF-123 y ramas de índice de PDF-122).
- `src/core/organize/forms-cleanup.ts` (cómo se reescribe `/AcroForm` en un incremento).
- `src/core/doc-ops/ops/index.ts` → `DOC_OPS`, op `'organize'` (PDF-124).

## Qué hay que hacer
1. `src/core/pdf/form-copy.ts`: extrae de `new-document.ts` la lógica de PDF-123 que, a partir de los widgets copiados, obtiene y copia las raíces de campo y limpia `/Kids` → `export async function copyFieldRoots(from: ObjectReader, copier: ObjectCopier, widgetSourceNums: ReadonlySet<number>): Promise<readonly PdfRef[]>`. `new-document.ts` la usa (sin cambio de comportamiento: sus tests siguen igual).
2. `buildOrganizeUpdate`: `OrganizeInput` gana `readonly imported?: readonly ObjectReader[]` (índice = `SaveSlot.doc`). Para los huecos `imported`:
   - Validar `doc` en `[0, imported.length)`, `source` en `[0, páginas de ese doc)` y sin repetir el par `(doc, source)` → si no, `organize-invalid`.
   - Un `ObjectCopier` por documento importado (`resolveNames: true`), con el **mismo** asignador de números que el árbol (`createAllocator(reader.xref.size)`); `reservePages` de todas sus páginas usadas antes de copiar. Los objetos de `drain()` se escriben con `writer.object` (el `DeltaWriter` los cifra si el documento abierto está cifrado). Cada página copiada se pasa como `AddedPage`.
   - Formularios de las páginas importadas: `copyFieldRoots` y sus refs se añaden al final de `/AcroForm /Fields` del documento (si el documento no tiene `/AcroForm`, se reescribe el catálogo con `/AcroForm { Fields: [...], DR, DA }` tomados del importado). Fuentes de `/DR` del importado que no existan en el documento se añaden con nombre libre.
   - Índice del importado: no se copia (fuera de alcance).
   - Orden de escritura: objetos copiados → árbol → limpieza de widgets borrados → `/AcroForm` → xref.
3. Op `'organize'` (PDF-124): args gana `importedPasswords: readonly (string | null)[]`; fuentes `1..k` = PDFs importados (bytes); abre cada uno con `openForSave` (contraseña mala → `err('save-wrong-password')`).
4. Op nueva `'combine'`: args `{ parts: readonly { readonly password: string | null; readonly title: string }[]; now: string }`, una fuente por parte → `buildNewDocument` con todas las páginas de cada parte en su orden y giro efectivo (`readPageRotations`), `outline: 'branches'` y `title` de cada parte → `ok({ bytes, pageCount })`.
5. Tests `tests/unit/organize/insert.test.ts` y `tests/unit/doc-ops/combine-op.test.ts`.

## Criterios de aceptación
- [ ] Insertar las 2 primeras páginas de `outline.pdf` en `basic-5.pdf` tras la página 2 → 7 páginas: «Página 1 de 5», «Página 2 de 5», «Página 1 de 30», «Página 2 de 30», «Página 3 de 5»…; `qpdf --check` 0; el incremento no reescribe páginas que no sea necesario (las originales se reescriben solo por el árbol nuevo, como en PDF-052).
- [ ] Insertar páginas de `annotated.pdf` → sus anotaciones aparecen en las páginas insertadas (pdf.js).
- [ ] Insertar una página con campos de `form-full.pdf` en `basic-5.pdf` (sin formulario) → el resultado tiene `/AcroForm` y pdf.js `getFieldObjects()` lista esos campos con sus valores.
- [ ] Insertar en `encrypted-aes-256.pdf` (`usuario`) páginas de `basic-5.pdf` → el resultado abre con la contraseña y las páginas insertadas se leen (sus objetos van cifrados); `qpdf --check --password=usuario` 0.
- [ ] Insertar desde `encrypted-aes-128.pdf` (`usuario`) en `basic-5.pdf` → correcto; contraseña mala → `save-wrong-password`.
- [ ] **Criterio original**: `'combine'` de `basic-5.pdf` y `outline.pdf` → 35 páginas; `getOutline()` con dos ramas `basic-5` y `outline`, y bajo `outline` el índice completo con destinos correctos (como en PDF-122).
- [ ] `'combine'` con `annotated.pdf` + `form.pdf` → anotaciones y campos presentes.
- [ ] `pnpm perf`: insertar las 5 000 páginas de `pages-5000.pdf` en `basic-5.pdf` < 3 000 ms; combinar `pages-5000.pdf` + `pages-5000.pdf` < 4 000 ms.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Renombrar campos con el mismo nombre (compartirán valor; [[ADR-0035-organizar-en-la-app]]). Copiar el índice del PDF importado al insertar. Interfaz ([[PDF-128-insertar-combinar-interfaz]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0035-organizar-en-la-app]]: núcleo aquí, interfaz en [[PDF-128-insertar-combinar-interfaz]]. Dependencias nuevas: PDF-119, PDF-123 y PDF-124 (la op `organize`), en lugar de PDF-053.

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/form-copy.ts` (nuevo: `copyFieldRoots`, `applyFieldEdits`), `apps/lector-pdf/src/core/pdf/new-document-forms.ts` (usa `copyFieldRoots`), `apps/lector-pdf/src/core/organize/forms-cleanup.ts` (`updateAcroForm`; `removePageWidgets` es ahora un envoltorio con el mismo comportamiento), `apps/lector-pdf/src/core/organize/save.ts` (`imported`, validación del plan, copia de páginas importadas y sus formularios), `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (`organize` con `importedPasswords`; op `combine`), `apps/lector-pdf/tests/unit/organize/insert.test.ts`, `apps/lector-pdf/tests/unit/doc-ops/combine-op.test.ts`, `apps/lector-pdf/tests/perf/insert-combine.perf.test.ts`.
- Qué he hecho: extraigo la lógica de raíces de campo a `form-copy.ts` y la reutilizo en `FormsBuilder`, sin cambio de comportamiento. `buildOrganizeUpdate` acepta PDF importados (un copiador por documento con el mismo asignador, formularios añadidos a `/AcroForm` en el mismo incremento). La op `organize` abre los importados con su contraseña y la op `combine` crea el PDF con una rama de índice por parte.
- Comandos ejecutados y resultado: `pnpm lint` sin errores. `pnpm typecheck` sin errores. `pnpm coverage` (con `--coverage.reportsDirectory` propio): código 0, 266 ficheros, 3429 tests pasan. Módulos tocados: `save.ts` 98,8 % líneas, `form-copy.ts` 93,6 %, `new-document-forms.ts` 100 %. `pnpm perf` (solo `insert-combine.perf.test.ts`, en la raíz): los dos asserts pasan; el test completo tarda 4,1 s (insertar 5 000 páginas: calentamiento + 3 pasadas) y 7,6 s (combinar 2 × 5 000: calentamiento + 3 pasadas), así que la mejor pasada queda por debajo de 3 s y 4 s. Los criterios de inserción (7 páginas, qpdf, anotaciones, formularios, cifrado AES-256 y AES-128, contraseña incorrecta) y de `combine` (35 páginas, ramas, anotaciones y campos) tienen test automático.
- Dudas o cosas que no he podido hacer:
  1. `copyFieldRoots` tiene la firma de la ficha más un cuarto parámetro opcional `edits` (lista de cambios a `/Kids` y `/V`). Sin él no hay dónde dejar esos cambios, porque los objetos copiados se escriben después con `writer.object`. Lo aplica `applyFieldEdits` sobre los objetos ya volcados.
  2. `importedPasswords` es opcional en la op `organize` (si falta, `[]`). La UI actual (`src/state/organize-actions.ts`) envía `organize` sin ese campo y no debe romperse hasta que llegue PDF-128.
  3. Fuentes de `/DR` del importado: si el destino ya tiene una fuente con el mismo nombre, no se añade (no la renombro, porque las `/DA` de los campos copiados citan el nombre original). Es una interpretación de «con nombre libre» que conviene revisar.
  4. La ficha pide «no reescribe páginas innecesarias»: con inserción, el árbol `/Pages` se reconstruye como en PDF-052 y todas las páginas se reescriben (`rewrittenPages` = páginas finales). No he cambiado eso.
  5. Ruta de la ficha: `combine` y las pruebas de organize con importados están en `tests/unit/doc-ops/combine-op.test.ts`; la prueba de rendimiento es `tests/perf/insert-combine.perf.test.ts` (nombre propio).
  6. El directorio de cobertura por defecto estaba bloqueado por otro proceso vitest (pid 7478), así que lancé la cobertura con un directorio propio fuera del repo. No toqué `tests/e2e` ni los ficheros que otro agente tiene sin confirmar (`boveda/.../PDF-095`, `PDF-107`, `apps/lector-pdf/tests/e2e/*`, `apps/lector-pdf/src/core/ocr/`), y no los he incluido en el commit.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- Lint y typecheck sin errores; tests de insert y combine (13) en verde. Diff de `save.ts` correcto (validación del plan, asignador compartido, orden de escritura, cancelación).
- Dudas 1-5 del programador aceptadas (el árbol se reescribe como en PDF-052; fuentes `/DR` duplicadas no se renombran porque las `/DA` citan el nombre).
- (opcional) El commit lleva «Claude Haiku 5.5» en la atribución; no bloquea.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Insertar outline en basic-5 (7 págs, qpdf) | OK | insert.test.ts, en verde |
| Anotaciones de annotated.pdf | OK | insert.test.ts |
| Campos de form-full.pdf sin AcroForm previo | OK | insert.test.ts |
| AES-256 y AES-128, contraseña mala | OK | insert.test.ts, combine-op.test.ts |
| combine 35 págs + ramas; annotated+form | OK | combine-op.test.ts |
| perf insertar/combinar 5000 págs | OK | `pnpm perf`: 27 ficheros, 45 tests pasan |
| lint, typecheck, coverage | OK | código 0; 266 ficheros, 3429 tests; líneas 98,55 % |

Tests añadidos: ninguno (los existentes cubren cada criterio; sin skip/only).
