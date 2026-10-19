---
tipo: tarea
id: PDF-055
titulo: Insertar páginas de otro PDF y combinar PDFs - núcleo
app: pdf
estado: pendiente
depende_de: [PDF-119, PDF-123, PDF-124]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
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
- [ ] Insertar desde `encrypted-aes-128.pdf` (contraseña de su fixture) en `basic-5.pdf` → correcto; contraseña mala → `save-wrong-password`.
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
