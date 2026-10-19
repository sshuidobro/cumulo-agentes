---
tipo: tarea
id: PDF-062
titulo: Redactar - analizador e intérprete de contenido con cajas de glifos (núcleo)
app: pdf
estado: pendiente
depende_de: [PDF-052, PDF-059]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, seguridad, edicion, nucleo]
---

# PDF-062 · Redactar: analizador e intérprete de contenido con cajas de glifos (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0039-redaccion-real]] · Paridad: [[Paridad Adobe Acrobat]] §12 · Siguen: [[PDF-135-redactar-aplicar]], [[PDF-136-redactar-imagenes]], [[PDF-137-redactar-interfaz]]

## Objetivo
Leer el flujo de contenido de una página como lista de operaciones y calcular la caja de cada glifo de texto y de cada imagen en coordenadas de la página, marcando lo que no se sabe medir. Es la base para borrar de verdad lo que hay bajo una zona.

## Contexto
- [[ADR-0039-redaccion-real]] (punto 1).
- `src/core/pdf/lexer.ts` → `PdfLexer`, `Token`; `src/core/pdf/parser.ts` → `parseValue`; `src/core/pdf/filters.ts` → `decodeStreamData`; `src/core/pdf/serialize.ts` → `serializeValue`.
- `src/core/pdf/object-reader.ts` → `get`, `getDict`, `resolve`; `src/core/pdf/page-content.ts` → `effectiveResources` ([[PDF-059-anadir-texto-imagen|PDF-059]]).
- `src/core/annotations/helvetica-widths.ts` → `HELVETICA_WIDTHS`; `src/core/annotations/winansi.ts` (tabla código ↔ carácter).
- ISO 32000-1 §8.4 (CTM, `q`/`Q`/`cm`), §9.3 (estado de texto), §9.4 (operadores de texto y fórmula del avance), §9.6.2 (`/Widths`), §9.7.4 (`/W`, `/DW`), §8.9.7 (imágenes en línea), §8.10 (Form XObjects).

## Qué hay que hacer
1. `src/core/content/content-parser.ts`:
```ts
export interface ContentOp {
  readonly op: string;                  // 'Tj', 'cm', 'BI'…
  readonly operands: readonly PdfValue[];
  /** Solo en 'BI': diccionario (claves abreviadas tal cual) y datos crudos entre ID y EI. */
  readonly inline?: { readonly dict: PdfDict; readonly data: Uint8Array };
}
/** Lanza `PdfSyntaxError` si la sintaxis no se entiende. Operadores desconocidos se conservan tal cual. */
export function parseContent(bytes: Uint8Array): readonly ContentOp[];
/** Inverso: operandos con `serializeValue`, un operador por línea; 'BI' se escribe `BI <claves> ID <datos> EI`. */
export function serializeContent(ops: readonly ContentOp[]): Uint8Array;
```
   Imagen en línea: tras `ID` se salta un blanco; el final es el primer `EI` precedido de un blanco y seguido de un blanco o del final, y si el diccionario trae `/L` o `/Length`, se usa esa longitud.
2. `src/core/content/font-metrics.ts`:
```ts
export interface FontMetrics {
  readonly bytesPerCode: 1 | 2;
  /** Ancho del código en milésimas de unidad de texto. */
  width(code: number): number;
  /** Altura mínima y máxima del glifo en milésimas (descendente negativo). */
  readonly descent: number; readonly ascent: number;
}
/** null = fuente no soportada (Type3, Type0 con CMap distinta de /Identity-H, o simple sin /Widths y no estándar). */
export async function loadFontMetrics(reader: ObjectReader, font: PdfDict): Promise<FontMetrics | null>;
```
   - Simples (`Type1`, `MMType1`, `TrueType`): `/Widths` desde `/FirstChar`; fuera de rango → `/FontDescriptor /MissingWidth` (o 0). Sin `/Widths`: `BaseFont` Helvetica/Arial (con o sin `-Bold`, `,Bold`…) → anchos de `HELVETICA_WIDTHS` por carácter WinAnsi; Courier → 600; resto → `null`.
   - `Type0` con `/Encoding /Identity-H`: 2 bytes por código; anchos de `/W` del descendiente (formatos `c [w1 w2…]` y `c1 c2 w`), `/DW` (1000 por defecto).
   - `descent`/`ascent`: `/FontDescriptor /Descent` y `/Ascent`, ampliados a como mínimo `-250` y `750` (más vale tapar de más).
3. `src/core/content/interpreter.ts`:
```ts
export type Quad = readonly [number, number, number, number, number, number, number, number]; // 4 esquinas en espacio de usuario
export interface GlyphBox { readonly op: number; readonly code: number; readonly quad: Quad }   // op = índice en ops; code = índice del código dentro de la operación (en TJ, contando todos sus strings en orden)
export interface ImageBox { readonly op: number; readonly name: string | null; readonly quad: Quad }   // name null = imagen en línea
export interface FormBox { readonly op: number; readonly name: string; readonly quad: Quad }          // Form XObject (su /BBox transformada)
export interface PageContent {
  readonly ops: readonly ContentOp[];
  readonly glyphs: readonly GlyphBox[];
  readonly images: readonly ImageBox[];
  readonly forms: readonly FormBox[];
  /** Operaciones de texto que no se han podido medir (fuente no soportada, Tf sin fuente): su índice. */
  readonly unmeasured: readonly number[];
}
export async function interpretPage(reader: ObjectReader, page: PdfDict): Promise<PageContent>;
export function quadBounds(q: Quad): readonly [number, number, number, number];
export function intersects(q: Quad, rect: readonly [number, number, number, number]): boolean;   // por la caja de `q`, área > 0
```
   - `/Contents` (flujo o array) decodificados y unidos con `\n`. Recursos con `effectiveResources`.
   - Estado: pila `q`/`Q` (máx. 64) con CTM; `cm`; `BT`/`ET`; `Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`, `Td`, `TD`, `Tm`, `T*`, `Tj`, `TJ`, `'`, `"`.
   - Caja de glifo: en espacio de glifo `[0, descent/1000] – [w0/1000, ascent/1000]`, transformada por `Trm = [Tfs·Th 0 0 Tfs 0 Trise] × Tm × CTM`. Avance: `tx = ((w0/1000 − Tj/1000)·Tfs + Tc + Tw·[código 32 de 1 byte])·Th`.
   - `Do` → imagen (`/Subtype /Image`) con el cuadrado unidad por la CTM; Form → `FormBox` con `/BBox` por `/Matrix` × CTM (no se entra en el form).
4. Tests `tests/unit/content/` (`content-parser.test.ts`, `font-metrics.test.ts`, `interpreter.test.ts`), con PDF construidos en el test con `pdf-builder.ts` y con los fixtures.

## Criterios de aceptación
- [ ] `parseContent` → `serializeContent` → `parseContent` da las mismas operaciones para el contenido de todas las páginas de `basic-5.pdf`, `compressed.pdf`, `annotated.pdf` y un contenido con imagen en línea que contiene la secuencia `EI` dentro de sus datos (con `/L`).
- [ ] `basic-5.pdf` página 1: los glifos de «Página 1 de 5» están en orden, sus cajas no se solapan y la unión cubre el ítem que da pdf.js (`getTextContent`: `transform` y `width`) con error ≤ 1 pt en horizontal.
- [ ] Texto con `Tc`, `Tw`, `Tz` 50, `Ts` y un `TJ` con ajustes (PDF construido en el test) → posiciones calculadas iguales a las de pdf.js (≤ 0,5 pt).
- [ ] Fuente Type0 `Identity-H` con `/W` (créala en el test con códigos de 2 bytes) → anchos correctos; Type3 o CMap no Identity → la operación aparece en `unmeasured`.
- [ ] Imagen dibujada con `200 0 0 100 50 600 cm /Im0 Do` → `ImageBox` con caja `[50, 600, 250, 700]`; `q`/`Q` restauran la CTM.
- [ ] Contenido con sintaxis rota → `interpretPage` rechaza con `PdfSyntaxError` (la llamada de PDF-135 lo tratará como página no soportada).
- [ ] Cobertura ≥ 90 % de líneas en `src/core/content/`. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Modificar el contenido ([[PDF-135-redactar-aplicar]]). Fuentes Type3, CMaps no Identity y escritura vertical (se marcan como no medidas). Entrar en Form XObjects.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0039-redaccion-real]]. Depende también de PDF-059 (`page-content.ts`). La redacción se parte en intérprete (aquí), aplicar ([[PDF-135-redactar-aplicar]]), imágenes parciales ([[PDF-136-redactar-imagenes]]) e interfaz ([[PDF-137-redactar-interfaz]]). El criterio original (`pdftotext` sin el texto) pasa a PDF-135 y PDF-137.
