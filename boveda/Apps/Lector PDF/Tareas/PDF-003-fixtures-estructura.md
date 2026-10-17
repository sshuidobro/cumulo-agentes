---
tipo: tarea
id: PDF-003
titulo: Generador de fixtures (índice, enlaces, etiquetas, xref comprimido, actualizaciones, anotaciones, formulario)
app: pdf
estado: en-test
depende_de: [PDF-002]
intentos: 0
skills: [pruebas-calidad, formatos-ofimatica]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, fixtures, pruebas]
---

# PDF-003 · Generador de fixtures: estructura del documento

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0011-documentos-de-prueba-pdf]] · [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
El generador de [[PDF-002-fixtures-paginas]] crea además PDFs con índice, enlaces, etiquetas de página, xref en stream con *object streams*, varias actualizaciones incrementales, anotaciones "de otro programa" y un formulario, para probar navegación, búsqueda, el lector de xref y el escritor incremental.

## Contexto
- Leer: `apps/lector-pdf/tests/fixtures/pdf-builder.ts`, `catalog.ts`, `ensure.ts`.
- ISO 32000-1: *outline* (§12.3.3: `/Outlines` con `/First /Last /Count`; ítems con `/Title /Parent /Prev /Next /First /Last /Count /Dest` o `/A`; `/F` 1 = cursiva, 2 = negrita; `/Count` negativo = cerrado), destinos (§12.3.2: `[pageRef /XYZ left top zoom]`, `/Fit`, `/FitH top`), nombrados (`/Names << /Dests << /Names [(nombre) [dest]] >> >>`), `/PageLabels` (§12.4.2: `<< /Nums [0 << /S /r >> 4 << /S /D >> 11 << /S /D /P (A-) >>] >>`), xref stream (§7.5.8: `/Type /XRef /W [1 4 2] /Index /Size`, entradas tipo 0/1/2), object streams (§7.5.7: `/Type /ObjStm /N /First`, cabecera de pares "num offset").
- Sube `GENERATOR_VERSION` a `2` para que se regeneren los ficheros.

## Qué hay que hacer
1. `PdfBuilder.build` acepta `{ root, info?, xref?: 'table' | 'stream', objectStreams?: boolean }`. Con `'stream'`: escribe un objeto `/Type /XRef` (sin comprimir, `/W [1 4 2]`) en vez de tabla+trailer, con `/Root`, `/Info`, `/Size` e `/ID [<hex16> <hex16>]` (16 bytes fijos derivados del nombre, deterministas). Con `objectStreams: true`: todos los objetos que no son streams van dentro de *object streams* comprimidos de hasta 100 objetos (entradas tipo 2). Con `'table'` añade también `/ID`.
2. `export function appendIncrementalUpdate(base: Uint8Array, objects: ReadonlyMap<number, string>, trailerExtra?: string): Uint8Array` en `pdf-builder.ts`: anexa los objetos, una tabla xref con subsecciones contiguas y trailer con `/Size` (máximo número + 1), `/Root` y `/Prev` copiados/calculados del trailer anterior (busca el último `startxref` y lee `/Root` y `/Size` del último trailer con una expresión regular; solo hace falta que funcione con PDFs de nuestro generador).
3. Añade a `catalog.ts`:
   | Fichero | Contenido exacto |
   |---|---|
   | `outline.pdf` | 30 páginas (`Página k de 30`). Índice: `Capítulo 1` (negrita, → p1 `/Fit`) con hijos `Sección 1.1` (→ p3 `/XYZ 72 500 0`, con hijo `Apartado 1.1.1` → p4 `/XYZ 0 792 0`) y `Sección 1.2` (→ p6); `Capítulo 2` (→ p11 `/FitH 792`) con hijo `Sección 2.1` (cursiva, → p12); `Capítulo 3` **cerrado** (→ p21) con hijos `Sección 3.1` (→ p22) y `Sección 3.2` (→ p25); `Anexo` (destino nombrado `anexo` → p30); `Sitio web` (`/A << /S /URI /URI (https://example.org/) >>`). |
   | `links.pdf` | 5 páginas. En la p1, rectángulos de enlace (`/Subtype /Link /Border [0 0 0]`) junto a líneas de texto que los describen: (a) `/Dest [p3 /XYZ 0 400 0]`; (b) `/Dest (destino-final)` nombrado → p5 `/Fit`; (c) `/A << /S /GoTo /D [p2 /Fit] >>`; (d) `/A << /S /URI /URI (https://example.org/ruta?x=1) >>`; (e) `/A << /S /URI /URI (mailto:alguien@example.org) >>`; (f) `/A << /S /JavaScript /JS (app.alert(1)) >>`; (g) `/A << /S /Launch /F (calc.exe) >>`; (h) `/A << /S /URI /URI (javascript:alert(1)) >>`. Rectángulos `[72 y 300 y+20]` con `y` = 700, 670, … |
   | `page-labels.pdf` | 12 páginas; etiquetas `i, ii, iii, iv, 1 … 7, A-1` (ver `/Nums` del Contexto). |
   | `compressed.pdf` | 50 páginas con contenido comprimido, `xref: 'stream'`, `objectStreams: true`, versión 1.5, con el mismo índice que `outline.pdf` reducido a los capítulos (destinos a p1, p11, p21). |
   | `incremental-updates.pdf` | `basic-5.pdf` + actualización 1 (reemplaza el contenido de la página 1 por `Página 1 modificada`) + actualización 2 (nuevo `/Info` con `/Title (Actualizado dos veces)`). |
   | `annotated.pdf` | 3 páginas, anotaciones de "otro programa" con `/T (Otra persona)`: p1 `Highlight` amarillo con `/QuadPoints`, `/AP` y `/Popup` (`/Contents (Comentario previo)`); p1 `Underline` azul **sin** `/AP`; p2 `Text` (`/Name /Comment`, `/Contents (Nota previa)`, `/Open false`) con su `Popup`; p2 `FreeText` (`/DA (/Helv 12 Tf 0 0 0 rg)`, `/Contents (Texto libre previo)`); p2 `Ink` rojo con dos trazos; p3 `Square` verde (tipo no soportado: se debe conservar); p3 `Link` URI. Usa el recurso `/Helv` en `/AcroForm /DR`. `/Annots` de la p2 como **objeto indirecto** (array aparte). |
   | `form.pdf` | 1 página con `/AcroForm` (`/Fields`, `/NeedAppearances false`, `/DA`), un campo de texto `nombre` (con `/AP`) y una casilla `acepto` (estados `/Yes` `/Off`). |
4. Tests `tests/unit/fixtures-structure.test.ts` (con `getDocument` *legacy* como en PDF-002).

## Criterios de aceptación
- [ ] (T) `outline.pdf`: `getOutline()` tiene 5 elementos raíz con esos títulos y orden; `Capítulo 1` tiene `bold: true`; `Sección 2.1` `italic: true`; `Apartado 1.1.1` está a profundidad 3; `Sitio web` tiene `url` `https://example.org/`; `getDestination('anexo')` resuelve a la página 30 (`getPageIndex` → 29).
- [ ] (T) `links.pdf`: `getAnnotations()` de la p1 devuelve 8 `Link`; los de URI tienen `url` (pdf.js no devuelve `url` para `javascript:`; anótalo en el Registro con lo que devuelva); (b) tiene `dest === 'destino-final'`.
- [ ] (T) `page-labels.pdf`: `getPageLabels()` → `['i','ii','iii','iv','1','2','3','4','5','6','7','A-1']`.
- [ ] (T) `compressed.pdf`: 50 páginas; el fichero contiene `/Type /ObjStm` y `/Type /XRef` y **no** contiene la palabra `trailer`; el texto de la página 50 se extrae.
- [ ] (T) `incremental-updates.pdf`: contiene 3 `%%EOF`; el texto de la p1 es `Página 1 modificada`; `getMetadata().info.Title === 'Actualizado dos veces'`.
- [ ] (T) `annotated.pdf`: subtipos por página `p1: [Highlight, Popup, Underline]`, `p2: [Text, Popup, FreeText, Ink]`, `p3: [Square, Link]` (en cualquier orden); el Highlight tiene `hasAppearance: true` y `contentsObj.str === 'Comentario previo'`.
- [ ] (T) `form.pdf`: `getFieldObjects()` contiene `nombre` y `acepto`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0; la generación completa (`pnpm --filter lector-pdf fixtures`) tarda < 15 s.

## Fuera de alcance
- PDFs cifrados (llegarán con PDF-046). Fuentes incrustadas y texto no latino (los cubre el corpus de LibreOffice, PDF-004).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/tests/fixtures/pdf-builder.ts` (reescrito: xref en stream, object streams, `/ID`, `readTrailer`, `appendIncrementalUpdate`), `apps/lector-pdf/tests/fixtures/document.ts` (nuevo: `buildDocument` movido de `catalog.ts` con hook `setup`, compresión y build options), `apps/lector-pdf/tests/fixtures/structure.ts` (nuevo: outline, links, page-labels, compressed, incremental-updates, annotated, form), `apps/lector-pdf/tests/fixtures/catalog.ts` (`GENERATOR_VERSION` 2 y 7 fixtures nuevos), `apps/lector-pdf/tests/unit/fixtures.test.ts` (recuento 10 → 17), `apps/lector-pdf/tests/unit/fixtures-structure.test.ts` (nuevo, 31 tests con el de PDF-002).
- Qué he hecho: el constructor escribe xref en stream `/W [1 4 2]` con object streams de 100 objetos (verificados byte a byte en `compressed.pdf`), `/ID` determinista (MD5); la actualización incremental añade xref por subsecciones y `/Prev`. Los 7 fixtures de la tabla se generan con la estructura pedida; el formulario y las anotaciones se verifican con pdf.js.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf fixtures` → 17 generados en 3,06 s (presupuesto < 15 s). `pnpm lint` → sin errores ni avisos. `pnpm typecheck` → OK. `pnpm test` → 44 ficheros, 514 tests en verde. `pnpm exec vitest run --config vitest.perf.config.ts apps/lector-pdf/tests/perf/fixtures.perf.test.ts` → 2/2.
- Dudas o cosas que no he podido hacer:
  - `qpdf` no está instalado en el equipo: la validación con qpdf de la ficha (y la de PDF-029) queda sin ejecutar.
  - Decisiones de detalle no especificadas en la ficha, tomadas por mí y revisables: modo de destino `/Fit` en Sección 1.2, 2.1, 3.1, 3.2 y Capítulo 3 (la ficha solo indica página); `/Size` de la actualización = máximo entre el del trailer anterior y mayor número + 1 (ISO exige no reducirlo; coincide con la ficha en el caso habitual); `/ID` con la misma MD5 en ambas mitades; `build` acepta además `version` (1.5 en `compressed.pdf`, la ficha la pide pero no la lista en la firma).
  - `pdf.js` no devuelve `url` para `javascript:alert(1)` (enlace h de `links.pdf`): el test lo fija como `undefined`, tal como devuelve pdf.js.
  - `getFieldObjects()` devuelve un `Map` aunque el tipo de pdf.js declare un `Record`: el test comprueba las claves del `Map`. Conviene anotarlo para PDF-041.
  - `FUENTES.md`: los fixtures son creados por nosotros (no hay corpus externo); no he añadido entradas.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Comprobado: `pnpm lint` (0 avisos), `pnpm typecheck` OK, `pnpm test` 44 ficheros / 514 tests en verde; `pnpm --filter lector-pdf fixtures` regenera 17 en 4,0 s (< 15 s). Los 7 fixtures coinciden con la tabla de la ficha y cada criterio (T) tiene su test; además hay verificación byte a byte de la xref en stream y de los object streams.
1. (opcional) `apps/lector-pdf/tests/fixtures/pdf-builder.ts:214` — la ficha pedía `/ID` "derivado del nombre"; se usa MD5 del contenido (también determinista). Anotarlo como decisión de detalle.
2. (opcional) `apps/lector-pdf/tests/unit/fixtures-structure.test.ts` — no se asserta que `Capítulo 3` esté cerrado (`/Count` negativo); útil para PDF-016. Se deja para esa ficha.
3. Nota: validación con `qpdf` sin ejecutar (no instalado); queda para PDF-029 como ya indicó el programador.
