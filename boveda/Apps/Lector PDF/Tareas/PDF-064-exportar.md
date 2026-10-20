---
tipo: tarea
id: PDF-064
titulo: Exportar a imágenes y texto - núcleo y render
app: pdf
estado: hecha
depende_de: [PDF-022]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, exportar]
---

# PDF-064 · Exportar a imágenes y texto: núcleo y render

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0032-exportar-imagenes-y-texto]], [[ADR-0021-impresion]] · Paridad: [[Paridad Adobe Acrobat]] · Sigue: [[PDF-113-exportar-interfaz]]

> 2026-10-19 (líder): se reparte en núcleo y render (esta ficha) e interfaz ([[PDF-113-exportar-interfaz]]). DOCX queda fuera hasta que exista el procesador de textos.

## Objetivo
Funciones probadas para exportar: pintar una página a PNG o JPEG a una resolución dada (con o sin comentarios), nombres de fichero, ZIP de varias imágenes y el TXT con el texto en orden de lectura.

## Contexto
- [[ADR-0032-exportar-imagenes-y-texto]] («Decisión»).
- `src/engine/print-render.ts` → `renderPageForPrint`, `PrintRenderOptions`, `hideComments`, `restoreStorage`, `canvasToPng`.
- `src/core/print/plan.ts` → `printScale`; `src/core/canvas-size.ts` (`MAX_CANVAS_PIXELS`, `MAX_CANVAS_DIM`).
- `src/core/search/page-text.ts` → `buildPageText`, `TextItemLike`.
- `fflate` (ya es dependencia) → `zipSync`.
- Tests de referencia: `tests/unit/print-*.test.ts` o los de `engine/print-render` (busca con `Grep -n renderPageForPrint tests`).

## Qué hay que hacer
1. `src/engine/print-render.ts`: generaliza sin cambiar lo que hace imprimir.
```ts
export interface PageImageOptions {
  readonly dpi: number;
  readonly withComments: boolean;
  readonly signal: AbortSignal;
  readonly type: 'image/png' | 'image/jpeg';
  readonly quality?: number; // solo JPEG; por defecto 0.92
}
export interface PageImage { readonly blob: Blob; readonly width: number; readonly height: number; readonly dpi: number } // dpi real (menor si printScale recortó)
export async function renderPageImage(doc: PDFDocumentProxy, index: number, o: PageImageOptions): Promise<PageImage | 'cancelled'>;
```
   `renderPageForPrint(doc, index, o)` pasa a ser `renderPageImage(doc, index, { ...o, type: 'image/png' })` devolviendo solo `blob`. JPEG: antes de pintar, rellena el lienzo de blanco (`fillRect`) para que las zonas transparentes no salgan negras. `dpi` real = `scale × 72` redondeado a entero.
2. `src/core/export/plan.ts` (puro):
```ts
export type ExportFormat = 'png' | 'jpeg' | 'txt';
export const EXPORT_DPIS = [72, 150, 300, 600] as const;
export const DEFAULT_EXPORT_DPI = 150;
export const MAX_ZIP_BYTES = 1_000_000_000;
/** «Informe final.PDF» → «Informe final»; caracteres no válidos en Windows (<>:"/\|?* y controles) → «_»; sin puntos ni espacios al final; vacío → «documento». */
export function exportBaseName(fileName: string): string;
/** `ext`: `png` o `jpg`. Una página: «<base>-p<N>.<ext>». En ZIP: número con ceros a max(4, cifras de total): «<base>-p0007.png». */
export function imageFileName(base: string, pageNumber: number, total: number, format: 'png' | 'jpeg', inZip: boolean): string;
export function zipFileName(base: string): string;   // «<base>-imagenes.zip»
export function txtFileName(base: string): string;   // «<base>.txt»
/** Píxeles de la página a `dpi` con el mismo tope que imprimir: { width, height, reduced } (reduced = printScale recortó). */
export function imagePixelSize(widthPt: number, heightPt: number, dpi: number): { readonly width: number; readonly height: number; readonly reduced: boolean };
/** Estimación del tamaño de las imágenes: Σ (ancho × alto × 4 / 3) bytes. */
export function estimateImagesBytes(sizes: readonly { readonly widthPt: number; readonly heightPt: number }[], dpi: number): number;
/** Texto de una página para TXT: `buildPageText(items).raw` con espacios finales de cada línea quitados. */
export function pageTextForExport(items: readonly TextItemLike[]): string;
/** UTF-8 con BOM; saltos `\r\n`; páginas unidas con `\r\n\f\r\n`; termina en `\r\n`. */
export function buildTxt(pages: readonly string[]): Uint8Array;
/** ZIP sin recomprimir (`level: 0`), entradas en el orden dado. */
export function buildZip(entries: readonly { readonly name: string; readonly bytes: Uint8Array }[]): Uint8Array;
```
3. Tests: `tests/unit/export-plan.test.ts` (Node) y casos en el test de `print-render` (jsdom con `PDFDocumentProxy`/`PDFPageProxy` falsos y `canvas.toBlob` simulado: comprueba tamaño del lienzo, `type`, `quality` y el relleno blanco de JPEG). La comprobación en navegador real (decodificar las imágenes) se hace en el E2E de [[PDF-113-exportar-interfaz|PDF-113]].

## Criterios de aceptación
- [ ] Unit (jsdom, página falsa de 612×792 pt): `renderPageImage` a 150 ppp deja el lienzo en 1275×1650 y devuelve `width`/`height`/`dpi` = 1275/1650/150; a 72 ppp en JPEG llama a `toBlob(cb, 'image/jpeg', 0.92)` tras un `fillRect` blanco; `withComments: false` marca `noPrint` y lo restaura al terminar (como imprimir); `signal` abortado → `'cancelled'` y el lienzo liberado (`width === 0`).
- [ ] Unit: `imagePixelSize(612, 792, 600)` devuelve `reduced: true` y un producto ≤ `MAX_CANVAS_PIXELS` (5100×6600 = 33 660 000 > 33 554 432); un caso que cabe (300×300 pt a 600 ppp = 2500×2500) no se recorta. (Criterio corregido por el revisor: el original suponía que 5100×6600 cabía.)
- [ ] Unit: `exportBaseName('a:b?.PDF')` = `a_b_`; `exportBaseName('...pdf')` = `documento`; `imageFileName('x', 7, 120, 'png', true)` = `x-p0007.png`; con 12 000 páginas `x-p00007.png`.
- [ ] Unit: `buildTxt(['Hola\nmundo', 'Adiós'])` = BOM + `Hola\r\nmundo\r\n\f\r\nAdiós\r\n` en UTF-8; el texto de `basic-5.pdf` (pdf.js en Node) contiene las 5 líneas «Página N de 5» en orden.
- [ ] Unit: `buildZip` de 3 entradas se descomprime con `unzipSync` de `fflate` en las mismas entradas y bytes.
- [ ] Imprimir no cambia: los tests de impresión actuales pasan sin modificarlos.
- [ ] Cobertura de `src/core/export/plan.ts` ≥ 95 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Diálogo, progreso, guardado y permisos (PDF-113). DOCX, TIFF, HTML. OCR del texto de imágenes.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/engine/print-render.ts` (generalizado a `renderPageImage`; `renderPageForPrint` pasa a envoltorio PNG), `apps/lector-pdf/src/core/export/plan.ts` (nuevo, núcleo puro), `apps/lector-pdf/tests/unit/export-plan.test.ts` (nuevo), `apps/lector-pdf/tests/unit/print-render.test.ts` (solo añadido el `describe` de `renderPageImage`; los tests de impresión existentes sin tocar), esta ficha.
- Qué he hecho: `renderPageImage` con PNG o JPEG, dpi real y relleno blanco en JPEG; `renderPageForPrint` sigue con la misma firma. Núcleo `core/export/plan.ts` con todas las funciones de la ficha. Cobertura de `plan.ts`: 100 % de líneas. Lint y tests de mis ficheros limpios.
- Comandos ejecutados y resultado:
  - `npx vitest run tests/unit/print-render.test.ts tests/unit/print-actions.test.ts tests/ui/print-dialog.test.tsx`: 44 pasan (impresión existente sin cambios).
  - `npx vitest run tests/unit/export-plan.test.ts`: 27 pasan.
  - `npx eslint --max-warnings 0` sobre mis 4 ficheros: limpio. `pnpm typecheck`: limpio.
  - `pnpm lint`: falla por ficheros ajenos en curso: `tests/unit/compare/diff.test.ts` (non-null assertions, PDF-063) y `tests/unit/read-aloud/probe.test.ts` (console, PDF-067).
  - `pnpm coverage`: falla por ficheros ajenos: `read-aloud/probe.test.ts` ya no existe al ejecutar; `tests/unit/fixtures.test.ts` espera 25 fixtures y hay 26. Todo lo demás pasa (2525 tests).
  - `pnpm --filter lector-pdf e2e`: primera vez 1 fallo en `pdfjs-deferred.spec.ts` (abrir con chunk en vuelo, presupuesto de tiempo bajo carga); aislado pasa; segunda ejecución completa: 225 pasan, código 0.
- Dudas o cosas que no he podido hacer:
  - El criterio «612×792 a 600 ppp = 5100×6600 sin recortar» no se cumple: 33 660 000 píxeles superan `MAX_CANVAS_PIXELS` (33 554 432), así que se recorta. Los tests cubren el caso recortado (`reduced: true`, producto ≤ tope) y un caso que cabe (300×300 pt a 600 ppp = 2500×2500).
  - `buildZip` lanza `RangeError` si se repite un nombre de entrada, en vez de perder una entrada en silencio. No estaba en la ficha; es una guarda y se puede quitar si no la quieres.
  - Los tests de render están en `tests/unit/print-render.test.ts` (como pide la ficha); el test del TXT con `basic-5.pdf` está en `export-plan.test.ts`.
  - Pendiente de la ficha: que `pnpm lint` y `pnpm coverage` pasen en limpio depende de que PDF-063 y PDF-067 terminen sus ficheros.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Lint, typecheck y 45 tests de mis ficheros (export-plan, print-render) en verde; impresión sin cambios; `plan.ts` bien (nombres, TXT, ZIP, tope compartido con `printScale`).
- Sobre 600 ppp: el código es correcto y el criterio tenía un error aritmético (5100×6600 supera `MAX_CANVAS_PIXELS`). Se recorta, como imprimir; he corregido el criterio en la ficha. PDF-113 debe avisar en la interfaz usando `reduced`/`dpi` real.
- (opcional) La guarda `RangeError` de `buildZip` con nombres repetidos es razonable; se queda.
- `pnpm lint`/`coverage` globales siguen rojos por ficheros ajenos (063/067/fixtures), no de esta ficha.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Unit renderPageImage, imagePixelSize, nombres, TXT, ZIP | OK | `pnpm coverage`: 212 ficheros, 2583 tests pasan (incluye export-plan 27 y print-render) |
| Imprimir no cambia | OK | tests de impresión existentes dentro de la batería, en verde |
| Cobertura plan.ts >= 95 % | OK | 100 % líneas, 100 % ramas |
| lint, typecheck, coverage, e2e | OK | `pnpm lint`, `pnpm typecheck`, `pnpm coverage` y `pnpm --filter lector-pdf e2e` (225 pasan) con código 0 |
Tests añadidos: ninguno (los del programador cubren cada criterio). Rendimiento: sin presupuesto propio; e2e @perf en verde.
