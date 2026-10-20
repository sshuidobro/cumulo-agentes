---
tipo: tarea
id: PDF-059
titulo: Añadir texto e imagen al contenido de la página - núcleo (aplanar)
app: pdf
estado: hecha
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

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/model.ts` (`flatten` en texto libre y firma, `isFlattened`, validación en `isAnnotation`), `apps/lector-pdf/src/core/annotations/comment-list.ts`, `apps/lector-pdf/src/core/xfdf/xfdf.ts`, `apps/lector-pdf/src/core/pdf/incremental.ts`; nuevos `apps/lector-pdf/src/core/pdf/page-content.ts`, `apps/lector-pdf/tests/unit/pdf/page-content.test.ts`, `apps/lector-pdf/tests/unit/pdf/flatten.test.ts`.
- Qué he hecho: las anotaciones `flatten` nuevas no crean objeto de anotación: su apariencia va como Form XObject `/SuiteFlatN` y la página recibe `/Contents` (`q`, original, `Q` + `Do`) y `/Resources` propios en el mismo objeto de página que `/Annots`. Numeración sin cambios cuando no hay aplanados (los tests golden siguen verdes). Comentarios y XFDF excluyen los aplanados.
- Decisiones menores tomadas (revisar si no encajan): `flatten` solo se admite en `freetext` y `signature` (si no, borrador inválido); el flujo `open` («q») va sin filtro y el `close` con Flate, según la ficha; una respuesta cuyo padre es un aplanado se descarta; las anotaciones aplanadas no entran en `written`. Un aplanado que viene del fichero produce `save-unreadable` con `cause` un `RangeError` (así envuelve `buildIncrementalUpdate` todos los errores).
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf typecheck`: sin errores.
  - `pnpm exec vitest run tests/unit/pdf/page-content.test.ts tests/unit/pdf/flatten.test.ts`: 28/28 pasan. `page-content.ts` con 100 % líneas y ramas.
  - ESLint sobre `apps/lector-pdf/src/core` y `tests/unit/pdf`: sin errores.
  - `pnpm coverage`: 3333 pasan, 2 fallan, ninguno en código de esta ficha. `tests/unit/fixtures.test.ts` espera 28 fixtures y hay 29 (`tests/fixtures/catalog.ts` lo modifica otro cambio en curso). `tests/unit/search-actions.test.ts` (debounce) falla con carga y pasa solo (7/7).
  - `pnpm lint` en la raíz falla con ~11.700 errores de `no-undef` en `apps/lector-pdf/dist-pdf095/` (carpeta sin seguimiento de otro programador, no está en `ignores`); no he tocado esa carpeta.
- Dudas o cosas que no he podido hacer: no hay commit (pedido por el coordinador). La cobertura global no sale porque `pnpm coverage` no imprime tabla cuando falla algún test; la medí solo para los ficheros de esta ficha. Interfaz fuera de alcance (PDF-130).

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Typecheck limpio; vitest de `tests/unit/pdf` 709/709; ESLint de `src/core` y `tests/unit/pdf` sin errores. Cada criterio tiene su test; `page-content.ts` sin SSR ni React; escritura única de página con `/Annots` y `/Contents`.
- (opcional) El lint raíz falla por `dist-pdf095/` ajeno a la ficha y `fixtures.test.ts` (28 vs 29) es de otro cambio: el tester debe repetir `pnpm coverage` completo cuando se resuelvan.
