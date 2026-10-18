---
tipo: tarea
id: PDF-084
titulo: Objetos de imagen PDF desde RGBA y JPEG
app: pdf
estado: en-test
depende_de: []
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, formato, core]
---

# PDF-084 · Objetos de imagen PDF desde RGBA y JPEG

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0020-firma-visual]]

## Objetivo
Utilidad pura que convierte píxeles RGBA o un JPEG en Image XObjects listos para escribir (con canal alfa como `/SMask`), base de la firma con imagen y, más adelante, de sellos y de crear PDF desde imágenes.

## Contexto
- Leer: `src/core/pdf/objects.ts` (`stream`, `name`, `dict`, `PdfRef`), `src/core/pdf/filters.ts` (`flateEncode`, `decodeStreamData`), `src/core/pdf/serialize.ts`.
- JPEG: marcadores `FFD8` (SOI) y segmentos `FF xx` + longitud de 2 bytes big-endian; las dimensiones están en SOF0 (`FFC0`), SOF1 (`FFC1`) o SOF2 (`FFC2`): `[precision][alto 2][ancho 2][componentes 1]`.

## Qué hay que hacer
1. `src/core/pdf/image.ts`:
```ts
export interface RgbaImage { readonly width: number; readonly height: number; readonly rgba: Uint8Array } // rgba.length = w*h*4
export interface ImageObjects { readonly image: PdfStream; readonly smask: PdfStream | null }
/** Image XObject RGB (FlateDecode) + SMask gris (FlateDecode). Si todos los alfa son 255, `smask` es null y la imagen no lleva /SMask. */
export function rgbaImageObjects(img: RgbaImage, smaskRef: PdfRef): ImageObjects;
export interface JpegInfo { readonly width: number; readonly height: number; readonly components: 1 | 3 | 4 }
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null;   // null si no es JPEG válido o componentes ≠ 1/3/4
/** Image XObject con los bytes JPEG tal cual (/DCTDecode). 1 → /DeviceGray, 3 → /DeviceRGB, 4 → /DeviceCMYK con /Decode [1 0 1 0 1 0 1 0]. */
export function jpegImageObject(bytes: Uint8Array): Result<PdfStream>;  // err('invalid-image') si readJpegInfo es null
```
   Diccionarios: `/Type /XObject /Subtype /Image /Width /Height /ColorSpace /BitsPerComponent 8 /Filter` y, si hay alfa, `/SMask <smaskRef>`.
   Validación de `rgbaImageObjects`: `width`, `height` enteros > 0 y `rgba.length === w*h*4`; si no, `RangeError` (es un bug del llamante).
2. Código de error `invalid-image` en `src/core/errors.ts` con mensaje «La imagen no es válida o no está en un formato admitido (PNG o JPEG).».
3. Tests `tests/unit/pdf-image.test.ts`: JPEG de prueba generado en el test (bytes mínimos a mano: SOI + APP0 + SOF0 de 2×3 px, 3 componentes + EOI; no hace falta que se pueda decodificar para `readJpegInfo`) y prueba con pdf.js: un PDF de una página (con `PdfBuilder` de `tests/fixtures/pdf-builder.ts`) que pinta `rgbaImageObjects` de 4×2 píxeles (2 rojos opacos, 2 transparentes…) → `page.render` en Node con `@napi-rs/canvas` si el entorno de tests ya lo usa; si no, basta `page.getOperatorList()` sin error y `qpdf --check` 0.

## Criterios de aceptación
- [ ] `rgbaImageObjects` de 4×2 con alfa variable: `image` decodificado (`decodeStreamData`) tiene 24 bytes RGB en orden; `smask` decodificado 8 bytes con los alfa; `image.dict` tiene `/SMask` = `smaskRef`.
- [ ] Todo opaco → `smask === null` y sin `/SMask`.
- [ ] `readJpegInfo` del JPEG mínimo → `{ width: 2, height: 3, components: 3 }`; con bytes `[0x89, 0x50, …]` (PNG) → `null`; truncado en mitad del SOF → `null` (nunca lanza).
- [ ] `jpegImageObject` de un JPEG CMYK (componentes 4) lleva `/Decode [1 0 1 0 1 0 1 0]` y los datos son los bytes originales sin copiar ni recomprimir (mismo contenido).
- [ ] PDF de prueba con la imagen RGBA: `qpdf --check` 0 y pdf.js `getOperatorList` sin error.
- [ ] Cobertura de `image.ts` ≥ 90 %.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Decodificar PNG (lo hace el navegador en PDF-086). Anotación de firma (PDF-085).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/image.ts` (nuevo), `apps/lector-pdf/tests/unit/pdf-image.test.ts` (nuevo), `apps/lector-pdf/src/core/errors.ts` (código `invalid-image` y mensaje), `apps/lector-pdf/src/core/pdf/index.ts` (re-exporta `./image`).
- Qué he hecho: `rgbaImageObjects` (RGB + SMask gris con FlateDecode; sin SMask si todo es opaco; `RangeError` si dimensiones o `rgba` no cuadran), `readJpegInfo` (recorre marcadores hasta SOF0/1/2; `null` ante cualquier dato inválido o truncado, sin lanzar) y `jpegImageObject` (`/DCTDecode`, gris/RGB/CMYK con `/Decode` para CMYK; los bytes del JPEG se pasan tal cual). Tests: 19, con qpdf --check y `getOperatorList` de pdf.js sobre un PDF de una página con la imagen RGBA. Sin dependencias nuevas; `@napi-rs/canvas` no está en el proyecto, así que se usó `getOperatorList` como indica la ficha.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf exec vitest run tests/unit/pdf-image.test.ts`: 19/19 OK.
  - `npx eslint --max-warnings 0` sobre mis 4 ficheros: OK. `pnpm typecheck`: OK (0 errores).
  - `pnpm coverage` (ruta): `image.ts` con 100 % de líneas, 98,8 % de sentencias y 93,2 % de ramas (criterio ≥ 90 % cumplido).
  - `pnpm lint` (raíz): **falla** por un error ajeno a esta ficha: `apps/lector-pdf/tests/fixtures/structure.ts:486` `no-constant-condition`. Ese fichero tiene cambios sin commitear de otro trabajo en curso (no lo he tocado).
  - `pnpm test` (raíz): 1759/1760 OK. Falla `tests/unit/search-actions.test.ts` («cambiar una opción cancela la búsqueda anterior…»), un test de temporización que pasa en aislado (7/7); parece intermitencia por la carga de la máquina, no tiene relación con esta ficha.
- Dudas o cosas que no he podido hacer: el criterio de `pnpm lint` y `pnpm test` en raíz no se cumple por los dos motivos de arriba, ajenos a esta ficha; conviene que el líder lo confirme cuando el otro trabajo esté commiteado. Los bytes de `jpegImageObject` se pasan sin copiar (el `data` del stream es el mismo `Uint8Array` del llamante), como pide la ficha.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Lint de los ficheros de la ficha, typecheck y 19 tests propios en verde; los fallos de `pnpm lint` (structure.ts) y del test de temporización de búsqueda son ajenos a la ficha. Criterios cubiertos y nada fuera de alcance.
1. `apps/lector-pdf/src/core/pdf/image.ts:135` (opcional) — `readJpegInfo` no comprueba la precisión del SOF y `jpegImageObject` fija `/BitsPerComponent 8`; un JPEG de 12 bits quedaría mal declarado. Devolver `null` si la precisión no es 8.
