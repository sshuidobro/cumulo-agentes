---
tipo: tarea
id: PDF-028
titulo: Escritor incremental - anexar las anotaciones al PDF sin reescribirlo
app: pdf
estado: cambios-pedidos
depende_de: [PDF-068, PDF-027, PDF-024]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, anotaciones, formato]
---

# PDF-028 · Escritor incremental de anotaciones

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0014-localizar-paginas-por-count]] · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
Convertir la diferencia de anotaciones (`AnnotationDiff`, PDF-023) en un **incremento** (bytes que se anexan tras el `%%EOF`) que añade, modifica y borra anotaciones estándar, sin tocar ni cargar el resto del fichero. Función pura respecto a la UI: recibe un `ByteSource` y devuelve bytes.

## Contexto
- Leer: [[ADR-0009-anotaciones-escritor-incremental]], `src/core/pdf/*` (PDF-025, PDF-026, PDF-068: `ObjectReader.pageRef`), `src/core/annotations/{model,diff,appearance}.ts`, `src/core/errors.ts`, ISO 32000-1 §7.5.6 (actualización incremental), §12.5.2 (claves comunes: `/Type /Annot /Subtype /Rect /Contents /P /NM /M /F /AP /C`), §12.5.6.2 (marcado: `/T /Popup /CA /CreationDate`), §12.5.6.4 (Text: `/Open /Name`), §12.5.6.6 (FreeText: `/DA` obligatorio), §12.5.6.10 (`/QuadPoints`), §12.5.6.13 (Ink: `/InkList`), §12.5.6.14 (Popup: `/Parent /Open`).
- El incremento se escribe con el **mismo tipo de xref** que la última sección (`xref.lastKind`). Nunca se modifica un byte existente.

## Qué hay que hacer
1. `src/core/errors.ts`: añade a `PdfErrorCode` `'save-encrypted'` («No se pueden guardar anotaciones en este PDF porque está cifrado. Llegará en una próxima versión.») y `'save-unreadable'` («No se pueden guardar las anotaciones: la estructura interna del PDF está dañada.»).
2. `src/core/annotations/to-pdf.ts`:
   ```ts
   export function annotationDict(a: Annotation, o: { readonly pageRef: PdfRef; readonly apRef: PdfRef; readonly popupRef: PdfRef | null; readonly now: string }): PdfDict;
   export function popupDict(parentRef: PdfRef, noteRect: RectPt, open: boolean): PdfDict; // /Rect [x2, y2-100, x2+200, y2], /F 28
   export function updatedDict(original: PdfDict, a: Annotation, o: { readonly apRef: PdfRef; readonly now: string }): PdfDict;
   ```
   - Comunes: `/Type /Annot /Subtype /<Highlight|Underline|StrikeOut|Text|FreeText|Ink> /Rect /Contents (encodeTextString) /T (autor) /NM (id) /M (pdfDate(now)) /CreationDate (created ?? now) /P pageRef /F 4 /C [r g b] /CA opacity /AP << /N apRef >>`.
   - Marcado: `/QuadPoints` (todos los quads aplanados). Nota: `/Name /<icon> /Open bool /Popup popupRef`. Texto libre: `/DA (/Helv <fs> Tf <r g b> rg)` con `textColor`, `/Q 0`, `/BS << /W 1 >>`. Tinta: `/InkList [[...] ...]`, `/BS << /W width >>`.
   - `updatedDict`: `withEntries(original, {...})` con `/Rect /Contents /M /C /CA /AP` y las claves propias del tipo; **conserva** todas las demás claves (`/P`, `/Popup`, `/IRT`, `/RC`, claves privadas…). Si cambia `contents` y existe `/RC` (texto enriquecido), bórralo (si no, Adobe mostraría el texto viejo).
3. `src/core/pdf/incremental.ts`:
   ```ts
   export interface IncrementalInput {
     readonly source: ByteSource;
     readonly reader: ObjectReader;          // abierto sobre el mismo source
     readonly diff: AnnotationDiff;
     readonly now: string;                   // ISO; lo pasa quien llama
   }
   export interface IncrementalOutput { readonly delta: Uint8Array; readonly expectedSize: number; readonly written: ReadonlyMap<string, PdfObjRef> } // id de anotación → objeto escrito
   export async function buildIncrementalUpdate(input: IncrementalInput): Promise<Result<IncrementalOutput>>;
   ```
   Algoritmo:
   1. Diff vacío → `ok` con `delta` vacío.
   2. `next = reader.xref.size`; asigna números a: cada anotación añadida, su apariencia, el popup de cada nota nueva, y la apariencia nueva de cada modificada.
   3. Agrupa por página con `await reader.pageRef(pageIndex)` (**nunca** `pageRefs()`, que lee todas las hojas; ver ADR-0014). Para cada página tocada lee su diccionario y `/Annots`: (a) ausente → array nuevo directo en la página reescrita; (b) array directo → reescribe la página con el array nuevo (resto de claves intactas); (c) referencia a array → reescribe **solo** ese objeto array. Quita las refs de las borradas y de sus popups (`origin.popupRef` y `/Popup` del dict); añade al final las nuevas (anotación y después su popup).
   4. Modificadas: `reader.getDict(origin.ref)` → `updatedDict` → reescribe el objeto con el **mismo** número y generación.
   5. Serializa cada objeto con `serializeIndirect`, acumulando offsets = `source.size + posición` (si el último byte del fichero no es `\n` ni `\r`, el delta empieza por `\n`).
   6. Sección xref: `'table'` → `xref\n` + subsecciones contiguas ordenadas + `trailer\n<< /Size /Root /Info? /ID /Prev lastXrefOffset >>\nstartxref\n<off>\n%%EOF\n`. `'stream'` → objeto nuevo `/Type /XRef /W [1 4 2] /Index [...] /Size /Root /Info? /ID /Prev` sin comprimir, que se incluye a sí mismo.
   7. `/ID`: `[ id0 original, id1 nuevo ]`; si no había, ambos nuevos. `id1` = 16 bytes FNV-1a de `now + source.size + número de objetos` (determinista para tests).
   8. Errores: `PdfSyntaxError('encrypted')` → `err(pdfError('save-encrypted'))`; cualquier otro `PdfSyntaxError` (incluido `page-not-found` de `pageRef`) → `err(pdfError('save-unreadable', e))`. Nunca lanza.
   9. Apertura para guardar (añadido por el líder, ronda 2), en el mismo `incremental.ts`, exportada desde `src/core/pdf/index.ts`:
      ```ts
      /** Abre el lector para guardar. Nunca lanza: cifrado → `save-encrypted`; cualquier otro fallo → `save-unreadable`. */
      export async function openForSave(source: ByteSource): Promise<Result<ObjectReader>>;
      // try { return ok(await ObjectReader.open(source)); } catch (e: unknown) { return err(toSaveError(e)); }
      ```
      Es la **única** forma en que la app abre un lector para guardar (PDF-037 la usa). `ObjectReader.open` no cambia.
4. Tests `tests/unit/pdf/incremental.test.ts`: con `basic-5.pdf`, `compressed.pdf`, `annotated.pdf` y `incremental-updates.pdf` (`memorySource`), concatena `original + delta`, lo abre con pdf.js *legacy* y comprueba `getAnnotations()`.

## Criterios de aceptación
- [ ] (T) `basic-5.pdf` + 6 anotaciones nuevas (una de cada tipo, p1-p2) → pdf.js ve en p1/p2 los subtipos `Highlight, Underline, StrikeOut, Text, Popup, FreeText, Ink`, todos con `hasAppearance: true` (salvo Popup), `quadPoints`/`inkLists`/`contentsObj` iguales a los del modelo (tolerancia 0,01) y `titleObj.str` = autor.
- [ ] (T) Los primeros `size` bytes de `original + delta` son idénticos al original (comparación byte a byte).
- [ ] (T) `compressed.pdf` (xref stream) → el incremento contiene `/Type /XRef` y no `trailer`; `basic-5.pdf` → contiene `trailer` y `/Prev`.
- [ ] (T) `annotated.pdf`: borrar el `Highlight` de p1 → pdf.js ya no ve ni él ni su `Popup` en p1; el `Underline` sigue. Modificar el `contents` de la nota de p2 → `contentsObj.str` nuevo y el `Square` de p3 intacto. Añadir en p2 (que tiene `/Annots` indirecto) → reescribe el array y no la página (comprueba que el objeto página no aparece en el delta).
- [ ] (T) Guardar dos veces seguidas (segundo incremento sobre el resultado del primero) → pdf.js lee el estado final correcto y hay 2 `%%EOF` más que en el original.
- [ ] (T) ~~Un trailer con `/Encrypt` → `err` `save-encrypted`; `corrupt-bad-startxref.pdf` → `err` `save-unreadable`; ninguna excepción escapa.~~ (sustituido en ronda 2 por los dos siguientes)
- [ ] (T) `openForSave`: `corrupt-bad-startxref.pdf` → `{ ok: false, error.code: 'save-unreadable' }`; `corrupt-empty.pdf` → `save-unreadable`; `appendIncrementalUpdate(basic-5.pdf, new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]), '/Encrypt 9 0 R')` (de `tests/fixtures/pdf-builder.ts`) → `save-encrypted`; `basic-5.pdf` → `ok` y `value.xref.size > 0`. Ninguna promesa rechaza (`await` sin `expect(...).rejects`).
- [ ] (T) `buildIncrementalUpdate` con trailer `/Encrypt` simulado sobre un lector válido → `save-encrypted` (test ya existente, se conserva); `page-not-found` y `/Annots` inválido → `save-unreadable`; ninguna excepción escapa.
- [ ] (T) `pages-5000.pdf` + 10 anotaciones en páginas distintas → `delta` < 50 KB y bytes leídos (`countingSource`, incluido `ObjectReader.open`) < 35 % del fichero (la xref ya es el 13,6 %). `pages-100000.pdf` + 10 anotaciones en las páginas `[0, 12345, 25000, 37777, 50000, 62500, 75000, 87654, 99000, 99999]` → bytes leídos < 16 %. Anota las medidas.
- [ ] (T, perf) `tests/perf/incremental.perf.test.ts`: `pages-5000.pdf` + 10 anotaciones → `buildIncrementalUpdate` < 1 s; `pages-100000.pdf` (página 99 999) → `ObjectReader.open` + `buildIncrementalUpdate` < 3 s (mejor de 5).
- [ ] (T) Determinismo: misma entrada y mismo `now` → mismos bytes.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm perf`, `pnpm coverage` con código 0; `incremental.ts` y `to-pdf.ts` ≥ 90 % de líneas.

## Fuera de alcance
- Validación con qpdf y corpus (PDF-029). Escribir en disco (PDF-037). Respuestas `/IRT` (PDF-058). Marcar como libres los objetos borrados (no hace falta: quedan sin referencias).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] ajuste por replanificación de PDF-026 — 2026-10-17
- Depende ahora de [[PDF-068-lector-objetos]] (el `ObjectReader` sale de PDF-026). Las páginas tocadas se localizan con `pageRef(index)` ([[ADR-0014-localizar-paginas-por-count]]).
- Criterio de lectura corregido: < 10 % era imposible (la xref de `pages-5000.pdf` ya es el 13,6 %). Nuevos umbrales: < 35 % en `pages-5000.pdf`, < 16 % en `pages-100000.pdf`. Los tiempos pasan a `tests/perf/` (ADR-0012).

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/errors.ts`, `src/core/annotations/to-pdf.ts` (nuevo), `src/core/annotations/index.ts`, `src/core/pdf/incremental.ts` (nuevo), `src/core/pdf/index.ts`, `tests/unit/annotations/to-pdf.test.ts` (nuevo), `tests/unit/pdf/incremental.test.ts` (nuevo), `tests/perf/incremental.perf.test.ts` (nuevo).
- Qué he hecho: códigos `save-encrypted` y `save-unreadable`; `to-pdf.ts` (`annotationDict`, `popupDict`, `updatedDict`) y `buildIncrementalUpdate` (xref de tabla o de stream según el último tipo del original, `/ID` con id0 original, `/Annots` directo, indirecto o ausente, popups solo de notas). Medidas: `pages-5000` + 10 anotaciones → delta 7 385 B, lee el 31,9 % del fichero (límite 35 %); `pages-100000` con las 10 páginas → delta 7 501 B, lee el 14,3 % (límite 16 %); página 99 999 → lee el 13,7 %, 85 ms.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (83 ficheros, 1058 tests); `pnpm coverage` OK (`to-pdf.ts` 100 % líneas, `incremental.ts` 97 %); `pnpm perf` OK (incluye `incremental.perf.test.ts`).
- Dudas o cosas que no he podido hacer:
  1. **Criterio `corrupt-bad-startxref.pdf` → `err` `save-unreadable` no cumplible con la firma actual.** `ObjectReader.open` rechaza ese fichero, así que `buildIncrementalUpdate` nunca recibe lector. El test solo comprueba que `open` rechaza con `xref-unreadable`. Opciones para el líder: (a) una función `openForSave(source)` que devuelva `Result<ObjectReader>` y que use PDF-037; (b) cambiar el criterio. Decisión pendiente.
  2. `/Encrypt`: `ObjectReader.open` ya rechaza los cifrados, así que el test simula el trailer cifrado sobre un lector válido.
  3. Criterio tomado dentro de la ficha: cualquier error (no solo `PdfSyntaxError`) devuelve `save-unreadable` para cumplir «nunca lanza». El `/ID` nuevo usa 4 pasadas de FNV-1a de 32 bits (16 bytes).
  4. pdf.js entrega los popups al final de la lista de `/Annots`; los tests comparan subtipos ordenados.
  5. En el árbol hay cambios sin commitear de otros agentes (viewer, ui, state, `object-reader.test.ts`, `xref-robustness.test.ts`, `annotation-qa.test.ts`). No los he incluido en el commit.

### [líder] replanificación (desbloqueo) — 2026-10-17
- Problema: el criterio `corrupt-bad-startxref.pdf` → `save-unreadable` no era cumplible: `ObjectReader.open` lanza `xref-unreadable` antes de que exista lector (error de la ficha). Lo mismo pasaba con PDF-037 y su criterio de PDF cifrado: `open` lanza `encrypted` y `save-actions` habría tenido que traducirlo a mano.
- Decisión técnica: opción (a), nueva `openForSave(source): Promise<Result<ObjectReader>>` en `incremental.ts` (paso 3.9) que reutiliza `toSaveError`. Se descarta cambiar `ObjectReader.open` a `Result` (lo usan PDF-068 y sus tests; el visor no lo necesita) y se descarta solo relajar el criterio (el error se tiene que traducir en algún sitio del núcleo y con test). No es un rechazo: `intentos` sigue en 0.
- Dudas 2-5 del programador aceptadas (encriptado simulado en `buildIncrementalUpdate`, cualquier error → `save-unreadable`, `/ID` con 4 pasadas FNV-1a de 32 bits, comparar subtipos ordenados, no commitear cambios ajenos).
- **Pasos exactos para la ronda 2:**
  1. `src/core/pdf/incremental.ts`: añade `openForSave` tal como en el paso 3.9 (import de `ObjectReader` como valor, no solo tipo). JSDoc en español.
  2. `src/core/pdf/index.ts`: exporta `openForSave` junto a `buildIncrementalUpdate`.
  3. `tests/unit/pdf/incremental.test.ts`: sustituye el test «un PDF con startxref dañado no llega a tener lector…» por un `describe('openForSave')` con los 4 casos del criterio nuevo (`corrupt-bad-startxref`, `corrupt-empty`, cifrado real con `appendIncrementalUpdate`, `basic-5` ok). Conserva el test de `/Encrypt` simulado.
  4. Usa `openForSave` (desenvolviendo el `Result`) en el helper `save()` de los tests para no duplicar caminos.
  5. Ejecuta `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` (`incremental.ts` ≥ 90 %) y `pnpm perf`; anota resultados. Commit solo de los ficheros de esta ficha.

