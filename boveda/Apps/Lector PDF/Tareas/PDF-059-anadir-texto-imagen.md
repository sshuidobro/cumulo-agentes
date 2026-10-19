---
tipo: tarea
id: PDF-059
titulo: Añadir texto e imagen al contenido de la página - núcleo (aplanar)
app: pdf
estado: pendiente
depende_de: [PDF-052, PDF-058, PDF-110]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, edicion, nucleo]
---

# PDF-059 · Añadir texto e imagen al contenido de la página: núcleo (aplanar)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0036-anadir-contenido-aplanando]], [[ADR-0009-anotaciones-escritor-incremental]] · Paridad: [[Paridad Adobe Acrobat]] · Sigue: [[PDF-130-anadir-texto-imagen-interfaz]]; reutilizan `page-content.ts`: [[PDF-061-ocr]], [[PDF-135-redactar-aplicar]]

## Objetivo
Las anotaciones nuevas de texto libre o de imagen marcadas con `flatten: true` se guardan como **contenido de la página** (no como anotaciones): su apariencia se dibuja con un Form XObject al final del contenido. El texto queda seleccionable y se encuentra al buscar tras guardar y reabrir.

## Contexto
- [[ADR-0036-anadir-contenido-aplanando]].
- `src/core/annotations/model.ts` → `FreeTextAnnotation`, `SignatureAnnotation`, `isAnnotation` (validador usado por los borradores).
- `src/core/pdf/incremental.ts:115-215` → `writeUpdate` (planificación de números y escritura), `rewritePage`, `writeSignatureImage`, `imageObjectCount`.
- `src/core/annotations/appearance.ts` → `buildAppearance` (Form XObject con `/BBox` = `rect` en coordenadas de página).
- `src/core/annotations/comment-list.ts` → `buildCommentRows`; `src/core/xfdf/xfdf.ts` (PDF-110) → exportación.
- `src/core/pdf/page-tree.ts` → lógica de antecesores (para `/Resources` heredados).

## Qué hay que hacer
1. `model.ts`: `FreeTextAnnotation` y `SignatureAnnotation` ganan `readonly flatten?: true`. `isAnnotation` acepta `flatten` ausente o `true` (cualquier otro valor → no válido).
2. `src/core/pdf/page-content.ts` (común para aplanar, OCR y redactar):
```ts
/** `/Resources` efectivos de la página como diccionario directo: el propio o el heredado (máx. 64 niveles), con sus subdiccionarios `/Font` y `/XObject` resueltos a directos. Sin recursos → dict vacío. */
export async function effectiveResources(reader: ObjectReader, page: PdfDict): Promise<PdfDict>;
/** Primer nombre libre en la categoría: `base`, `base1`, `base2`… */
export function freeResourceName(resources: PdfDict, category: 'XObject' | 'Font', base: string): string;
export function withResource(resources: PdfDict, category: 'XObject' | 'Font', resName: string, value: PdfRef): PdfDict;
/** Flujos para envolver el contenido existente: `open` = «q\n»; `close` = «Q\n» + `ops` (Flate). */
export function wrapStreams(ops: string): { readonly open: PdfStream; readonly close: PdfStream };
/** `/Contents` nuevo: [open, …contenidos originales (directo, ref o array), close]. */
export function wrappedContents(page: PdfDict, open: PdfRef, close: PdfRef): readonly PdfValue[];
```
3. `incremental.ts`:
   - Las anotaciones de `diff.added` con `flatten === true` se separan: no se crean anotación ni popup; se reservan `ap` (Form XObject), `extra` (imagen y SMask si es imagen) y, **por página**, dos números `open` y `close`.
   - Por cada página con aplanados: `effectiveResources` → para cada aplanado `freeResourceName(res, 'XObject', 'SuiteFlat')` y `withResource`; `ops` = `q /SuiteFlatN Do Q` por aplanado en el orden de `diff.added`; se escriben `ap` (`buildAppearance(a, extra[0]).stream`), imágenes (`writeSignatureImage`), `open` y `close` (`wrapStreams`), y la página con `withEntries(page, { Contents: wrappedContents(...), Resources: res })`.
   - Si la misma página también cambia `/Annots` (anotaciones normales añadidas o borradas), se escribe **una sola vez** con ambos cambios (adapta `rewritePage` para recibir los cambios de contenido; si `/Annots` era indirecto, se reescribe ese array como hoy y la página aparte con `Contents` y `Resources`).
   - Una anotación con `flatten` que no sea nueva (`origin.kind === 'file'`) es un bug → `RangeError`.
4. `comment-list.ts`: las anotaciones con `flatten === true` no aparecen en el panel. `xfdf.ts`: no se exportan.
5. Tests `tests/unit/pdf/page-content.test.ts` y `tests/unit/pdf/flatten.test.ts` (pdf.js `loadPdf` en Node + `qpdfCheck`).

## Criterios de aceptación
- [ ] **Criterio original**: `basic-5.pdf` + texto libre `flatten` «Texto añadido Ñandú» en la página 2 → tras guardar (concat), pdf.js `getTextContent()` de la página 2 contiene «Texto añadido Ñandú»; `getAnnotations()` de la página 2 no tiene ninguna anotación nueva; la búsqueda de la app (`findInPage` sobre ese texto) lo encuentra.
- [ ] Imagen JPEG `flatten` → la página tiene un XObject de imagen con los bytes del JPEG idénticos y ninguna anotación nueva; `qpdf --check` 0.
- [ ] Página con `/Resources` heredado de `/Pages` y `/Contents` en array (créala con `pdf-builder.ts`): tras aplanar, el texto original y el nuevo se extraen y las demás páginas no cambian (el nodo `/Pages` no se reescribe).
- [ ] Página que ya tiene un XObject llamado `SuiteFlat` → el nuevo se llama `SuiteFlat1`.
- [ ] Misma página con un resaltado normal añadido y un texto aplanado → un único objeto de página escrito en el delta con `/Annots` y `/Contents` nuevos.
- [ ] `encrypted-aes-256.pdf` (`usuario`) → el texto aplanado se extrae al abrir con la contraseña; `qpdf --check --password=usuario` 0.
- [ ] Borrador: `toDraft`/`fromDraft` conservan `flatten`; `flatten: false` → borrador no válido.
- [ ] `buildCommentRows` no lista aplanados; la exportación XFDF tampoco.
- [ ] Cobertura ≥ 90 % de líneas en `page-content.ts`. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz ([[PDF-130-anadir-texto-imagen-interfaz]]). Fuentes no WinAnsi. Editar el contenido una vez guardado ([[PDF-065-editar-texto]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0036-anadir-contenido-aplanando]]: núcleo aquí, interfaz en [[PDF-130-anadir-texto-imagen-interfaz]]. Dependencias añadidas PDF-058 y PDF-110 solo para no chocar en `model.ts`, `incremental.ts` y `xfdf.ts`.
