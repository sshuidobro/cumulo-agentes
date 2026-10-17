---
tipo: tarea
id: PDF-002
titulo: Generador de fixtures PDF (páginas, tamaños, imágenes y ficheros dañados)
app: pdf
estado: en-test
depende_de: [PDF-001]
intentos: 1
skills: [pruebas-calidad, formatos-ofimatica]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, fixtures, pruebas]
---

# PDF-002 · Generador de fixtures: páginas, tamaños, imágenes y dañados

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0011-documentos-de-prueba-pdf]] · Investigación: [[Librerias y arquitectura PDF]] (sección 4)

## Objetivo
Un generador propio, sin dependencias, crea en `fixtures/pdf/generated/` los PDFs de prueba (5, 5 000 y 100 000 páginas, tamaños mezclados, imágenes y dañados). Se ejecuta con `pnpm --filter lector-pdf fixtures` y automáticamente antes de los tests de Vitest y Playwright si faltan.

## Contexto
- Leer: [[ADR-0011-documentos-de-prueba-pdf]], `apps/lector-pdf/vitest.config.ts`, `playwright.config.ts`.
- Los ficheros de `tests/fixtures/` se ejecutan también con `node` directamente (Node 22 elimina los tipos): usa **solo sintaxis borrable** (nada de `enum`, `namespace` ni propiedades en parámetros del constructor) e importa entre ellos **con extensión `.ts`**. Para eso añade `"allowImportingTsExtensions": true` al `tsconfig.json` de la app (válido porque hay `noEmit`).
- Puedes usar `node:fs`, `node:path`, `node:url` y `node:zlib` (son tests). Formato PDF: cabecera `%PDF-1.7` + línea binaria `%âãÏÓ`, objetos `N 0 obj ... endobj`, tabla xref clásica (entradas de 20 bytes exactos `0000000123 00000 n\r\n` o con espacio + `\n`), trailer, `startxref`, `%%EOF`.

## Qué hay que hacer
1. `tests/fixtures/paths.ts`: `export const REPO_ROOT`, `FIXTURES_DIR` (= `<repo>/fixtures/pdf/generated`), `CORPUS_DIR` (= `<repo>/fixtures/pdf/corpus`), calculados con `fileURLToPath(new URL('../../../../', import.meta.url))`.
2. `tests/fixtures/pdf-builder.ts`:
   ```ts
   export class PdfBuilder {
     alloc(): number;                                   // reserva el siguiente número de objeto (empieza en 1)
     setObject(num: number, body: string): void;        // body = texto del objeto (diccionario, array...)
     addObject(body: string): number;                   // alloc + setObject
     addStream(dict: string, data: Uint8Array | string, opts?: { readonly compress?: boolean }): number;
                                                        // dict sin /Length ni /Filter; compress → deflateSync y /Filter /FlateDecode
     build(opts: { readonly root: number; readonly info?: number }): Uint8Array; // xref clásica; falla si hay números sin objeto
   }
   export function winAnsi(text: string): string;  // literal PDF "(...)" con \( \) \\ escapados; á é í ó ú Á É Í Ó Ú ñ Ñ ü Ü ¿ ¡ « » € como escape octal WinAnsi (€ = \200); otro carácter no ASCII → '?'
   export function textPage(lines: readonly string[]): string; // contenido "BT /F1 18 Tf 72 720 Td 22 TL (l1) Tj T* (l2) Tj ... ET"
   ```
   Fuente compartida: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`.
   Para 100 000 páginas acumula los trozos en un array de `Uint8Array` (no concatenes cadenas gigantes).
   **Árbol de páginas equilibrado** (como los productores reales): añade
   ```ts
   export function buildPageTree(b: PdfBuilder, pageCount: number, fanout = 32):
     { readonly root: number; readonly pageRefs: readonly number[]; readonly parentOf: (pageIndex: number) => number };
   ```
   que reserva los números de las páginas y de los nodos `/Pages` intermedios (máximo `fanout` hijos por nodo, `/Count` correcto en cada nodo, `/Parent` en todos salvo la raíz) y escribe los nodos; quien llama escribe cada `/Page` con `/Parent parentOf(i)`. Medido por el líder: con 100 000 hijos en un solo nodo pdf.js lee **todo** el fichero al abrir (5,7 s); con árbol de 32 abre en 0,3 s leyendo el 15 %.
3. `tests/fixtures/catalog.ts`: `export const GENERATOR_VERSION = 1;` y `export const FIXTURES: readonly { readonly name: string; readonly build: () => Uint8Array }[]` con:
   | Fichero | Contenido exacto |
   |---|---|
   | `basic-5.pdf` | 5 páginas 612×792. Línea 1 de cada página: `Página k de 5`; línea 2: `marcador-k`; línea 3: p1 `El veloz murciélago hindú comía feliz cardillo y kiwi.`, p2 `Texto de búsqueda en la página dos.`, p3 `BUSQUEDA en mayúsculas sin tilde.`, p4 `otra búsqueda y otra búsqueda más.`, p5 `rebusquedas no es la palabra completa.` |
   | `pages-5000.pdf` | 5 000 páginas 612×792; líneas `Página k de 5000` y `marcador-k`; la palabra `aguja` solo en las páginas 1234 y 4999 (línea 3 `Aquí hay una aguja.`) |
   | `pages-100000.pdf` | 100 000 páginas iguales; `Página k de 100000`, `marcador-k`; `aguja` solo en la 99 999 |
   | `pages-20000-flat.pdf` | 20 000 páginas como `pages-5000.pdf` pero con **todas** las páginas como hijos directos de un único `/Pages` (caso degenerado real: pdf.js lee el fichero entero) |
   | `sizes-mixed.pdf` | 6 páginas: A4 vertical `[0 0 595 842]`; Carta horizontal `[0 0 792 612]`; A3 `[0 0 842 1191]`; A5 `[0 0 420 595]`; A4 con `/Rotate 90`; A4 con `/MediaBox [100 100 695 942]`. Texto `Página k` + descripción |
   | `images-200.pdf` | 200 páginas A4 con texto `Página k de 200` y una imagen RGB 8 bits 600×400 propia de cada página (degradado: `r = (x + k) % 256`, `g = (y * 2) % 256`, `b = (k * 37) % 256`), comprimida, dibujada con `q 400 0 0 267 97 450 cm /Im1 Do Q` |
   | `corrupt-empty.pdf` | 0 bytes |
   | `corrupt-not-pdf.pdf` | `Esto no es un PDF.\n` repetido 20 veces |
   | `corrupt-truncated.pdf` | los primeros `floor(0.6 * n)` bytes de `basic-5.pdf` |
   | `corrupt-bad-startxref.pdf` | `basic-5.pdf` con el número tras `startxref` sustituido por `99999999` |
4. `tests/fixtures/ensure.ts`: `export function ensureFixtures(opts?: { readonly force?: boolean }): { readonly generated: string[] }` — crea `FIXTURES_DIR`; si `.version` ≠ `GENERATOR_VERSION` o `force`, regenera todo; si no, solo los que falten. Escribe `.version` al final.
5. `tests/fixtures/cli.ts`: llama a `ensureFixtures({ force: process.argv.includes('--force') })` e imprime con `process.stdout.write` cuántos generó y el tiempo. Script en `package.json`: `"fixtures": "node tests/fixtures/cli.ts --force"`.
6. Globales: `tests/setup/global-setup.ts` (Vitest: `export default function setup() { ensureFixtures(); }`) añadido como `globalSetup` en `vitest.config.ts`; `tests/e2e/global-setup.ts` (Playwright) igual, en `playwright.config.ts`.
7. Tests `tests/unit/fixtures.test.ts`: abre los ficheros con `getDocument({ data })` de `pdfjs-dist` (alias al build *legacy*) — es el único test que lo usa directamente — y comprueba los criterios.

## Criterios de aceptación
- [ ] (T) `buildPageTree` con 100 000 páginas y `fanout` 32: ningún nodo tiene más de 32 hijos y el `/Count` de la raíz es 100 000; `pages-20000-flat.pdf` tiene 20 000 páginas.
- [ ] `pnpm --filter lector-pdf fixtures` crea los 10 ficheros; un segundo `pnpm test` no los regenera (fecha de modificación igual).
- [ ] (T) `basic-5.pdf`: 5 páginas; el texto de la página 1 (unión de `items[].str`) contiene `Página 1 de 5` y `marcador-1`; página 3 contiene `BUSQUEDA`.
- [ ] (T) `pages-5000.pdf`: 5 000 páginas; el texto de la página 4999 contiene `aguja`; generación en < 1 s (medido en el test con `performance.now()`), tamaño < 3 MB.
- [ ] (T) `pages-100000.pdf`: `numPages === 100000`; generación < 10 s; tamaño < 40 MB; texto de la página 99 999 contiene `aguja`.
- [ ] (T) `sizes-mixed.pdf`: `getViewport({ scale: 1 })` de cada página da 595×842, 792×612, 842×1191, 420×595, 842×595 (rotada) y 595×842; `page.rotate` de la 5.ª es 90.
- [ ] (T) `images-200.pdf`: 200 páginas; la página 1 tiene un operador de imagen (`getOperatorList()` contiene `OPS.paintImageXObject`).
- [ ] (T) `corrupt-not-pdf.pdf` y `corrupt-empty.pdf` hacen fallar `getDocument` (la promesa rechaza, no se cuelga: `timeout` del test 10 s).
- [ ] Acentos: el texto extraído de `basic-5.pdf` página 1 contiene `murciélago` y `hindú` (WinAnsi correcto).
- [ ] `fixtures/pdf/generated/` no aparece en `git status`. `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Índice, enlaces, etiquetas, xref comprimido, anotaciones y formularios (PDF-003). Corpus externo (PDF-004).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/tests/fixtures/{paths,pdf-builder,catalog,ensure,cli}.ts` (nuevos); `apps/lector-pdf/tests/setup/global-setup.ts` y `apps/lector-pdf/tests/e2e/global-setup.ts` (nuevos); `apps/lector-pdf/tests/unit/fixtures.test.ts` (nuevo); `apps/lector-pdf/tsconfig.json` (`allowImportingTsExtensions`), `apps/lector-pdf/package.json` (script `fixtures`), `apps/lector-pdf/vitest.config.ts` y `apps/lector-pdf/playwright.config.ts` (globalSetup); esta ficha.
- Qué he hecho: generador propio de PDF sin dependencias (xref clásica de 20 bytes, árbol de páginas con fanout 32, WinAnsi, imágenes comprimidas) y los 10 fixtures del catálogo en `fixtures/pdf/generated/` (ignorado por git). `ensureFixtures` crea solo los que faltan salvo cambio de `GENERATOR_VERSION` o `--force`; se llama desde los globalSetup de Vitest y Playwright. Tests: 17 en `fixtures.test.ts` que cubren los criterios (T) y acentos, abriendo con pdf.js legacy.
- Comandos ejecutados y resultado: `pnpm fixtures` OK (10 generados, 2,8 s); `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (32 ficheros, 396 tests) y una segunda ejecución no regenera ningún fixture; `pnpm --filter lector-pdf e2e` 1 passed; `pnpm coverage` falla en `tests/unit/layout.test.ts` (2 tests de tiempo de PDF-006, no tocado por mí; cobertura de `core/` no se ha podido confirmar en esta pasada).
- Dudas o cosas que no he podido hacer: (1) `images-200.pdf` ocupa 44 MB (la ficha no fija límite; el degradado comprime mal con deflate); no afecta al repo porque va en `generated/`. (2) La ficha separa los ficheros en `tests/fixtures/` y el ADR-0011 cita `generate-fixtures.ts`; he seguido la ficha. (3) `pages-100000.pdf` pesa 31 MB, dentro del límite de 40 MB pero con poco margen si cambia el texto de las páginas.

### [revisor] ronda 1 — 2026-10-17 — CAMBIOS
Lint y typecheck OK; `fixtures.test.ts` pasa aislado (17/17), el diseño del generador cumple la ficha y `generated/` está ignorado.
1. `apps/lector-pdf/tests/unit/fixtures.test.ts:63` — el test «árbol de 100 000 páginas con fanout 32» no tiene `timeout` propio (5 s por defecto) y falla en `pnpm test` completo (7,3 s bajo carga; aislado pasa). Criterio «`pnpm test` con código 0» incumplido por un test de esta ficha — pasarle el timeout `HEAVY_TEST_MS` (y revisar los demás tests pesados que no lo llevan, p. ej. el de `pages-5000.pdf`) o aligerar el test.
2. `apps/lector-pdf/tests/unit/fixtures.test.ts:~143,~154` — las aserciones de tiempo (`< 1 s` y `< 10 s`) miden la generación bajo la carga paralela de Vitest, lo que las hace frágiles; mantener los umbrales de la ficha pero comprobar que no fallan en `pnpm test` completo (ejecutar 2-3 veces).
3. Nota (no es de esta ficha): en `pnpm test` también fallan `layout.test.ts` (PDF-006, 300 ms) y `annotations/commands.test.ts` (PDF-023, 2 s) por tiempo bajo carga; avisar al líder, pues impiden el código 0 global.
4. (opcional) `images-200.pdf` pesa 44 MB; documentarlo en el ADR-0011.

### [lider] suite de rendimiento — 2026-10-17
[[ADR-0012-suite-de-rendimiento]]: los asserts de tiempo de reloj pasan a `tests/perf/` (`pnpm perf`). Los dos de esta ficha en `tests/unit/fixtures.test.ts` (generación de `pages-5000.pdf` < 1 s y de `pages-100000.pdf` < 10 s) **no son motivo de rechazo** en esta revisión: hoy pasan también bajo `pnpm coverage`. Para no tocar un fichero en revisión, el traslado se hace en [[PDF-022-e2e-y-rendimiento-iteracion-1]] (paso 0). Revisor y tester: el fallo de `pnpm coverage` anotado en la ronda del programador es de PDF-006 y queda resuelto allí; valorad la cobertura con `pnpm coverage` una vez PDF-006 vuelva a verde o con `vitest run --coverage --project lector-pdf` excluyendo `layout.test.ts`.

### [programador] ronda 2 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/tests/unit/fixtures.test.ts` (quitados los asserts de tiempo de `pages-5000.pdf` y `pages-100000.pdf`; timeout `HEAVY_TEST_MS` en el test del árbol de 100 000 páginas y en el de 5 000); `apps/lector-pdf/tests/perf/fixtures.perf.test.ts` (nuevo: generación de `pages-5000.pdf` < 1 s y de `pages-100000.pdf` < 10 s con `measureBest`, umbrales de la ficha sin cambios); esta ficha.
- Qué he hecho: atendidos los dos puntos del revisor. Los asserts de tiempo de reloj se han movido a `tests/perf/` según ADR-0012 y el resto de `fixtures.test.ts` (tamaños, contenido, árbol, dañados) se queda en `tests/unit/`. Los tests pesados del fichero llevan timeout propio.
- Comandos ejecutados y resultado: `pnpm lint` OK (código 0); `pnpm typecheck` OK; `pnpm test` OK (35 ficheros, 426 tests); `pnpm perf` OK (3 ficheros, 5 tests, incluidos los 2 nuevos de generación). `pnpm perf` ejecutado a la vez con trabajo de otra ficha en curso: un test de `annotation-commands.perf.test.ts` (PDF-023, no tocado por mí) superó el timeout de 5 s en una pasada con carga y pasó en la siguiente.
- Dudas o cosas que no he podido hacer: no he ejecutado `pnpm coverage` (lo bloquea el fallo de PDF-006 anotado por el líder). El fichero `commands.test.ts` de PDF-023 y `annotation-commands.perf.test.ts` están sin commitear; no son de esta ficha y no los he incluido en el commit.

### [revisor] ronda 2 — 2026-10-17 — APROBADO
Lint, typecheck y `pnpm test` (35 ficheros, 426 tests, dos ejecuciones) y `pnpm perf` (5 tests) en verde. Los tests pesados llevan `HEAVY_TEST_MS`; los asserts de tiempo viven en `tests/perf/fixtures.perf.test.ts` con los umbrales de la ficha (ADR-0012). Los dos puntos de la ronda 1 quedan resueltos; el 3 era de otras fichas.
- (opcional) Documentar en el ADR-0011 que `images-200.pdf` pesa 44 MB.
- (opcional) `pnpm coverage` sin confirmar por el fallo de PDF-006; el tester debe valorarlo según la nota del líder.

