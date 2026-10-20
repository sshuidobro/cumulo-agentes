---
tipo: tarea
id: PDF-143
titulo: Editar texto - estilo de cada operación de texto y borrado de glifos reutilizable (núcleo)
app: pdf
estado: en-revision
depende_de: []
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion]
---

# PDF-143 · Editar texto: estilo de cada operación de texto y borrado de glifos reutilizable (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0042-editar-texto-linea-simple]], [[ADR-0039-redaccion-real]] · Sustituye a: [[PDF-065-editar-texto]] (en parte) · Siguen: [[PDF-144-editar-texto-localizar-linea]]

## Objetivo
El intérprete de contenido informa, por cada operación de texto medida, de su fuente, tamaño efectivo, ángulo, origen y color de relleno; y el borrado de glifos sin mover el resto que usa la redacción queda en una función común que también usará la edición de texto. La redacción no cambia de comportamiento.

## Contexto
- `apps/lector-pdf/src/core/content/interpreter.ts:62-250` → `TextState`, `GraphicsState`, `interpretPage` (`loadFont`, `showOp`, `switch` de operadores), `multiply`, `transform` (línea ~320).
- `apps/lector-pdf/src/core/redact/apply.ts:384-433` → `textChanges`; `:566-648` → `editText`, `statePrefix`, `textItems`, `redactItems`, `groupGlyphs`; `:673-715` → `opOf`, `isString`.
- `apps/lector-pdf/src/core/content/index.ts` (exportaciones).
- Tests existentes: `tests/unit/content/interpreter.test.ts`, `tests/unit/content/helpers.ts` (`onePagePdf`, `helveticaResources`, `openPage`), `tests/unit/redact/apply.test.ts`.
- `Rgb` = `readonly [number, number, number]` en `src/core/annotations/model.ts:10` (importar el tipo de ahí).

## Qué hay que hacer
1. `interpreter.ts`:
   - `GraphicsState` gana `fill: Rgb` (inicial `[0, 0, 0]`); `q` lo guarda y `Q` lo restaura junto con `ctm` y `text`.
   - `TextState` gana `fontResource: string | null` (nombre del operando de `Tf`, sin barra; inicial `null`) y `renderMode: number` (`Tr`, inicial 0).
   - Operadores de color de relleno (valores fijados a 0..1):
     - `g v` → `[v, v, v]`; `rg r g b` → `[r, g, b]`; `k c m y k` → `[(1-c)(1-k), (1-m)(1-k), (1-y)(1-k)]`.
     - `cs` → `[0, 0, 0]`. `sc`/`scn`: solo operandos numéricos; 1 → gris, 3 → RGB, 4 → CMYK como arriba; otro número de operandos o con un nombre (patrón) → `[0, 0, 0]`.
   - `Tr n` → `renderMode = n`.
   - Nuevo tipo exportado y campo nuevo en `PageContent`:
```ts
/** Una por operación de texto medida (Tj, TJ, ', "), en el orden de las operaciones. */
export interface TextRun {
  readonly op: number;                         // índice en ops
  readonly fontResource: string;               // nombre en /Resources /Font, sin barra
  readonly fontSize: number;                   // Tfs × hypot(m[2], m[3]), m = Tm × CTM al empezar a mostrar
  readonly angle: number;                      // grados: atan2(m[1], m[0]) × 180 / π
  readonly origin: readonly [number, number];  // (m[4], m[5]): línea base al empezar a mostrar (sin Ts)
  readonly fill: Rgb;
  readonly renderMode: number;
}
// PageContent gana: readonly runs: readonly TextRun[];
```
   - En `showOp`, si la fuente es medible y `fontResource !== null`, se añade el `TextRun` **antes** del bucle de glifos (para `'` y `"`, después de su `T*`, que ya ocurre antes de `showOp`). `m = multiply(machine.tm, machine.graphics.ctm)`.
2. `src/core/content/remove-glyphs.ts` (nuevo): mueve aquí, sin cambiar su lógica, `statePrefix`, `textItems`, `redactItems` y `groupGlyphs` de `apply.ts` (y los auxiliares que necesiten, p. ej. `opOf`, `isString`), y exporta:
```ts
/**
 * Operaciones de la página con los glifos para los que `remove` devuelve true sustituidos por ajustes de `TJ` del
 * mismo ancho (el resto no se mueve). Una operación con algún glifo quitado de `shift === null` se sustituye solo por
 * su prefijo de estado (como hoy en la redacción). Las operaciones cuyo índice está en `skip` se omiten. Las demás se
 * devuelven tal cual y en el mismo orden.
 * `index` es la posición del glifo en `content.glyphs`.
 */
export function removeGlyphs(
  content: PageContent,
  remove: (glyph: GlyphBox, index: number) => boolean,
  skip?: ReadonlySet<number>,
): ContentOp[];
```
3. `apply.ts` → `textChanges`: calcula `removedImageOps` y `removedNames` como hoy (recorriendo `content.images` y las operaciones `Do` de esos índices) y sustituye el bucle de operaciones por `const ops = removeGlyphs(content, (glyph) => touchesAny(glyph.quad, boxes), removedImageOps)`. El resto de `textChanges` no cambia. Borra de `apply.ts` las funciones movidas y `editText`.
4. `content/index.ts` exporta `removeGlyphs` y `type TextRun`.
5. Tests:
   - `tests/unit/content/interpreter.test.ts` (añadir): `BT /F1 18 Tf 72 676 Td (Hola) Tj ET` → un `TextRun` `{ op: 2, fontResource: 'F1', fontSize: 18, angle: 0, origin: [72, 676], fill: [0,0,0], renderMode: 0 }`; con `2 0 0 2 10 20 cm` antes → `fontSize` 36 y `origin` `[154, 1372]`; `0 0 1 rg`, `0.5 g`, `0 0 0 1 k`, `/Pattern cs /P1 scn` y `q 1 0 0 rg Q` (vuelve a negro); `3 Tr`; `BT 1 0 0 1 72 600 Tm 22 TL /F1 10 Tf (a) ' ET` → origen `[72, 578]`; texto girado 90° (`0 1 -1 0 300 300 Tm`) → `angle` 90; fuente Type3 → sin run y en `unmeasured`.
   - `tests/unit/content/remove-glyphs.test.ts`: quitar el glifo 1 de `(abc) Tj` con Helvetica 10 → `[(a) -556 (c)] TJ` (ancho de «b» = 556); `skip` omite la operación indicada; `'` conserva `T*` delante.
   - Los tests de `tests/unit/redact/apply.test.ts` y `images.test.ts` siguen pasando **sin cambios**.

## Criterios de aceptación
- [ ] Los casos del punto 5 pasan: `pnpm --filter lector-pdf exec vitest run tests/unit/content tests/unit/redact` en verde.
- [ ] `git diff --stat -- apps/lector-pdf/tests/unit/redact` vacío (la redacción no cambia).
- [ ] Cobertura ≥ 90 % en `src/core/content/interpreter.ts` y `src/core/content/remove-glyphs.ts`.
- [ ] `pnpm lint && pnpm typecheck && pnpm coverage` con código 0.

## Fuera de alcance
- Localizar líneas y elegir fuentes ([[PDF-144-editar-texto-localizar-linea]]). Colores en espacios ICC, Indexed o Separation (se aproximan como se indica). Recorrer Form XObjects.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/content/interpreter.ts`, `apps/lector-pdf/src/core/content/remove-glyphs.ts` (nuevo), `apps/lector-pdf/src/core/content/index.ts`, `apps/lector-pdf/src/core/redact/apply.ts`, `apps/lector-pdf/tests/unit/content/interpreter.test.ts`, `apps/lector-pdf/tests/unit/content/remove-glyphs.test.ts` (nuevo).
- Qué he hecho: el intérprete guarda relleno (`fill`), fuente (`fontResource`) y `Tr`, con los operadores de color (valores fijados a [0, 1]) y un `TextRun` por operación de texto medida en `PageContent.runs`. `removeGlyphs` se movió de `apply.ts` a `remove-glyphs.ts` sin cambiar su lógica; `textChanges` lo usa y se borró `editText` de `apply.ts`.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf exec vitest run tests/unit/content tests/unit/redact` → 6 ficheros, 124 tests en verde. `pnpm lint` → limpio. `pnpm typecheck` → limpio. `pnpm coverage` → código 0, 3767 tests en verde; `interpreter.ts` 99,57 % líneas, `remove-glyphs.ts` 100 % líneas. `git diff --stat -- apps/lector-pdf/tests/unit/redact` vacío.
- Dudas o cosas que no he podido hacer: (1) el ejemplo de la ficha da `op: 2` para `BT /F1 18 Tf 72 676 Td (Hola) Tj ET`, pero el índice real del `Tj` en `ops` es 3 (BT 0, Tf 1, Td 2, Tj 3); el test usa el índice real. (2) Los operadores de color con operandos mal formados (p. ej. `0.1 0.2 g`) no lanzan error: el relleno es negro, para no cambiar el comportamiento de redacción en páginas raras. (3) El coverage lo ejecuté mientras otro agente tenía el directorio de cobertura; reintenté tras esperar a que terminara.
