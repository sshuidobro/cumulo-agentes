---
tipo: tarea
id: PDF-144
titulo: Editar texto - localizar la línea editable y elegir la fuente estándar (núcleo)
app: pdf
estado: en-test
depende_de: [PDF-143]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion]
---

# PDF-144 · Editar texto: localizar la línea editable y elegir la fuente estándar (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0042-editar-texto-linea-simple]] · Antes: [[PDF-143-editar-texto-estilo-y-borrado]] · Siguen: [[PDF-145-editar-texto-aplicar]]

## Objetivo
Dada una página y la caja aproximada de una línea (calculada por la interfaz con pdf.js), saber qué glifos forman esa línea, dónde empieza su línea base y con qué fuente estándar, tamaño y color hay que reescribirla; o por qué no se puede editar.

## Contexto
- [[ADR-0042-editar-texto-linea-simple]] (sección «Decisión»: qué es una línea y qué no se edita).
- `src/core/content/index.ts` → `interpretPage`, `quadBounds`, `intersects`, `type PageContent`, `type TextRun` (PDF-143).
- `src/core/pdf/page-content.ts` → `effectiveResources`; `src/core/pdf/object-reader.ts` → `pageRef`, `getDict`, `resolve`; `src/core/pdf/objects.ts` → `dictGet`.
- `src/core/annotations/winansi.ts:36-53` → `codeOf`, `toWinAnsi`.
- `src/core/annotations/model.ts:10-12` → `Rgb`, `RectPt`. `Result`, `ok`, `err` de `@suite/shared` (`Result<T, E>`).
- Fixture: `basic-5.pdf` (`tests/fixtures/catalog.ts:27-44`): Helvetica 18 pt, líneas en y = 720, 698 y 676 desde x = 72; la línea 3 de la página 2 es «Texto de búsqueda en la página dos.». Ayudas: `tests/unit/content/helpers.ts` (`onePagePdf`, `openPage`, `fixtureBytes`).

## Qué hay que hacer
1. `winansi.ts`: añade
```ts
/** Primer carácter de `s` sin representación en WinAnsi (incluye controles como tabulador o salto de línea); null si todos la tienen. */
export function firstUnmappable(s: string): string | null;
```
   (un carácter es no representable si `codeOf(ch) === UNMAPPABLE && ch !== '?'`).
2. `src/core/edit-text/standard-font.ts` (nuevo):
```ts
export type FontFamily = 'Helvetica' | 'Times' | 'Courier';
export interface StandardFont { readonly family: FontFamily; readonly bold: boolean; readonly italic: boolean }
/** Fuente estándar más parecida. `baseFont` ya sin prefijo de subconjunto; `flags` = /FontDescriptor /Flags (0 si no hay). */
export function standardFontFor(baseFont: string, flags: number): StandardFont;
/** Nombre PostScript de las 14 estándar: Helvetica[-Bold|-Oblique|-BoldOblique], Times-Roman|-Bold|-Italic|-BoldItalic, Courier[-Bold|-Oblique|-BoldOblique]. */
export function standardBaseFont(font: StandardFont): string;
```
   Reglas, en este orden, sobre el nombre (sin distinguir mayúsculas):
   - `family`: `flags & 1` (FixedPitch) o `/courier|mono|consol/` → Courier; si no, `/sans|arial|helvet|verdana|calibri|tahoma|segoe|roboto|open/` → Helvetica; si no, `/times|serif|roman|georgia|garamond|cambria|palatino|minion|antiqua|baskerville|bookman/` o `flags & 2` (Serif) → Times; si no → Helvetica.
   - `bold`: `/bold|black|heavy|semibold|demi/` o `flags & 262144` (ForceBold).
   - `italic`: `/italic|oblique/` o `flags & 64` (Italic).
3. `src/core/edit-text/line.ts` (nuevo):
```ts
export interface LineStyle {
  readonly font: StandardFont;
  readonly fontSize: number;   // TextRun.fontSize redondeado a 0,01
  readonly color: Rgb;         // TextRun.fill
}
export interface LocatedLine {
  readonly bounds: RectPt;                     // unión de quadBounds de sus glifos
  readonly origin: readonly [number, number];  // [bounds[0], refRun.origin[1]]
  readonly style: LineStyle;
  readonly glyphs: readonly number[];          // índices en content.glyphs, ascendentes
}
export interface EditableLine extends Omit<LocatedLine, 'glyphs'> { readonly pageIndex: number }
export type LineIssue = 'no-text' | 'unsupported' | 'rotated' | 'invisible';

/** Sobre un contenido ya interpretado; `resources` = effectiveResources de la página. La usa PDF-145. */
export async function locateLine(
  reader: ObjectReader, resources: PdfDict, content: PageContent, hint: RectPt,
): Promise<Result<LocatedLine, LineIssue>>;
/** Interpreta la página y llama a `locateLine`. `pageIndex` fuera de rango o `hint` no finito/de área 0 → RangeError (bug). */
export async function findEditableLine(
  reader: ObjectReader, pageIndex: number, hint: RectPt,
): Promise<Result<EditableLine, LineIssue>>;
```
   Algoritmo de `locateLine` (exacto, en este orden):
   1. `content.unmeasured.length > 0` → `'unsupported'`. Algún `content.forms[i].quad` con `intersects(quad, hint)` → `'unsupported'`.
   2. `candidates` = índices de glifos cuyo centro de `quadBounds` está dentro de `hint` (normalizado, bordes incluidos). Vacío → `'no-text'`.
   3. `runOf(op)` = el `TextRun` de esa operación (mapa por `op`); si falta → `'unsupported'`.
   4. Glifo de referencia: el candidato con el centro más cercano al centro de `hint` (empate → menor índice); `refRun = runOf(ref.op)`. `|refRun.angle| > 0.5` → `'rotated'`. `refRun.renderMode` 3 o 7 → `'invisible'`.
   5. `glyphs` = candidatos con `|run.angle| ≤ 0.5`, `run.renderMode` distinto de 3 y 7, y `|run.origin[1] − refRun.origin[1]| ≤ 0.25 × refRun.fontSize`.
   6. Fuente: `resources /Font /<refRun.fontResource>` resuelto; `baseFont` = `/BaseFont` sin `/^[A-Z]{6}\+/` (o `''`); `flags` = `/FontDescriptor /Flags`, y en `Type0` el del primer `/DescendantFonts` (o 0). `style = { font: standardFontFor(baseFont, flags), fontSize: round2(refRun.fontSize), color: refRun.fill }`.
   - `findEditableLine`: `interpretPage` que lanza `PdfSyntaxError` → `'unsupported'`.
4. `src/core/edit-text/index.ts` exporta lo público de los dos ficheros.
5. Tests `tests/unit/edit-text/standard-font.test.ts` y `tests/unit/edit-text/line.test.ts`.

## Criterios de aceptación
- [ ] `standardFontFor` → `standardBaseFont`: `TimesNewRomanPS-BoldItalicMT`,0 → `Times-BoldItalic`; `Arial-BoldMT`,0 → `Helvetica-Bold`; `CourierNewPSMT`,0 → `Courier`; `Calibri`,32 → `Helvetica`; `Garamond`,0 → `Times-Roman`; `MicrosoftSansSerif`,0 → `Helvetica`; `LiberationSerif-Italic`,0 → `Times-Italic`; `XYZ`,2 → `Times-Roman`; `XYZ`,1 → `Courier`; `XYZ`,64 → `Helvetica-Oblique`; `XYZ`,262144 → `Helvetica-Bold`.
- [ ] `firstUnmappable`: «Ñandú € ¿?» → null; «Hola 😀» → «😀»; «a\tb» → «\t»; «Ω» → «Ω».
- [ ] `basic-5.pdf`, página índice 1, `hint` `[71, 674, 500, 687]` → ok; `glyphs.length` = 35 (caracteres de «Texto de búsqueda en la página dos.»); `origin` `[72, 676]`; `style` `{ font: Helvetica normal, fontSize: 18, color: [0,0,0] }`; ningún glifo de las líneas 698 ni 720.
- [ ] Misma página, `hint` `[300, 600, 400, 650]` (vacío) → `'no-text'`. Página con fuente Type3 (`onePagePdf`) → `'unsupported'`. Texto con `0 1 -1 0 300 300 Tm` → `'rotated'`. Texto con `3 Tr` → `'invisible'`. Contenido con sintaxis rota → `'unsupported'`. Form XObject que cubre el `hint` → `'unsupported'`.
- [ ] Fuente `/BaseFont /ABCDEF+Georgia-Bold` con `/Widths` y color `0 0 1 rg`, 12 pt con `2 0 0 2 0 0 cm` → `style` `{ Times negrita, fontSize: 24, color: [0,0,1] }`.
- [ ] Dos ítems en la misma línea base con fuentes distintas dentro del `hint` → los glifos de ambos; estilo del más cercano al centro.
- [ ] Cobertura ≥ 90 % en `src/core/edit-text/`. `pnpm lint && pnpm typecheck && pnpm coverage` con código 0.

## Fuera de alcance
- Escribir el texto nuevo ([[PDF-145-editar-texto-aplicar]]). Extraer el texto Unicode de la línea (lo da pdf.js en la interfaz). Usar la fuente original (opción B, no planificada).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/winansi.ts` (+`firstUnmappable`); `apps/lector-pdf/src/core/edit-text/standard-font.ts`, `line.ts`, `index.ts` (nuevos); `apps/lector-pdf/tests/unit/edit-text/standard-font.test.ts`, `line.test.ts` (nuevos); esta ficha.
- Qué he hecho: implementado `firstUnmappable`, `standardFontFor`/`standardBaseFont`, `locateLine` y `findEditableLine` según la ficha. Las rutas `src/core/...` se interpretan dentro de `apps/lector-pdf/`. Tests de los criterios: nombres de fuente, `firstUnmappable`, `basic-5.pdf` (35 glifos, origen [72, 676]), no-text, Type3, rotated, invisible, Form XObject, sintaxis rota, estilo Georgia-Bold ×2, Type0 con descriptor de la descendiente, dos fuentes en la misma línea base y entradas no válidas (RangeError).
- Comandos ejecutados y resultado: `pnpm lint` → 0 avisos. `pnpm typecheck` → 0 errores. `pnpm coverage` → código 0; 297 ficheros y 3853 tests en verde; `src/core/edit-text/`: 93,02 % sentencias, 85,18 % ramas, 99 % líneas.
- Dudas o cosas que no he podido hacer: (1) decisiones menores no previstas en la ficha: `findEditableLine` devuelve `'unsupported'` si la página no tiene diccionario o si el `Tf` no encuentra su fuente en `/Resources`; `locateLine` normaliza el `hint` (esquinas en cualquier orden). (2) `EditableLine` no lleva `glyphs`, como pide la ficha; si PDF-145 necesita los índices, habrá que ampliar el tipo. (3) Las ramas defensivas inalcanzables (p. ej. `nearestToCenter` sin candidatos) quedan sin cubrir, de ahí el 85 % de ramas. (4) No he tocado PDF-125 ni PDF-111; `PDF-125-organizar-vista.md` tiene una modificación sin confirmar de otro agente que no entra en mi commit.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
Lint, typecheck y coverage en verde (edit-text 93 % sentencias). Algoritmo y reglas de fuente conforme a la ficha; sin problemas bloqueantes.
