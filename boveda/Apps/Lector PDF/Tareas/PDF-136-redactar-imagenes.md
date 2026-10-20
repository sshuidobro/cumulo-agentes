---
tipo: tarea
id: PDF-136
titulo: Redactar - imágenes parcialmente cubiertas sin convertir la página
app: pdf
estado: en-revision
depende_de: [PDF-135]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, seguridad, edicion, nucleo]
---

# PDF-136 · Redactar: imágenes parcialmente cubiertas sin convertir la página

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0039-redaccion-real]] (punto 3) · Antes: [[PDF-135-redactar-aplicar]] · Sigue: [[PDF-137-redactar-interfaz]]

## Objetivo
Cuando una zona tapa solo parte de una imagen (lo habitual en escaneados: tapar un número en un DNI escaneado), se pintan de negro **los píxeles** de esa parte en una copia de la imagen y la página la usa en su lugar, sin convertir la página entera en imagen. JPEG: la interfaz los decodifica y vuelve a codificar; Flate 8 bits gris o RGB: el núcleo.

## Contexto
- `src/core/redact/apply.ts` → `planRedaction`, `PagePlan`, `PartialImage`, `buildRedactionUpdate` (PDF-135).
- `src/core/content/interpreter.ts` → `ImageBox` (cuadrilátero de la imagen en la página).
- `src/core/pdf/filters.ts` → `decodeStreamData`, `flateEncode`; `src/core/pdf/image.ts` → `jpegImageObject`, `readJpegInfo`.

## Qué hay que hacer
1. `PartialImage` (sustituye al de PDF-135):
```ts
export interface PartialImage {
  readonly name: string;                  // nombre del XObject en /Resources de la página
  readonly kind: 'jpeg' | 'flate';
  readonly width: number; readonly height: number;
  /** Zonas en píxeles de la imagen (origen arriba-izquierda), ya recortadas a la imagen: [x0, y0, x1, y1]. */
  readonly pixelRects: readonly RectPt[];
  /** Solo `jpeg`: bytes del flujo tal cual. */
  readonly jpeg?: Uint8Array;
}
```
2. `planRedaction`: una imagen por nombre (`Do`, no en línea) que toca una zona sin estar entera dentro:
   - `jpeg` si su `/Filter` es solo `/DCTDecode`, 1 o 3 componentes, sin `/SMask`, `/Mask`, `/Decode` ni `/ImageMask`.
   - `flate` si su `/Filter` es solo `/FlateDecode` (con o sin `/DecodeParms` de predictor que `decodeStreamData` admita), `/BitsPerComponent 8`, `/ColorSpace` `/DeviceGray` o `/DeviceRGB`, sin `/SMask`, `/Mask`, `/Decode` ni `/ImageMask`.
   - Cualquier otra (o en línea, o con la CTM girada o sesgada: `b ≠ 0` o `c ≠ 0`) → `raster = true` como en PDF-135.
   - `pixelRects`: inversa de la CTM de ese `Do` aplicada a la intersección zona ∩ caja de la imagen; en píxeles: `px = u·width`, `py = (1 − v)·height`, redondeado hacia fuera.
   - Si la misma imagen se dibuja varias veces en la página, se unen las zonas de todos sus usos.
3. `RedactInput` gana `readonly imageReplacements: ReadonlyMap<string, Uint8Array>` (`"<página>:<nombre>"` → JPEG ya pintado, solo para `kind: 'jpeg'`).
   - `jpeg`: el JPEG dado → objeto nuevo con `jpegImageObject`; falta el reemplazo → `organize-invalid`.
   - `flate`: el núcleo decodifica, pone a 0 los bytes de los píxeles de `pixelRects` (1 o 3 bytes por píxel), vuelve a codificar con `flateEncode` (sin predictor) y crea un objeto nuevo con el mismo diccionario sin `/DecodeParms`.
   - La página usa el objeto nuevo con el mismo nombre en su `/Resources` (directos, propios de esa página): las demás páginas que comparten la imagen original no cambian.
4. Op `'redact'`: args gana `imageReplacements: readonly (readonly [string, Uint8Array])[]`.
5. Tests en `tests/unit/redact/images.test.ts` con PDF construidos en el test (imagen Flate RGB 100×100 a toda la página; imagen JPEG en gris compartida por dos páginas — el JPEG «pintado» lo genera el test con `@napi-rs/canvas`, `devDependency` `@napi-rs/canvas@1.0.11`; añádela si aún no está).

## Criterios de aceptación
- [ ] Imagen Flate RGB 100×100 dibujada a 200×200 pt, zona que tapa el cuarto superior izquierdo → en el resultado, los píxeles `[0..50) × [0..50)` de la imagen de esa página son 0 y el resto iguales al original; la página sigue sin ser imagen entera (conserva su texto).
- [ ] Imagen JPEG compartida por las páginas 1 y 2, zona solo en la 1 → la página 1 usa un objeto nuevo con los bytes del JPEG dado; la 2 sigue usando el original.
- [ ] Imagen girada 90° por la CTM o con `/SMask` → `raster = true`.
- [ ] `pixelRects` correcto para una imagen colocada con desplazamiento y escala no uniforme (comprobación numérica en el test).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Imágenes CCITT, JBIG2, JPX, indexadas o de 1 bit (página en imagen). Decodificar JPEG en el núcleo.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/redact/apply.ts`, `apps/lector-pdf/src/core/doc-ops/ops/index.ts`, `apps/lector-pdf/tests/unit/redact/apply.test.ts` (ajuste de argumentos), `apps/lector-pdf/tests/unit/redact/images.test.ts` (nuevo).
- Qué he hecho: `PartialImage` nuevo (`name`, `kind`, `width`, `height`, `pixelRects`, `jpeg?`). `planRedaction` clasifica las imágenes parciales por nombre (jpeg / flate; el resto o CTM girada/sesgada → `raster`) y calcula `pixelRects` con la inversa de la CTM, recortados y redondeados hacia fuera. `RedactInput` y la op `redact` reciben `imageReplacements`; la página usa objetos de imagen propios con el mismo nombre en `/Resources`, sin tocar las demás páginas. Solo las imágenes que caben enteras en una zona se quitan.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm --filter lector-pdf exec vitest run tests/unit/redact` 39/39 OK; `pnpm coverage --coverage.reportsDirectory=<scratchpad>` código 0, 286 ficheros y 3719 tests OK; `apply.ts` 96.5 % de líneas. En una primera ejecución de cobertura dos ficheros (`fixtures-encrypted`, `page-tree`) dieron timeout de 5 s por la carga de la máquina (otra ejecución de Vitest en el mismo repo); pasan en aislado y en la segunda ejecución completa.
- Dudas o cosas que no he podido hacer:
  - Clave de `imageReplacements`: `"<pageIndex>:<nombre>"` con `pageIndex` base 0, igual que `rasterPages`. Hay que fijarlo también en PDF-137.
  - La prueba del JPEG usa `DeviceRGB` (el canvas de `@napi-rs/canvas` no genera JPEG en gris). Con `/ColorSpace` `ICCBased` o imágenes no `DeviceGray`/`DeviceRGB` la página va como imagen.
  - Consecuencia de «unir las zonas de todos los usos»: si una imagen aparece dos veces y un uso cae entero en la zona, los píxeles de esa zona se ponen a negro también en el otro uso (sobreredacción, nunca fuga). Lo dejo tal cual está escrito en la ficha.
  - El criterio de «cabe entera» usa la caja envolvente del cuadrilátero, como en PDF-135.
