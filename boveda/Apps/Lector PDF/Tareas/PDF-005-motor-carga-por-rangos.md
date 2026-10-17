---
tipo: tarea
id: PDF-005
titulo: Motor PDF - carga por rangos, errores tipados y escaneo de dimensiones
app: pdf
estado: en-curso
depende_de: [PDF-002, COM-005]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, motor]
---

# PDF-005 · Motor: carga por rangos, errores y dimensiones

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0008-plataforma-ficheros]] · Investigación: [[Librerias y arquitectura PDF]] (secciones 2 y 5) · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
`loadPdf(source, opts)` abre un PDF leyendo **solo los rangos que pide pdf.js** desde un `ByteSource`, con configuración segura, devuelve errores como valores con mensaje en español y permite cancelar. `scanPageDims` recorre las páginas por lotes para conocer su tamaño real.

## Contexto
- Leer: [[ADR-0007-motor-y-visor-pdf]], `packages/platform/src/types.ts` (`ByteSource`), `packages/shared/src/result.ts`, `apps/lector-pdf/tests/fixtures/paths.ts`.
- Comprobado por el líder con pdf.js 6.4.299 en Node: `new (class extends PDFDataRangeTransport { requestDataRange(b, e) { ...this.onDataRange(b, chunk) } })(size, new Uint8Array(0))` + `getDocument({ range, disableAutoFetch: true, disableStream: true })` abre `pages-5000.pdf` en ~600 ms. Excepciones: `PasswordException` (`code` 1 = `PasswordResponses.NEED_PASSWORD`, 2 = `INCORRECT_PASSWORD`), `InvalidPDFException`.
- En Node (tests) pdf.js lee cmaps y fuentes de **rutas de disco**; en el navegador, de URLs. Por eso `assetBaseUrl` es un parámetro.
- Solo `src/engine/**` importa `pdfjs-dist`.

## Qué hay que hacer
1. `src/engine/pdfjs.ts`: único reexportador:
   ```ts
   export { getDocument, PDFDataRangeTransport, AnnotationMode, TextLayer, InvalidPDFException, PasswordException,
     PasswordResponses, RenderingCancelledException, OPS } from 'pdfjs-dist';
   export type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask, PDFDocumentLoadingTask } from 'pdfjs-dist';
   export type { TextContent, TextItem, TextMarkedContent, RefProxy } from 'pdfjs-dist/types/src/display/api';
   ```
2. `src/core/errors.ts`:
   ```ts
   export type PdfErrorCode = 'empty' | 'not-pdf' | 'corrupt' | 'password-required' | 'password-incorrect' | 'io' | 'cancelled';
   export const PDF_ERROR_MESSAGES: Readonly<Record<PdfErrorCode, string>>;
   export function pdfError(code: PdfErrorCode, cause?: unknown): AppError;
   ```
   Textos: empty "El fichero está vacío (0 bytes)." · not-pdf "Este fichero no es un PDF." · corrupt "El PDF está dañado y no se puede abrir." · password-required "Este PDF está protegido con contraseña. Abrir PDFs con contraseña llegará en una próxima versión." · password-incorrect "La contraseña no es correcta." · io "No se ha podido leer el fichero. Comprueba que sigue en su sitio." · cancelled "Apertura cancelada."
3. `src/engine/range-transport.ts`:
   ```ts
   export function createRangeTransport(source: ByteSource, onError: (e: unknown) => void): PDFDataRangeTransport;
   ```
   Subclase de `PDFDataRangeTransport` construida con `(source.size, new Uint8Array(0))`; `requestDataRange(begin, end)` → `source.read(begin, Math.min(end, source.size))` → `this.onDataRange(begin, chunk)`; si rechaza → `onError(e)` (no llames a `onDataRange`).
4. `src/engine/load.ts`:
   ```ts
   export interface LoadOptions {
     readonly assetBaseUrl: string;            // termina en '/'; contiene cmaps/, standard_fonts/, wasm/, iccs/
     readonly password?: string;
     readonly signal?: AbortSignal;
     readonly onProgress?: (loaded: number, total: number) => void;
   }
   export interface LoadedPdf {
     readonly doc: PDFDocumentProxy;
     readonly numPages: number;
     readonly fingerprint: string;              // doc.fingerprints[0]; si es null, `size-<n>-<hex de los primeros 64 bytes>`
     onIoError(cb: (e: AppError) => void): () => void; // errores de lectura posteriores a abrir
     destroy(): Promise<void>;                  // loadingTask.destroy(); idempotente
   }
   export async function loadPdf(source: ByteSource, opts: LoadOptions): Promise<Result<LoadedPdf>>;
   ```
   Pasos: `size === 0` → `empty`. Lee `[0, min(1024, size))`; si (como latin1) no contiene `%PDF-` → `not-pdf`. Llama a `getDocument({ range, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, isEvalSupported: false, enableXfa: false, cMapUrl: base+'cmaps/', cMapPacked: true, standardFontDataUrl: base+'standard_fonts/', wasmUrl: base+'wasm/', iccUrl: base+'iccs/', verbosity: 0, ...(password ? { password } : {}) })`. `loadingTask.onProgress` → `opts.onProgress`. Si `signal` aborta (antes o durante) → `loadingTask.destroy()` y `cancelled`. Si el transporte llama a `onError` antes de abrir → `destroy()` y `io` (con `cause`). Mapeo de excepciones: `PasswordException` → `password-required`/`password-incorrect`; `InvalidPDFException` → `corrupt`; cualquier otra → `corrupt` y `createLogger('engine').warn('loadPdf', e)`. Nunca lanza.
5. `src/engine/page-dims.ts`:
   ```ts
   export interface PageDimsEntry { readonly index: number; readonly width: number; readonly height: number; readonly rotation: number }
   export async function readPageDims(page: PDFPageProxy): Promise<PageDimsEntry>; // getViewport({ scale: 1, rotation: 0 }) → width/height; rotation = page.rotate; index = page.pageNumber - 1
   export async function scanPageDims(doc: PDFDocumentProxy, opts: {
     readonly from?: number; readonly batchSize?: number;   // por defecto 0 y 50
     readonly signal?: AbortSignal;
     readonly onBatch: (entries: readonly PageDimsEntry[]) => void;
   }): Promise<'done' | 'cancelled'>;
   ```
   `scanPageDims` pide las páginas en orden con `doc.getPage(i + 1)`, acumula `batchSize` entradas, llama a `onBatch`, y entre lotes cede el hilo con `await new Promise(r => setTimeout(r, 0))`. Comprueba `signal.aborted` antes de cada página.
6. `src/engine/index.ts`: reexporta `loadPdf`, `LoadedPdf`, `LoadOptions`, `readPageDims`, `scanPageDims`, `PageDimsEntry`, `createRangeTransport` y los tipos/valores de `pdfjs.ts` que use la UI.
7. `tests/helpers/pdfjs-node.ts`: `export function nodeAssetBase(): string` → ruta absoluta de la carpeta de `pdfjs-dist` + `/` (con `createRequire(import.meta.url).resolve('pdfjs-dist/package.json')`), y `export function fixtureSource(name: string): ByteSource` (lee `FIXTURES_DIR/name` con `readFileSync` → `memorySource`) y `export function countingSource(inner: ByteSource): ByteSource & { readonly reads: number; readonly bytesRead: number }`.
8. Tests `tests/unit/engine-load.test.ts` y `tests/unit/engine-page-dims.test.ts`.

## Criterios de aceptación
- [ ] (T) `basic-5.pdf` → `ok`, `numPages 5`, `fingerprint` no vacío y estable entre dos cargas.
- [ ] (T) `pages-5000.pdf` → `ok` en < 3 s; texto de la página 5000 contiene `Página 5000 de 5000`.
- [ ] (T) `pages-100000.pdf` → `ok` y `numPages 100000` en < 3 s; con `countingSource`, `bytesRead` al abrir y leer la página 1 es < 30 % del tamaño (prueba de que lee por rangos; el líder midió ~15 %; anota el % en el Registro).
- [ ] (T) `pages-20000-flat.pdf` (árbol plano: pdf.js lo lee entero) → `ok` en < 5 s.
- [ ] (T) `corrupt-empty.pdf` → `empty`; `corrupt-not-pdf.pdf` → `not-pdf` sin llamar a pdf.js (espía: `getDocument` no se invoca; verifica con `countingSource.reads === 1`); `corrupt-truncated.pdf` y `corrupt-bad-startxref.pdf` → `ok` con ≥ 1 página **o** `corrupt` (nunca lanza ni se cuelga; timeout del test 10 s; anota qué devuelve cada uno).
- [ ] (T) Una fuente cuyo `read` rechaza a partir de la 2.ª lectura → `err` `io` en < 5 s.
- [ ] (T) `AbortController.abort()` justo después de llamar → `err` `cancelled`; `destroy()` dos veces no lanza.
- [ ] (T) `scanPageDims(sizes-mixed)` da 6 entradas con `(595,842,0) (792,612,0) (842,1191,0) (420,595,0) (595,842,90) (595,842,0)`; con `batchSize 2` → 3 llamadas a `onBatch`; abortando tras el primer lote → `'cancelled'` y 1 llamada.
- [ ] (T, comportamiento, `tests/unit/engine-page-dims.test.ts`) `scanPageDims` de `pages-5000.pdf` entrega 5 000 entradas en orden, en lotes de `batchSize`.
- [ ] (T, rendimiento, `tests/perf/engine-page-dims.perf.test.ts`, medida única con `performance.now()`, sin `measureBest`) `scanPageDims` de `pages-5000.pdf` termina en < 10 s y ningún lote tarda > 100 ms (tiempo entre llamadas a `onBatch`; anota máximo y total).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `src/core/errors.ts` 100 % de líneas.

## Fuera de alcance
- Pedir contraseña (PDF-046). Render (PDF-010). Uso desde la UI (PDF-008).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] suite de rendimiento — 2026-10-17
Por [[ADR-0012-suite-de-rendimiento]], los asserts de tiempo de reloj (`performance.now()`) no van en `tests/unit/` ni `tests/ui/` (fallan bajo `pnpm coverage`), sino en `tests/perf/*.perf.test.ts`, que se ejecuta con `pnpm perf` (sin cobertura, en serie). Presupuestos sin cambios. Los relojes falsos inyectados (`now`) siguen en `tests/unit/`.
Si `vitest.perf.config.ts` (raíz), el script `perf` del `package.json` raíz, su entrada en `tsconfig.json` y `apps/lector-pdf/tests/perf/measure.ts` aún no existen (PDF-006 sin terminar), créalos **exactamente** como dice [[PDF-006-layout-virtual]] (Registro, entrada del líder, pasos 1-4); si existen, no los cambies.
