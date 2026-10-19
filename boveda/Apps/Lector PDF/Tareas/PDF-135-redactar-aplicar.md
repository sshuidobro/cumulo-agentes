---
tipo: tarea
id: PDF-135
titulo: Redactar - aplicar (texto, imágenes enteras, anotaciones, página en imagen) y reescritura
app: pdf
estado: pendiente
depende_de: [PDF-062, PDF-131]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, seguridad, edicion, nucleo]
---

# PDF-135 · Redactar: aplicar (texto, imágenes enteras, anotaciones, página en imagen) y reescritura

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0039-redaccion-real]], [[ADR-0037-proteger-reescritura-aes256]] · Antes: [[PDF-062-redactar]], [[PDF-131-reescribir-documento]] · Siguen: [[PDF-136-redactar-imagenes]], [[PDF-137-redactar-interfaz]]

## Objetivo
Dadas zonas por página, quitar del PDF el texto (glifo a glifo, sin mover el resto), las imágenes que caen enteras dentro y las anotaciones que tocan las zonas, pintar rectángulos negros y **reescribir el fichero completo** para que no quede nada en revisiones antiguas. Las páginas que no se saben tratar se sustituyen por una imagen (que entrega la interfaz).

## Contexto
- `src/core/content/` (PDF-062): `parseContent`, `serializeContent`, `interpretPage`, `intersects`, `quadBounds`, `loadFontMetrics`.
- `src/core/organize/forms-cleanup.ts` → `removePageWidgets` (PDF-119): recorrido de `/Fields` a reutilizar.
- `src/core/pdf/page-content.ts` (PDF-059); `src/core/pdf/image.ts` → `jpegImageObject`; `src/core/pdf/filters.ts` → `flateEncode`.
- `src/core/pdf/rewrite.ts` → `rewriteDocument` y op `'rewrite'` (PDF-131, conserva el cifrado original).
- `src/core/pdf/delta-writer.ts`, `src/core/pdf/concat-source.ts`.

## Qué hay que hacer
1. `forms-cleanup.ts`: extrae el recorrido a `export async function removeWidgetRefs(reader, writer, widgets: ReadonlySet<number>, catalog: PdfRef): Promise<number>`; `removePageWidgets` la usa (sus tests siguen igual).
2. `src/core/redact/apply.ts`:
```ts
export type RectPt = readonly [number, number, number, number];
export interface RedactArea { readonly pageIndex: number; readonly rect: RectPt }   // espacio de usuario de la página
/** Por página con zonas: si se puede redactar sin convertir la página en imagen, o por qué no. */
export interface PagePlan { readonly pageIndex: number; readonly raster: boolean; readonly partialImages: readonly PartialImage[] }
export interface PartialImage { readonly name: string; readonly op: number }   // la detalla PDF-136
export async function planRedaction(reader: ObjectReader, areas: readonly RedactArea[]): Promise<Result<readonly PagePlan[]>>;
export interface RedactInput {
  readonly source: ByteSource; readonly reader: ObjectReader;
  readonly areas: readonly RedactArea[];
  /** JPEG de la página entera sin girar (ya con las zonas en negro), para las páginas con `raster`. */
  readonly rasterPages: ReadonlyMap<number, Uint8Array>;
  readonly now: string; readonly random?: RandomBytes; readonly signal?: AbortSignal;
}
export async function buildRedactionUpdate(input: RedactInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>>;
```
   - `planRedaction`: `raster = true` si `interpretPage` falla, si una operación de `unmeasured` o un `FormBox` toca alguna zona; en este paso, una imagen que toca una zona sin estar entera dentro también pone `raster = true` (PDF-136 lo cambiará por `partialImages`).
   - Texto: cada operación con algún glifo que toca una zona se reescribe como `TJ` equivalente: los códigos que se quedan, agrupados en cadenas (mismo tipo literal/hexadecimal que el original); cada glifo quitado → número `n = −(w0 + (Tc + Tw')·1000/Tfs)` (`Tw'` = `Tw` solo para el código 32 de 1 byte) sumado a los números vecinos; los números originales del `TJ` se conservan. `'` → `T*` + `TJ`; `"` → `aw Tw ac Tc T*` + `TJ`. Con `Tfs = 0`, se quita la operación entera.
   - Imágenes con caja entera dentro de una zona → se quita su `Do` (o su `BI…EI`).
   - Contenido nuevo de la página = `serializeContent(ops)` + `q 0 g <x> <y> <w> <h> re f Q` por zona, en **un único flujo** Flate que sustituye a `/Contents`. `/Resources` como efectivos (directos).
   - Anotaciones de la página cuyo `/Rect` toca una zona → fuera de `/Annots` (y sus `/Popup`); los widgets quitados → `removeWidgetRefs`.
   - Página en imagen (`raster`): `jpegImageObject(bytes)`; `/Contents` = `q W 0 0 H llx lly cm /SuiteRedact Do Q` con la caja de `/CropBox` (o `/MediaBox`) efectiva; `/Resources { XObject { SuiteRedact } }`; se quitan **todas** sus anotaciones y widgets. Falta el JPEG de una página `raster` → `err('organize-invalid')`.
   - Zonas fuera de rango de páginas o de área ≤ 0 → `organize-invalid`.
3. Op `'redact-plan'`: args `{ password, areas }` → `ok(PagePlan[])`. Op `'redact'`: args `{ password, areas, rasterPages: readonly (readonly [number, Uint8Array])[], now }` → `buildRedactionUpdate` → sobre `concatSource(fuente, delta)` → `rewriteDocument` como la op `'rewrite'` (conserva el cifrado) → `ok({ bytes })`.
4. Tests `tests/unit/redact/apply.test.ts` (pdf.js, `qpdfCheck`, y `pdftotext` / `qpdf --qdf --object-streams=disable` vía `run` de `tests/support/qpdf.ts` o `node:child_process`).

## Criterios de aceptación
- [ ] **Criterio original**: `basic-5.pdf`, zona sobre «Página 1» de la página 1 → tras `'redact'`, `pdftotext` del resultado no contiene «Página 1» pero sí « de 5» de esa línea y el texto de las demás páginas; y la salida de `qpdf --qdf --object-streams=disable` (flujos descomprimidos) no contiene la cadena de la palabra redactada en ninguna codificación usada por el fixture.
- [ ] Las palabras que siguen en la línea mantienen su posición (pdf.js `getTextContent`: la `x` del primer ítem tras la zona cambia ≤ 0,5 pt).
- [ ] Imagen entera dentro de la zona (PDF construido en el test) → no queda ningún `Do` de esa imagen en la página ni el objeto en el fichero.
- [ ] `annotated.pdf`: zona sobre una nota → la nota y su popup no están en el resultado; las demás anotaciones sí.
- [ ] Página con fuente Type3 en la zona → `planRedaction` la marca `raster`; con el JPEG dado, el resultado tiene en esa página solo la imagen (pdftotext de esa página vacío) y `qpdf --check` 0.
- [ ] `encrypted-aes-256.pdf` (`usuario`) → el resultado sigue cifrado, abre con `usuario` y no contiene el texto redactado.
- [ ] El resultado es una reescritura completa (una sola xref, sin `/Prev`).
- [ ] Cobertura ≥ 90 % en `src/core/redact/apply.ts`. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Imágenes parcialmente cubiertas sin convertir la página ([[PDF-136-redactar-imagenes]]). Borrar dibujos vectoriales bajo la zona (quedan tapados). Metadatos y texto oculto fuera de las zonas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
