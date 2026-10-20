---
tipo: tarea
id: PDF-061
titulo: OCR - capa de texto invisible por incremento (núcleo)
app: pdf
estado: hecha
depende_de: [PDF-059, PDF-118]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, ocr, nucleo]
---

# PDF-061 · OCR: capa de texto invisible por incremento (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0038-ocr-local-tesseract]], [[ADR-0036-anadir-contenido-aplanando]] · Paridad: [[Paridad Adobe Acrobat]] §11 · Antes: [[PDF-059-anadir-texto-imagen]] (`page-content.ts`) · Siguen: [[PDF-133-ocr-motor]], [[PDF-134-ocr-interfaz]]

## Objetivo
Dadas las palabras reconocidas de cada página (texto y caja en coordenadas de PDF), escribir un incremento que añade a esas páginas una capa de texto **invisible** (`3 Tr`) alineada con la imagen, para buscar, seleccionar y copiar.

## Contexto
- `src/core/pdf/page-content.ts` → `effectiveResources`, `freeResourceName`, `withResource`, `wrapStreams`, `wrappedContents` (PDF-059).
- `src/core/annotations/appearance.ts` → `HELV_FONT`; `src/core/annotations/winansi.ts` → `toWinAnsi`; `src/core/annotations/helvetica-widths.ts` → `textWidth`.
- `src/core/pdf/delta-writer.ts` → `startDelta`, `reserveXref`, `finishDelta`; `src/core/pdf/page-tree.ts` (para `/Rotate` efectivo: `readPageRotations` o la lógica de antecesores).
- ISO 32000-1 §9.3.6 (modo de renderizado 3: invisible), §9.4.2 (`Tm`, `Tz`).

## Qué hay que hacer
1. `src/core/ocr/text-layer.ts`:
```ts
/** Caja en espacio de usuario de la página (puntos): [x0, y0, x1, y1] con x0 < x1 y y0 < y1. */
export interface OcrWord { readonly text: string; readonly box: readonly [number, number, number, number] }
export interface OcrPage { readonly pageIndex: number; readonly rotate: PageRotation; readonly words: readonly OcrWord[] }
/** Operadores de la capa: un bloque BT…ET por palabra. `font` = nombre del recurso de fuente. */
export function ocrOperators(page: OcrPage, font: string): string;
export interface OcrLayerInput {
  readonly source: ByteSource; readonly reader: ObjectReader;
  readonly pages: readonly OcrPage[]; readonly now: string;
  readonly random?: RandomBytes; readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}
export async function buildOcrUpdate(input: OcrLayerInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number; readonly pagesWritten: number }>>;
```
2. `ocrOperators`, por palabra (palabras vacías tras `trim` se omiten), con `r = page.rotate`:
   - Orientación según el giro de la página (el texto se ve horizontal en pantalla):

| `rotate` | Origen | Ancho de la palabra `w` | Alto `h` | Matriz `Tm` |
|---|---|---|---|---|
| 0 | `(x0, y0)` | `x1 - x0` | `y1 - y0` | `1 0 0 1 ox oy` |
| 90 | `(x1, y0)` | `y1 - y0` | `x1 - x0` | `0 1 -1 0 ox oy` |
| 180 | `(x1, y1)` | `x1 - x0` | `y1 - y0` | `-1 0 0 -1 ox oy` |
| 270 | `(x0, y1)` | `y1 - y0` | `x1 - x0` | `0 -1 1 0 ox oy` |

   - Tamaño `fs = h` (mínimo 1); escala horizontal `Tz = 100 × w / textWidth(text, fs)` (si `textWidth` es 0, 100), redondeada a 2 decimales y limitada a `[10, 1000]`.
   - Bloque: `BT 3 Tr /<font> fs Tf Tz Tz <Tm> Tm (<texto WinAnsi escapado> ) Tj ET` (el espacio final separa palabras al extraer). Escapa `(`, `)` y `\` en la cadena.
3. `buildOcrUpdate`: páginas ordenadas por índice; por página: `effectiveResources` + `freeResourceName(res, 'Font', 'SuiteOcr')` → `withResource` con una única fuente Helvetica (`HELV_FONT`) escrita una vez como objeto para todo el incremento; `wrapStreams(ocrOperators(...))` → página con `wrappedContents` y `/Resources` nuevos. Páginas sin palabras no se escriben. `pages` vacío → delta vacío. Índice fuera de rango → `organize-invalid`.
4. Op `'ocr-layer'` en `DOC_OPS`: args `{ password: string | null; pages: readonly OcrPage[]; now: string }`, fuente 0 = documento → `ok({ delta })`.
5. Tests `tests/unit/ocr/text-layer.test.ts` (pdf.js `loadPdf` + `qpdfCheck`).

## Criterios de aceptación
- [ ] `ocrOperators` de una palabra «Hola» en `[100, 700, 150, 712]` con `rotate: 0` → contiene `3 Tr`, `/F 12 Tf`, `1 0 0 1 100 700 Tm` y `(Hola ) Tj`; con `rotate: 90` sobre `[100, 700, 112, 750]` → `0 1 -1 0 112 700 Tm` y tamaño 12.
- [ ] `basic-5.pdf` + palabras «Factura» y «número» en la página 1 → tras concatenar, pdf.js `getTextContent()` de la página 1 contiene «Factura» y «número» además del texto original; el lienzo no cambia de aspecto (el texto es invisible: comprueba que el contenido nuevo tiene `3 Tr` y ningún operador de pintura).
- [ ] La caja de cada palabra en pdf.js (`transform` y `width` del ítem) coincide con la dada con un error ≤ 1 pt (en rotaciones 0 y 90).
- [ ] `encrypted-aes-256.pdf` (`usuario`) → la capa se extrae con la contraseña; `qpdf --check --password=usuario` 0.
- [ ] Caracteres fuera de WinAnsi → «?» sin romper la salida; paréntesis y barras escapados.
- [ ] Cobertura ≥ 90 % en `text-layer.ts`. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Reconocimiento (motor: [[PDF-133-ocr-motor]]) e interfaz ([[PDF-134-ocr-interfaz]]). Texto vertical o de derecha a izquierda. Fuentes no WinAnsi.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0038-ocr-local-tesseract]] (motor decidido por el líder: tesseract.js 7, local). Se parte en capa de texto (aquí), motor ([[PDF-133-ocr-motor]]) e interfaz ([[PDF-134-ocr-interfaz]]). El criterio original (escaneado de 3 páginas buscable, sin red) pasa a PDF-134.

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/ocr/text-layer.ts` (nuevo), `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (op `'ocr-layer'`), `apps/lector-pdf/tests/unit/ocr/text-layer.test.ts` (nuevo), `apps/lector-pdf/tests/unit/doc-ops/ocr-layer-op.test.ts` (nuevo).
- Qué he hecho: `ocrOperators` (orientación según `rotate`, `3 Tr`, escala `Tz` acotada a [10, 1000], escape de `()\` y octal para bytes no ASCII) y `buildOcrUpdate` (una fuente Helvetica `HELV_FONT` por incremento, recurso `SuiteOcr` libre por página, páginas sin palabras omitidas, delta vacío si no hay nada). Op `'ocr-layer'` en `DOC_OPS` con fuente 0. Los criterios de aceptación tienen test: operadores, pdf.js (texto extraíble y cajas en rotación 0 y 90 con error ≤ 1 pt), qpdf con `encrypted-aes-256.pdf` y `usuario`, escapes y «?».
- Comandos ejecutados y resultado: `pnpm lint` OK · `pnpm typecheck` OK · `pnpm coverage` exit 0 (todo el suite verde; 95,48 % sentencias globales) · `text-layer.ts`: 98,7 % líneas, 97,77 % sentencias.
- Dudas o cosas que no he podido hacer:
  - No he hecho commit: `apps/lector-pdf/src/core/doc-ops/ops/index.ts` contiene además cambios de otra ficha en curso (`organize` con `importedPasswords`, op de combinar); commitearlo entero mezclaría trabajo ajeno. Pendiente de commit cuando el líder lo coordine.
  - Tomo tres decisiones no escritas en la ficha, para revisar: (1) índice repetido en `pages` → `organize-invalid` (evita escribir dos veces la misma página); (2) caja mal formada (x0 ≥ x1, y0 ≥ y1 o no finita) lanza `RangeError` dentro de `ocrOperators` (bug de quien prepara las palabras; `buildOcrUpdate` lo devuelve como `save-unreadable`); (3) sin `index.ts` en `core/ocr/` porque la ficha solo nombra `text-layer.ts`.
  - El código `organize-invalid` dice «No se pueden reorganizar las páginas» y es confuso para OCR. Lo he usado porque la ficha lo pide; conviene un código propio (`ocr-invalid`) en una ficha posterior.
  - No he tocado `tests/e2e`.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- Lint, typecheck y tests de la ficha (30) en verde. Cumple criterios y las tres decisiones del programador son razonables. Sin problemas bloqueantes.
- (opcional) Código propio `ocr-invalid` en lugar de `organize-invalid`, como ya apunta el programador.
- Nota: el commit sigue pendiente (`ops/index.ts` mezcla trabajo de otra ficha).

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Operadores (rot 0 y 90) | OK | tests `text-layer.test.ts` en verde |
| basic-5 + pdf.js texto / invisible | OK | idem |
| Cajas ≤ 1 pt (0 y 90) | OK | idem |
| AES-256 + qpdf | OK | idem |
| WinAnsi «?» y escapes | OK | idem |
| Cobertura, lint, typecheck | OK | `text-layer.ts` 98,7 % líneas; 266 ficheros / 3429 tests verdes; lint y typecheck sin errores |

Tests añadidos: ninguno. Rendimiento: no aplica. Nota: `pnpm coverage` por defecto chocó con otro proceso vitest (directorio en uso); ejecutado con directorio propio.
