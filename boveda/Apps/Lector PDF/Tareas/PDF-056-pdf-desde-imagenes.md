---
tipo: tarea
id: PDF-056
titulo: Crear PDF desde imágenes - núcleo
app: pdf
estado: hecha
depende_de: [PDF-121, PDF-118]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-056 · Crear PDF desde imágenes: núcleo

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]], [[ADR-0028-reescribir-pdfs]] · Paridad: [[Paridad Adobe Acrobat]] · Antes: [[PDF-121-documento-nuevo]] · Sigue: [[PDF-129-pdf-desde-imagenes-interfaz]]

## Objetivo
`buildPdfFromImages` crea un PDF con una imagen por página: JPEG incrustados **sin recomprimir** (con su orientación EXIF aplicada por matriz) y PNG ya decodificados a RGBA (con transparencia), en página ajustada a la imagen, A4 o Carta.

## Contexto
- `src/core/pdf/image.ts` → `readJpegInfo`, `jpegImageObject`, `rgbaImageObjects`, `RgbaImage`.
- `src/core/signature/image-art.ts` → `jpegExifOrientation`, `isJpegBytes`.
- `src/core/pdf/file-writer.ts` → `writeCompleteFile` (PDF-121); `src/core/pdf/page-tree-layout.ts` → `planPageTree`.
- `src/core/pdf/filters.ts` → `flateEncode`; `src/core/pdf/text-string.ts` → `pdfDate`, `encodeTextString`.

## Qué hay que hacer
1. `src/core/pdf/images-to-pdf.ts`:
```ts
export type ImageInput =
  | { readonly kind: 'jpeg'; readonly name: string; readonly bytes: Uint8Array }
  | { readonly kind: 'rgba'; readonly name: string; readonly image: RgbaImage };
export type PageSizeMode = 'fit' | 'a4' | 'letter';
export interface ImagesToPdfInput {
  readonly images: readonly ImageInput[];    // 1..500
  readonly pageSize: PageSizeMode;
  readonly margin: number;                   // pt, 0..72; solo A4 y Carta
  readonly now: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}
export const A4_PT = [595.28, 841.89] as const;
export const LETTER_PT = [612, 792] as const;
export const FIT_DPI = 150;
export async function buildPdfFromImages(input: ImagesToPdfInput): Promise<Result<{ readonly bytes: Uint8Array; readonly pages: number }>>;
/** Densidad JFIF (APP0) en ppp si existe y está en [72, 1200]; si no, null. */
export function jpegDensity(bytes: Uint8Array): number | null;
```
2. Reglas:
   - JPEG: `jpegImageObject(bytes)` (datos **idénticos** a la entrada); JPEG no válido → `err(pdfError('invalid-image'))`. Orientación con `jpegExifOrientation`: en 5-8, ancho y alto mostrados se intercambian.
   - RGBA: `rgbaImageObjects` (+ SMask si hay alfa).
   - Tamaño de página: `fit` → píxeles mostrados × 72 / ppp (ppp = `jpegDensity` o `FIT_DPI`); `a4`/`letter` → orientación vertical u horizontal según la imagen mostrada (más ancha que alta → horizontal), imagen escalada para caber en la página menos `margin` por lado, centrada, sin ampliar por encima de su tamaño a `FIT_DPI`.
   - Contenido de página: `q a b c d e f cm /Im0 Do Q` con la matriz según orientación EXIF, para la caja mostrada en `(x, y)` de tamaño `W × H`:

| EXIF | Matriz `[a b c d e f]` |
|---|---|
| 1 | `[W 0 0 H x y]` |
| 2 | `[-W 0 0 H x+W y]` |
| 3 | `[-W 0 0 -H x+W y+H]` |
| 4 | `[W 0 0 -H x y+H]` |
| 5 | `[0 -H -W 0 x+W y+H]` |
| 6 | `[0 -H W 0 x y+H]` |
| 7 | `[0 H W 0 x y]` |
| 8 | `[0 H -W 0 x+W y]` |

   - Números con como mucho 4 decimales. Contenido sin comprimir (es corto). `/Info /Title` = nombre de la primera imagen sin extensión. Árbol con `planPageTree`. Fichero con `writeCompleteFile`.
   - 0 imágenes o más de 500 → `organize-invalid`. Progreso por imagen; `signal` → `cancelled`.
3. Op `'images-to-pdf'` en `DOC_OPS` (sin fuentes): args = `ImagesToPdfInput` sin `signal`/`onProgress` → `ok({ bytes, pages })`.
4. Tests `tests/unit/pdf/images-to-pdf.test.ts`: JPEG y RGBA de prueba generados en el test con `@napi-rs/canvas` (`devDependency` `@napi-rs/canvas@1.0.11`; añádela si aún no está); la etiqueta EXIF de orientación se inserta en el JPEG como en `tests/unit/signature-exif.test.ts`.

## Criterios de aceptación
- [ ] **Criterio original**: 10 imágenes (6 JPEG y 4 RGBA) → PDF de 10 páginas, `qpdf --check` 0, y para cada JPEG, el flujo de su Image XObject (`qpdf --show-object=N --raw-stream-data`) es **byte a byte igual** al fichero de entrada.
- [ ] JPEG con EXIF 6 de 40×20 px en `fit` → página de 20×40 px a 150 ppp (9,6 × 19,2 pt) y matriz `[0 -19.2 9.6 0 0 19.2]`.
- [ ] `a4` con una imagen apaisada → página 841.89 × 595.28; la imagen cabe dentro de los márgenes y está centrada (comprueba la matriz).
- [ ] RGBA con alfa → la imagen lleva `/SMask`; sin alfa, no.
- [ ] pdf.js abre el resultado y da `numPages === 10` y las dimensiones esperadas por página.
- [ ] JPEG corrupto → `invalid-image`; lista vacía → `organize-invalid`.
- [ ] `pnpm perf`: 200 JPEG de 1 MB (el mismo repetido) < 1 500 ms.
- [ ] Cobertura de `images-to-pdf.ts` ≥ 90 %. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Decodificar PNG, GIF, WebP, TIFF o HEIC en el núcleo (la interfaz entrega RGBA: [[PDF-129-pdf-desde-imagenes-interfaz]]). OCR del resultado ([[PDF-061-ocr]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada: núcleo aquí, interfaz en [[PDF-129-pdf-desde-imagenes-interfaz]]. Dependencias nuevas: PDF-121 (escritor de ficheros completos) y PDF-118 (Worker).

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/images-to-pdf.ts` (nuevo), `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (op `images-to-pdf`), `apps/lector-pdf/tests/unit/pdf/images-to-pdf.test.ts` (nuevo), `apps/lector-pdf/tests/perf/images-to-pdf.perf.test.ts` (nuevo).
- Qué he hecho: `buildPdfFromImages` y `jpegDensity` según la ficha: JPEG con sus bytes originales (`/DCTDecode`), RGBA con `/SMask` solo si hay alfa, orientación EXIF por matriz, páginas fit/A4/Carta con centrado y tope de 150 ppp, árbol con `planPageTree` y escritura con `writeCompleteFile`. Op `images-to-pdf` registrada en `DOC_OPS`.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` exit 0 (255 ficheros, 3238 tests), `images-to-pdf.ts` con 100 % de líneas; perf del fichero (`pnpm exec vitest run --config vitest.perf.config.ts images-to-pdf`) OK. Criterio original con `qpdf --check` y pdf.js incluido en los tests unitarios.
- Dudas o cosas que no he podido hacer: (1) densidad JFIF: uso la densidad horizontal y, en centímetros, la convierto ×2,54; (2) margen o `pageSize` fuera de rango lanzan `RangeError` (bug del llamante), no `Result`; (3) `/Info` lleva también Producer, CreationDate y ModDate, como `new-document.ts`; (4) `pnpm perf` sin filtro corre todas las pruebas de rendimiento; para la mía se llamó a vitest directamente. Durante las ejecuciones hubo carga de otros agentes: dos tests por timeout de 5 s (`page-tree`, `fixtures-encrypted`) pasan al relanzarlos aislados.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Lint, typecheck, tests del fichero (29) y perf OK; cobertura 100 % según el programador. Criterios cubiertos, op registrada, sin problemas bloqueantes.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Original (10 imágenes, qpdf 0, JPEG byte a byte) | OK | test l.112 |
| EXIF 6 40×20 en fit, matriz | OK | test l.142 |
| A4 apaisada centrada | OK | test l.171 |
| SMask solo con alfa | OK | test l.208 |
| pdf.js numPages/dimensiones | OK | test l.112 |
| JPEG corrupto / lista vacía | OK | l.238, l.250 |
| Perf 200 JPEG < 1500 ms | OK | vitest.perf.config.ts images-to-pdf: 1 passed |
| Cobertura ≥ 90 %, lint, typecheck, coverage | OK | 95,91 % stmts / 100 % líneas; 255 ficheros, 3238 tests, exit 0 |

Tests añadidos: ninguno (los 21 existentes cubren todos los criterios). Rendimiento: dentro de presupuesto.
