---
tipo: tarea
id: PDF-027
titulo: Generar la apariencia (/AP) de cada tipo de anotación
app: pdf
estado: en-revision
depende_de: [PDF-023, PDF-026]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, anotaciones, formato]
---

# PDF-027 · Apariencias de anotaciones

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Para cada `Annotation` del modelo, producir el Form XObject de su apariencia normal (`/AP /N`) para que Adobe, navegadores y móviles la dibujen igual que nosotros, sin depender de que el lector la regenere.

## Contexto
- Leer: `src/core/annotations/model.ts` (PDF-023), `src/core/pdf/objects.ts`, `serialize.ts`, `filters.ts` (`flateEncode`, PDF-026), ISO 32000-1 §12.5.5 (apariencias), §8.10 (Form XObject: `/Type /XObject /Subtype /Form /BBox /Resources`), §11.3.5 (modos de fusión), §12.5.6.10 (marcado de texto).
- `BBox` = `rect` de la anotación y **sin** `/Matrix` (identidad): así el contenido se escribe en coordenadas de página.
- Números con `serializeValue` (4 decimales máx.).

## Qué hay que hacer
1. `src/core/annotations/helvetica-widths.ts`: `export const HELVETICA_WIDTHS: Readonly<Record<string, number>>` (milésimas de em) con exactamente esta tabla AFM: espacio 278, `!` 278, `"` 355, `#` 556, `$` 556, `%` 889, `&` 667, `'` 191, `(` 333, `)` 333, `*` 389, `+` 584, `,` 278, `-` 333, `.` 278, `/` 278, `0`-`9` 556, `:` 278, `;` 278, `<` 584, `=` 584, `>` 584, `?` 556, `@` 1015, A 667, B 667, C 722, D 722, E 667, F 611, G 778, H 722, I 278, J 500, K 667, L 556, M 833, N 722, O 778, P 667, Q 778, R 722, S 667, T 611, U 722, V 667, W 944, X 667, Y 667, Z 611, `[` 278, `\` 278, `]` 278, `^` 469, `_` 556, `` ` `` 333, a 556, b 556, c 500, d 556, e 556, f 278, g 556, h 556, i 222, j 222, k 500, l 222, m 833, n 556, o 556, p 556, q 556, r 333, s 500, t 278, u 556, v 500, w 722, x 500, y 500, z 500, `{` 334, `|` 260, `}` 334, `~` 584, ñ 556, Ñ 722, ¿ 611, ¡ 333, € 556. Las vocales acentuadas (áéíóúü ÁÉÍÓÚÜ, àèìòù, ç Ç) miden lo mismo que su base. `export function textWidth(s: string, fontSize: number): number` (desconocidos = 556).
2. `src/core/annotations/winansi.ts`: `export function toWinAnsi(s: string): Uint8Array` (Latin-1 + los 27 caracteres de 0x80-0x9F de WinAnsi; lo demás → `?`).
3. `src/core/annotations/wrap.ts`: `export function wrapText(text: string, maxWidth: number, fontSize: number): string[]` — respeta `\n`; parte por espacios; una palabra más larga que la línea se parte por caracteres.
4. `src/core/annotations/appearance.ts`:
   ```ts
   export interface Appearance { readonly stream: PdfStream; readonly resources: PdfDict } // resources ya incluido en stream.dict; se expone para tests
   export function buildAppearance(a: Annotation): Appearance;
   ```
   Contenido por tipo (colores `r g b rg`/`RG` con el color del modelo):
   - **highlight**: `/Resources << /ExtGState << /GS0 << /Type /ExtGState /BM /Multiply /CA o /ca o >> >> >>`; contenido `/GS0 gs r g b rg` y por cada quad un polígono relleno `x1 y1 m x2 y2 l x4 y4 l x3 y3 l f` (puntos del orden Z: (1)=sup-izq, (2)=sup-der, (3)=inf-izq, (4)=inf-der).
   - **underline**: grosor `t = max(1, h/14)` con `h` = altura del quad; línea a `y = yInf + t` de `xIzq` a `xDer`: `t w x y m x' y l S` con `RG`.
   - **strikeout**: igual a la mitad de la altura.
   - **note**: icono de 20×20 anclado en la esquina superior izquierda de `rect` (el `rect` de una nota nueva mide 20×20): bocadillo con borde negro 1 pt relleno del color y tres líneas horizontales; mismo dibujo para todos los iconos (anótalo).
   - **freetext**: `/Resources << /Font << /Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >>`; fondo transparente, borde 1 pt del `color`; texto con `textColor`, márgenes 2 pt, `wrapText` al ancho del `rect - 4`, interlineado `1.15 × fontSize`, `BT /Helv fs Tf ... Tj ET` por línea (cadenas con `toWinAnsi` y serializadas como literal); recorta con `re W n` al `rect`.
   - **ink**: `1 J 1 j w RG`; cada trazo `x0 y0 m x1 y1 l ... S`; un trazo de un único punto → segmento de longitud 0 (con extremos redondeados se ve como punto).
   - Si `opacity < 1` en tipos distintos de highlight, también `/GS0` con `/CA` y `/ca`.
   - El stream se comprime con `flateEncode` (`/Filter /FlateDecode`).
5. Tests `tests/unit/annotations/appearance.test.ts`: analiza el contenido generado (decodificado) con expresiones regulares y, para cada tipo, crea un PDF de 1 página con el generador de fixtures (`PdfBuilder`) que incluya la anotación con esta `/AP`, lo abre con pdf.js (*legacy*) y, sin lienzo, pide `page.getOperatorList({ annotationMode: AnnotationMode.ENABLE })` y comprueba que contiene `OPS.beginAnnotation` y los operadores esperados.

## Criterios de aceptación
- [ ] (T) `textWidth('Hola', 10)` = `(722+556+222+556)/100` = `20.56`; `textWidth('ñ', 10)` = `5.56`.
- [ ] (T) `wrapText('uno dos tres', textWidth('uno dos', 10), 10)` → `['uno dos', 'tres']`; `'a\nb'` → `['a', 'b']`; una palabra de 100 `m` en 50 pt se parte en varias líneas, ninguna más ancha de 50.
- [ ] (T) `toWinAnsi('€ñ–Ж')` → `[0x80, 0xF1, 0x96, 0x3F]`.
- [ ] (T) Highlight con 2 quads: el contenido tiene `/GS0 gs`, 2 `f` y la `ExtGState` tiene `/BM /Multiply`; `BBox` = `rect`.
- [ ] (T) Underline sobre un quad de 12 pt de alto dibuja una línea de grosor 1 cerca de la base; strikeout a media altura (±1 pt).
- [ ] (T) FreeText con `Hola mundo` 12 pt: contiene `/Helv 12 Tf` y `(Hola mundo) Tj`; con texto de 3 líneas genera 3 `Tj`.
- [ ] (T) Ink con 2 trazos: 2 `S`, `1 J 1 j`.
- [ ] (T) Para los 6 tipos, pdf.js lee la anotación con `hasAppearance: true` y su lista de operadores incluye `beginAnnotation`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; ficheros nuevos ≥ 95 % de líneas.

## Fuera de alcance
- Incrustar fuentes para texto fuera de WinAnsi (mejora anotada en el Plan). Iconos distintos por tipo de nota. Escribir en el fichero (PDF-028).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/{helvetica-widths,winansi,wrap,appearance}.ts`; tests `apps/lector-pdf/tests/unit/annotations/{helvetica-widths,winansi,wrap,appearance}.test.ts`; esta ficha.
- Qué he hecho: anchos AFM Helvetica y `textWidth`; `toWinAnsi` (Latin-1 + 27 caracteres C1 de WinAnsi); `wrapText` por palabras con corte por caracteres; `buildAppearance` para los 6 tipos (Form XObject con BBox = rect, sin Matrix, comprimido con FlateDecode). Un trazo de un punto emite `m` + `l` a sí mismo y `S`. El test con pdf.js abre un PDF con cada `/AP` y comprueba `hasAppearance` y `beginAnnotation` en `getOperatorList`.
- Comandos ejecutados y resultado: `pnpm exec vitest run apps/lector-pdf/tests/unit/annotations` → 187 tests OK. `pnpm typecheck` → OK. `pnpm lint` → sin errores en mis ficheros; quedan 2 errores `no-console` en `tests/unit/pdf/object-reader.test.ts` y 1 aviso `react-hooks` en `src/ui/viewer/Viewer.tsx`, ambos de trabajo en curso ajeno. `pnpm test` → 1015/1016; falla `tests/ui/viewer.test.tsx` (zoom automático con tamaños mezclados), por `Viewer.tsx` modificado por otro agente, no por estos cambios. Cobertura de los 4 módulos nuevos con v8: 100 % líneas, 92 % ramas. `pnpm coverage` global no termina en verde por ese fallo ajeno.
- Dudas o cosas que no he podido hacer: (1) Tachado: interpreto "igual a la mitad de la altura" como línea en `yInf + h/2` con el mismo grosor `max(1, h/14)` que el subrayado. (2) El criterio "pnpm coverage con código 0" depende de que el fallo ajeno de `viewer.test.tsx` se resuelva. (3) Los anchos de vocales acentuadas están escritos explícitamente en la tabla (í/ì = 222, igual que la i).
