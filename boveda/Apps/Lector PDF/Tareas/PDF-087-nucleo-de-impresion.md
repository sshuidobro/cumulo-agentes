---
tipo: tarea
id: PDF-087
titulo: Núcleo de impresión - rangos, plan de hoja y documento temporal con el incremento
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [stack-typescript-react, formatos-ofimatica]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, impresion, core]
---

# PDF-087 · Núcleo de impresión: rangos, plan de hoja y documento temporal con el incremento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0021-impresion]]

## Objetivo
Las piezas sin interfaz que necesita «Imprimir»: interpretar el rango de páginas, calcular hoja, orientación y escala de cada página, abrir un documento temporal «original + incremento» y dibujar una página para imprimir a un `Blob` PNG.

## Contexto
- Leer: `src/engine/load.ts` (`loadPdf`), `src/engine/render.ts`, `packages/platform/src/types.ts` (`ByteSource`), `src/core/page-input.ts` (cómo se interpretan números de página escritos), `src/state/save-actions.ts` (`buildDelta`).

## Qué hay que hacer
1. `src/core/print/range.ts`:
```ts
/** "1-3, 5, 8-" → índices 0-based ordenados y sin repetir. Admite espacios, «–», y «8-» = hasta el final. null si hay algo no válido o fuera de [1, numPages]. */
export function parsePageRange(text: string, numPages: number): readonly number[] | null;
```
2. `src/core/print/plan.ts`:
```ts
export interface SheetPlan { readonly sheetWidthPt: number; readonly sheetHeightPt: number }
export interface PagePrintPlan { readonly rotate: 0 | 90; readonly widthPt: number; readonly heightPt: number } // tamaño ya girado (para la hoja)
/** Hoja = tamaño (con /Rotate) de la primera página del rango. */
export function sheetFor(first: { readonly widthPt: number; readonly heightPt: number }): SheetPlan;
/** Con autoRotate, gira 90° si la orientación de la página no coincide con la de la hoja. */
export function planPage(page: { readonly widthPt: number; readonly heightPt: number }, sheet: SheetPlan, autoRotate: boolean): PagePrintPlan;
export const PRINT_DPI = { normal: 150, high: 300 } as const;
/** Escala de render para `dpi`, limitada para que el lienzo no pase de MAX_CANVAS_PIXELS. */
export function printScale(widthPt: number, heightPt: number, dpi: number): number; // dpi/72, reducido si hace falta
```
3. `src/core/pdf/concat-source.ts`:
```ts
/** ByteSource = `base` seguido de `tail` (en memoria). Lee por rangos sin copiar `base` entero. */
export function concatSource(base: ByteSource, tail: Uint8Array): ByteSource;
```
4. `src/engine/print-render.ts`:
```ts
/** Dibuja la página `index` (0-based) para imprimir y devuelve un PNG. Libera el lienzo antes de resolver. */
export async function renderPageForPrint(doc: PDFDocumentProxy, index: number, o: { readonly dpi: number; readonly withComments: boolean; readonly signal: AbortSignal }): Promise<Blob | 'cancelled'>;
```
   `page.render({ intent: 'print', annotationMode: ENABLE_STORAGE, canvas, viewport: page.getViewport({ scale: printScale(...) }) })`, después `canvas.toBlob('image/png')`, `canvas.width = canvas.height = 0`, `page.cleanup()`. Con `withComments: false`, antes de dibujar, por cada anotación de la página (`page.getAnnotations({ intent: 'print' })`) cuyo `annotationType` no sea `20` (Widget): `doc.annotationStorage.setValue(id, { noPrint: true })` (solo se usa con el documento temporal o se deshace al terminar: devuelve las claves tocadas y bórralas después).
5. `src/state/print-source.ts`:
```ts
export interface PrintSource { readonly doc: PDFDocumentProxy; readonly temporary: boolean; readonly unsavedIncluded: boolean; dispose(): Promise<void> }
/** Documento a imprimir: el abierto si no hay cambios; si los hay, uno temporal con `concatSource(file.source, delta)`. Si el delta falla, el abierto con `unsavedIncluded: false`. */
export async function openPrintSource(): Promise<PrintSource | null>;
```
   Reutiliza la construcción del delta de `save-actions.ts` (exporta desde allí `buildCurrentDelta(file): Promise<Result<Uint8Array | null>>`, `null` = sin cambios, y úsala también en `save`/`saveAs`).
6. Tests: `tests/unit/print-range.test.ts`, `print-plan.test.ts`, `concat-source.test.ts`; `tests/unit/print-render.test.ts` con pdf.js en Node (si el entorno de tests de Node no tiene `canvas`, prueba `renderPageForPrint` en jsdom con lienzo simulado y comprueba los parámetros de `render`); `tests/ui/print-source.test.ts`.

## Criterios de aceptación
- [ ] `parsePageRange('1-3, 5', 10)` → `[0,1,2,4]`; `'8-'` con 10 → `[7,8,9]`; `'3–1'` → `[0,1,2]`; `'0'`, `'11'`, `'a'`, `''`, `'1,,2'` → `null`.
- [ ] `planPage` de una página apaisada 842×595 en hoja vertical 595×842 con `autoRotate` → `rotate: 90`; sin `autoRotate` → `0`.
- [ ] `printScale(595, 842, 300)` = `300/72`; para una página de 5 000×5 000 pt a 300 ppp la escala da un lienzo ≤ 33 554 432 píxeles.
- [ ] `concatSource`: lecturas que cruzan el límite base/tail devuelven los bytes correctos (test con 1 000 lecturas aleatorias contra el array concatenado); `size` = base + tail.
- [ ] `openPrintSource` con una anotación sin guardar en `basic-5.pdf` → `temporary: true`, `unsavedIncluded: true` y el documento temporal tiene la anotación en `getAnnotations()`; sin cambios → `temporary: false`; `dispose()` destruye solo el temporal.
- [ ] Guardar (Ctrl+S, Guardar como) sigue pasando todos sus tests tras extraer `buildCurrentDelta`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Diálogo, contenedor de impresión y `window.print()` (PDF-044).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
