---
tipo: tarea
id: PDF-064
titulo: Exportar a imágenes y texto - núcleo y render
app: pdf
estado: pendiente
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
- [ ] Unit: `imagePixelSize(612, 792, 600)` = 5100×6600 sin recortar si cabe en `MAX_CANVAS_PIXELS`; si no, `reduced: true` y el producto ≤ `MAX_CANVAS_PIXELS`.
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
