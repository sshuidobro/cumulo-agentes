---
tipo: tarea
id: PDF-002
titulo: Generador de fixtures PDF (páginas, tamaños, imágenes y ficheros dañados)
app: pdf
estado: en-curso
depende_de: [PDF-001]
intentos: 0
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
