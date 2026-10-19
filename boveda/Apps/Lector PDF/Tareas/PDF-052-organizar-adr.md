---
tipo: tarea
id: PDF-052
titulo: Reorganizar páginas por actualización incremental (núcleo y medidas)
app: pdf
estado: en-curso
depende_de: [PDF-039, PDF-106]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, decision]
---

# PDF-052 · Reorganizar páginas por actualización incremental (núcleo y medidas)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0028-reescribir-pdfs]] · Paridad: [[Paridad Adobe Acrobat]] · Sigue: [[PDF-053-organizar-paginas]]

> 2026-10-19 (líder): la pregunta de licencias ya no aplica. El líder ha decidido el escritor propio ([[ADR-0028-reescribir-pdfs]]): no entra pdf-lib, qpdf-wasm ni mupdf. El ADR ya está escrito; esta ficha implementa el núcleo y rellena la tabla «Medidas» del ADR.

## Objetivo
Una función pura de `core/` que, dada la nueva lista de páginas (orden y giro de cada una), escribe la actualización incremental que reorganiza el PDF: borrar, reordenar y girar páginas conservando anotaciones, enlaces, índice y cifrado, con 5 o 100 000 páginas.

## Contexto
- [[ADR-0028-reescribir-pdfs]] (sección «Decisión», punto 1): reglas exactas del árbol nuevo.
- `src/core/pdf/delta-writer.ts` (de [[PDF-106-escritor-de-incrementos|PDF-106]]): `startDelta`, `reserveXref`, `finishDelta`, `DeltaWriter.object`.
- `src/core/pdf/object-reader.ts`: `ObjectReader.open`, `getDict`, `resolve`, `pageRefs()` (refs de todas las páginas en orden), `xref.trailer`, `xref.size`.
- `src/core/pdf/objects.ts`: `dict`, `name`, `ref`, `withEntries`, `dictGet`.
- `src/core/errors.ts`: `PdfErrorCode`, `PDF_ERROR_MESSAGES`, `pdfError`.
- Patrón de tests: `tests/unit/pdf/incremental.test.ts`, `tests/unit/pdf/interop.test.ts` (qpdf), `tests/helpers/pdfjs-node.ts`, `tests/perf/incremental.perf.test.ts` (`bestOf`).

## Qué hay que hacer
1. `src/core/errors.ts`: código nuevo `'organize-invalid'` → «No se pueden reorganizar las páginas: la lista de páginas no es válida.».
2. `src/core/pdf/page-tree.ts`:
```ts
export type PageRotation = 0 | 90 | 180 | 270;
/** Una página del documento resultante. `source`: índice 0-based de la página en el fichero abierto. `rotate`: giro final absoluto. */
export interface PageSlot { readonly source: number; readonly rotate: PageRotation }
export interface PageTreeInput {
  readonly source: ByteSource;
  readonly reader: ObjectReader;          // abierto con openForSave sobre el mismo source
  readonly pages: readonly PageSlot[];    // orden final
  readonly now: string;                   // ISO 8601 (semilla de /ID)
  readonly random?: RandomBytes;
  readonly signal?: AbortSignal;          // abortado → err(pdfError('cancelled'))
  readonly onProgress?: (done: number, total: number) => void; // cada 1 000 páginas escritas y al final
}
export interface PageTreeOutput { readonly delta: Uint8Array; readonly expectedSize: number; readonly rewrittenPages: number }
export const PAGE_TREE_FANOUT = 32;
/** Giro efectivo de cada página (propio o heredado), en orden. Para que la UI sepa el estado inicial. */
export async function readPageRotations(reader: ObjectReader): Promise<Result<readonly PageRotation[]>>;
export async function buildPageTreeUpdate(input: PageTreeInput): Promise<Result<PageTreeOutput>>;
```
   Reglas de `buildPageTreeUpdate` (nunca lanza; los fallos de lectura → `save-unreadable`, contraseña → como `buildIncrementalUpdate`):
   - Validar: `pages.length >= 1`, cada `source` entero en `[0, n)` y sin repetir, `rotate` ∈ {0, 90, 180, 270}. Si no → `err(pdfError('organize-invalid'))`.
   - Giro efectivo de una página = su `/Rotate` o el del primer antecesor que lo tenga (bajando por `/Parent`, máximo 64 niveles), normalizado a 0-359 y redondeado al múltiplo de 90; sin ninguno → 0.
   - **Solo giros** (las `source` son exactamente `0..n-1` en orden): reescribir solo las páginas cuyo giro efectivo ≠ `rotate`, con `withEntries(dict, { Rotate: rotate === 0 ? undefined : rotate })` si el giro venía de la propia página, o con `Rotate: rotate` (también 0) si era heredado. Sin cambios → `delta` vacío y `expectedSize = source.size`.
   - **Caso general**: raíz = `/Pages` del catálogo (`trailer /Root` → `/Pages`). Construir de abajo arriba nodos de hasta 32 hijos en el orden de `pages`; el nodo de arriba es la raíz y **reutiliza el número y generación** de la raíz original; el resto de nodos son números nuevos desde `reader.xref.size`. Nodo: `{ Type: /Pages, Kids, Count, Parent }` (la raíz sin `Parent`). Si hay ≤ 32 páginas, la raíz tiene las páginas como hijos directos.
   - Cada página conservada se reescribe con su número y generación: `Parent` nuevo; `Resources`, `MediaBox` y `CropBox` copiados del antecesor más cercano si la página no los tiene (el valor tal cual, también si es una referencia); `Rotate` según `slot.rotate` (`undefined` si es 0). El resto de claves (`/Annots`, `/Contents`, `/StructParents`…) no se tocan.
   - Orden de escritura: nodos de arriba abajo y, dentro de un nivel, de izquierda a derecha; después las páginas en el orden de `pages`. Luego `finishDelta`.
   - `rewrittenPages` = páginas escritas.
3. Tests `tests/unit/pdf/page-tree.test.ts` (Node, pdf.js de `tests/helpers/pdfjs-node.ts` y qpdf de `tests/support/qpdf.ts`). En todos, el fichero resultante es `concat(original, delta)`.
4. Rendimiento `tests/perf/page-tree.perf.test.ts` (`ObjectReader.open` + `buildPageTreeUpdate`, mejor de 3, 1 calentamiento). Escribe los tiempos y tamaños medidos en la tabla «Medidas» de [[ADR-0028-reescribir-pdfs]].

## Criterios de aceptación
- [ ] `basic-5.pdf`, `pages = [4,3,2,1,0]` (todas con giro 0): pdf.js lee 5 páginas cuyo texto empieza por «Página 5 de 5», «Página 4 de 5»…; `qpdf --check` código 0.
- [ ] `basic-5.pdf`, borrar la página 2 (`[0,2,3,4]`): pdf.js da 4 páginas; `qpdf --check` 0; `qpdf --show-npages` 4.
- [ ] `basic-5.pdf`, solo girar la página 3 a 90: `rewrittenPages === 1`; pdf.js `getPage(3).rotate === 90`, el resto 0; girarla de nuevo a 0 sobre el resultado deja `/Rotate` fuera del diccionario.
- [ ] Giro heredado: un documento de prueba con `/Rotate 90` en un nodo `/Pages` (créalo con `tests/fixtures/pdf-builder.ts` en el propio test): `readPageRotations` da 90 para sus páginas; `[1,0]` con giro 90 conserva 90 en pdf.js; con giro 0 da 0.
- [ ] `outline.pdf`: borrar la página 2 → `getOutline()` devuelve los mismos títulos; las entradas a páginas conservadas resuelven (`resolveDest` de `src/engine/dest.ts`) a su **nuevo** índice; las que iban a la página borrada devuelven `null` sin lanzar.
- [ ] `links.pdf`: reordenar `[1,0,…]` → los enlaces internos de cada página siguen en esa página y llevan a la página correcta (nuevo índice).
- [ ] `annotated.pdf`: reordenar y girar → `getAnnotations()` de cada página da los mismos subtipos, `/Contents` y autores que antes en esa misma página.
- [ ] `encrypted-aes-256.pdf` (contraseña `usuario`): borrar la página 1 → pdf.js abre con la contraseña y da 4 páginas; `qpdf --check --password=usuario` código 0; el texto sigue legible.
- [ ] `compressed.pdf` (xref stream y object streams): borrar una página → pdf.js y `qpdf --check` correctos.
- [ ] `pages-5000.pdf`: borrar la página 2 → 4 999 páginas; la última es «Página 5000…»; `qpdf --check` 0.
- [ ] Entradas no válidas (`[]`, índice repetido, `-1`, `n`, giro 45) → `organize-invalid`; `signal` abortado → `cancelled`; `onProgress` se llama con `total` = `pages.length` y termina en `done === total`.
- [ ] `pnpm perf`: `pages-5000.pdf` borrar página 2 < 1 000 ms; `pages-100000.pdf` borrar página 2 < 15 000 ms; `pages-100000.pdf` girar la página 50 000 < 3 000 ms. Medidas anotadas en el ADR.
- [ ] Cobertura de `page-tree.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz, Worker, estado de la app y anotaciones sin guardar (PDF-053). Insertar páginas de otro PDF, extraer, combinar (PDF-054/055). Reparar xref. Limpiar índice o campos de formulario de páginas borradas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `boveda/Apps/Lector PDF/Tareas/PDF-052-organizar-adr.md` (solo estado y Registro).
- Qué he hecho: No he implementado nada. La ficha está marcada como "Ficha por detallar" (sin firmas, pasos, ficheros ni "Qué hay que hacer"; "Fuera de alcance" dice "Por detallar"). Según la propia ficha, no debe empezarse hasta que el líder la complete.
- Comandos ejecutados y resultado: ninguno (no hay código que compilar ni probar).
- Dudas o cosas que no he podido hacer: Falta que el líder detalle la ficha (firmas, ficheros, pasos, criterios). Además, la tarea exige consultar al usuario sobre licencias GPL/AGPL de librerías (pdf-lib, qpdf en WASM) antes de decidir; esa pregunta de producto queda pendiente. Como dependencia, `depende_de: [PDF-039]`: no he verificado su estado. Ficha pasada a `bloqueada`.

### [líder] replanificación — 2026-10-19
- Desbloqueada sin preguntar al usuario: pdf-lib y forks son MIT y qpdf Apache-2.0 (no hay GPL/AGPL salvo mupdf), y además se decide no usar ninguna librería: escritor propio ([[ADR-0028-reescribir-pdfs]]).
- La ficha pasa de «ADR y prueba» a núcleo de reorganización con medidas. La parte común del escritor se separa antes en [[PDF-106-escritor-de-incrementos]] (`depende_de` añade PDF-106). `estado: pendiente`, `intentos: 0`.
