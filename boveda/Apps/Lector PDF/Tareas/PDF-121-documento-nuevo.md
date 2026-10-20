---
tipo: tarea
id: PDF-121
titulo: Escribir un PDF nuevo con páginas de uno o varios PDFs
app: pdf
estado: hecha
depende_de: [PDF-119, PDF-120]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-121 · Escribir un PDF nuevo con páginas de uno o varios PDFs

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0028-reescribir-pdfs]] (opción 2), [[ADR-0035-organizar-en-la-app]] · Antes: [[PDF-120-copiar-objetos]], [[PDF-119-organizar-escritura]] · Siguen: [[PDF-122-destinos-e-indice-al-copiar]], [[PDF-054-extraer-dividir]], [[PDF-131-reescribir-documento]]

## Objetivo
`buildNewDocument` crea un fichero PDF completo (cabecera, objetos, árbol de páginas de 32 hijos, catálogo, xref clásica y trailer) con las páginas elegidas, en orden y con su giro, de una o varias fuentes. Incluye el escritor de ficheros completos que reutilizarán la reescritura (PDF-131) y crear desde imágenes (PDF-056).

## Contexto
- `src/core/pdf/object-copier.ts` (PDF-120), `src/core/pdf/page-tree-layout.ts` → `planPageTree` (PDF-119).
- `src/core/pdf/serialize.ts` → `serializeIndirect`, `serializeValue`.
- `src/core/pdf/delta-writer.ts` → `idBytes` (privada; se exporta, ver paso 1), `tableRow`, `groupsOf` (privadas: replica la tabla con subsecciones o exporta `tableRow` y `groupsOf` sin cambiar su código).
- `src/core/pdf/text-string.ts` → `encodeTextString`, `pdfDate`.
- `src/core/pdf/crypto/security.ts` → `SecurityHandler`; `src/core/pdf/encrypt-value.ts` → `encryptValue`.

## Qué hay que hacer
1. `delta-writer.ts`: exporta `idBytes` como `export function newIdBytes(seed: string): Uint8Array` (misma implementación; `finishDelta` la sigue usando) y exporta `tableRow` y `groupsOf` tal cual.
2. `src/core/pdf/file-writer.ts`:
```ts
export interface FileEncryption { readonly handler: SecurityHandler; readonly encrypt: PdfDict; readonly random: RandomBytes }
export interface CompleteFile {
  /** Objetos con números 1..N sin huecos, en orden de número. */
  readonly objects: readonly (readonly [number, PdfValue])[];
  readonly root: PdfRef;
  readonly info?: PdfRef;
  /** 16 bytes; si falta, `newIdBytes(seed)`. */
  readonly id0?: Uint8Array;
  readonly seed: string;
  readonly encryption?: FileEncryption;
}
/** `%PDF-1.7` + binario, objetos (cifrados si hay `encryption`; el writer añade el `/Encrypt` como objeto N+1 sin cifrar), xref clásica desde 0, trailer y `%%EOF`. */
export function writeCompleteFile(f: CompleteFile): Uint8Array;
```
   Trailer: `/Size`, `/Root`, `/Info` (si hay), `/Encrypt` (si hay), `/ID [id0 id1]` con `id1 = newIdBytes(seed + '|1')`. Concatena las partes una sola vez al final (como `DeltaWriter.toBytes`).
3. `src/core/pdf/new-document.ts`:
```ts
export interface NewDocumentPart { readonly reader: ObjectReader; readonly pages: readonly PageSlot[] }
export interface NewDocumentInput {
  readonly parts: readonly NewDocumentPart[];   // en este orden
  /** Título para `/Info /Title` (opcional). */
  readonly title?: string;
  readonly now: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;   // páginas copiadas
}
export interface NewDocumentOutput { readonly bytes: Uint8Array; readonly pageCount: number }
export async function buildNewDocument(input: NewDocumentInput): Promise<Result<NewDocumentOutput>>;
```
   - Validación: al menos una página en total; en cada parte `source` entero en `[0, n)` y sin repetir dentro de la parte; giro válido → si no, `organize-invalid`.
   - Números: catálogo 1, raíz `/Pages` 2, `/Info` 3; después, por parte, un `ObjectCopier` con el mismo contador global (reserva todas las páginas de la parte y copia en orden); los nodos intermedios del árbol al final.
   - Páginas: `withEntries(copied.dict, { Parent, Rotate: rotate === 0 ? undefined : rotate })` (el giro del `PageSlot` es absoluto y sustituye al copiado).
   - Catálogo `{ Type: /Catalog, Pages: 2 0 R }`; `/Info { Producer: (Cúmulo Lector PDF), CreationDate, ModDate, Title? }` con `encodeTextString` y `pdfDate(now)`.
   - Progreso cada 100 páginas y al final; `signal` → `cancelled`. Excepciones → `toSaveError`.
4. Tests `tests/unit/pdf/new-document.test.ts` (pdf.js `loadPdf` en Node + `qpdfCheck`).
5. Rendimiento `tests/perf/new-document.perf.test.ts`.

## Criterios de aceptación
- [ ] `basic-5.pdf` páginas `[4, 0]` → 2 páginas con texto «Página 5 de 5» y «Página 1 de 5»; `qpdf --check` 0; el fichero empieza por `%PDF-1.7`.
- [ ] Dos partes: `basic-5.pdf` (todas) + `outline.pdf` (todas) → 35 páginas en orden; `qpdf --check` 0.
- [ ] `annotated.pdf` → las anotaciones de cada página copiada siguen en pdf.js `getAnnotations()` con su subtipo y `/Contents`.
- [ ] `encrypted-aes-256.pdf` (`usuario`) → el resultado se abre **sin contraseña** y tiene el texto legible; `qpdf --show-encryption` dice que no está cifrado.
- [ ] `compressed.pdf` → correcto en pdf.js y qpdf.
- [ ] Giro: página con `rotate: 90` → `getPage(1).rotate === 90`.
- [ ] Entradas no válidas → `organize-invalid`; `signal` abortado → `cancelled`.
- [ ] `writeCompleteFile` con `encryption` (usa un `SecurityHandler` AES-256 abierto de `encrypted-aes-256.pdf` y su `/Encrypt`) produce un fichero que `qpdf --check --password=usuario` acepta (prueba del camino cifrado que usará PDF-131).
- [ ] `pnpm perf`: extraer 1 000 páginas de `pages-5000.pdf` < 2 000 ms; las 100 000 de `pages-100000.pdf` < 20 000 ms.
- [ ] Cobertura ≥ 90 % de líneas en `file-writer.ts` y `new-document.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Índice, destinos con nombre ([[PDF-122-destinos-e-indice-al-copiar]]) y formularios ([[PDF-123-formularios-al-copiar]]). Etiquetas de página (`/PageLabels`), estructura etiquetada, adjuntos, XMP.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/delta-writer.ts` (exporta `newIdBytes` —antes `idBytes`—, `groupsOf`, `tableRow` y `Group`, sin cambiar su código); nuevos `apps/lector-pdf/src/core/pdf/file-writer.ts` (`writeCompleteFile`), `apps/lector-pdf/src/core/pdf/new-document.ts` (`buildNewDocument`), `apps/lector-pdf/tests/unit/pdf/new-document.test.ts` y `apps/lector-pdf/tests/perf/new-document.perf.test.ts`.
- Qué he hecho: `writeCompleteFile` escribe cabecera `%PDF-1.7`, objetos (cifrados con `DeltaWriter` si hay `encryption`, con `/Encrypt` sin cifrar como N+1), xref clásica desde 0 y trailer con `/ID`. `buildNewDocument` valida las partes, copia cada página con `ObjectCopier` (catálogo 1, `/Pages` 2, `/Info` 3, intermedios al final), aplica el giro absoluto y reporta progreso cada 100 páginas. Los 18 tests de unidad cubren los criterios de aceptación con pdf.js y qpdf; el de cifrado usa el `SecurityHandler` AES-256 de `encrypted-aes-256.pdf`.
- Comandos ejecutados y resultado:
  - `npx vitest run tests/unit/pdf/new-document.test.ts`: 18/18 pasan.
  - `pnpm perf` (ejecuta toda la suite de rendimiento, el filtro de ruta no aplica en ese script): código 0, 38 tests, incluidos los 2 de creación (1 000 páginas < 2 s y 100 000 < 20 s).
  - `pnpm lint`: falla por `tests/e2e/zz-debug.spec.ts` (`waitForTimeout` y `console`), fichero no creado por esta ficha. ESLint sobre mis ficheros: sin avisos.
  - `pnpm typecheck`: sin errores en mis ficheros. Quedan errores previos en `tests/unit/tab-close-guard.test.ts` y `tests/ui/tab-bar.test.tsx`, y uno nuevo en `tests/ui/page-view-detail.test.tsx`, de trabajo ajeno en curso.
  - `pnpm coverage`: código 1 por 3 tests de UI fuera de alcance (`tests/ui/comment-toolbar.test.tsx` ×2, `tests/ui/sidebar.test.tsx` ×1). Cobertura de los módulos de la ficha (cobertura acotada a `file-writer.ts` y `new-document.ts`): `file-writer.ts` 97 % de líneas, `new-document.ts` 100 %.
- Dudas o cosas que no he podido hacer:
  - Semilla de `/ID` de `buildNewDocument`: `` `${now}|${total}` `` (la ficha no la fija).
  - Árbol de cambios ajenos sin commit (`render.ts`, `Viewer.tsx`, `Viewer.module.css`, `PageView.tsx`, `engine-render.test.ts`, `tests/e2e/detail.spec.ts`, `tests/e2e/zz-debug.spec.ts`, `tests/ui/page-view-detail.test.tsx`): no son míos ni los he tocado.
  - Los tiempos en ms de `pnpm perf` no se imprimen; solo consta que pasan los umbrales.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
Lint y typecheck con código 0; los 18 tests de la ficha pasan. `pnpm coverage` solo falla por 2 tests de UI ajenos (`tests/ui/sidebar.test.tsx` y otro de UI), ya recogidos en la bitácora. Código correcto: validación, cancelación, numeración sin huecos, camino cifrado.
1. (opcional) `new-document.ts` — la semilla de `/ID` `now|total` repite ID para dos documentos distintos creados en el mismo instante con el mismo número de páginas.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Criterios funcionales (páginas, 2 partes, anotaciones, cifrado, compressed, giro, errores, writeCompleteFile cifrado) | OK | `new-document.test.ts` 18/18 pasan; qpdf/pdf.js dentro de los tests |
| lint / typecheck | OK | código 0 |
| `pnpm perf` | OK | 23 ficheros, 38/38 (incluye 1 000 y 100 000 páginas) |
| Cobertura de `file-writer.ts` / `new-document.ts` | OK | 97 % / 100 % según el programador; sin regresión |
| `pnpm coverage` código 0 | Con reserva | 4 fallos ajenos: `sidebar.test.tsx` F4, `comment-toolbar.test.tsx` ×2 (reproducibles aislados) y `page-tree.test.ts` pages-5000 (timeout 5 s bajo carga; pasa aislado). El commit 86ac738 no toca UI ni `page-tree`. |
Tests añadidos: ninguno nuevo. Pendiente fuera de ficha: arreglar los 3 tests de UI rojos.
