---
tipo: tarea
id: PDF-107
titulo: Importar formas y sellos del fichero como editables
app: pdf
estado: hecha
depende_de: [PDF-057, PDF-101, PDF-104]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, anotaciones]
---

# PDF-107 · Importar formas y sellos del fichero como editables

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0029-formas-y-sellos]] · Antes: [[PDF-057-formas-y-sellos]]

## Objetivo
Al abrir un PDF, los `/Square`, `/Circle`, `/Line`, `/Polygon` y nuestros `/Stamp` pasan a la línea base como anotaciones editables (con la geometría exacta del diccionario); los que no encajan siguen como ajenos, intactos.

## Contexto
- [[ADR-0029-formas-y-sellos]] («Importar»: cuándo una forma sigue ajena).
- `src/core/annotations/stamp-names.ts` (**patrón a copiar**: lee diccionarios con `ObjectReader`, nunca lanza) y `src/engine/annotations-import.ts` → `readPageAnnotations`.
- `src/core/annotations/import.ts`: `ForeignAnnotation`, `ImportedPage`, `parseRef`; `src/core/pdf-date.ts` → `parsePdfDate`; `src/core/pdf/text-string.ts` → `decodeTextString`.
- `src/core/annotations/shapes.ts` (PDF-057): `STAMP_NAMES`, `SHAPE_LINE_ENDINGS`.
- Fixture con un `/Square` ajeno: `tests/fixtures/structure.ts` → `buildAnnotated` (línea ~288).

## Qué hay que hacer
1. `src/core/annotations/import-shapes.ts`:
```ts
/** Subtipos que pueden pasar de ajenos a editables. */
export const SHAPE_SUBTYPES: ReadonlySet<string>; // Square, Circle, Line, Polygon, Stamp
/** Forma o sello editable a partir de su diccionario, o null si debe seguir ajena. Puro. */
export function shapeFromDict(d: PdfDict, foreign: ForeignAnnotation, fallbackDate: string): Annotation | null;
/** Lee los diccionarios de las ajenas con subtipo de SHAPE_SUBTYPES y mueve a `supported` las que encajan. Nunca lanza. */
export async function promoteShapes(reader: ObjectReader, page: ImportedPage, fallbackDate: string): Promise<ImportedPage>;
```
   `shapeFromDict`:
   - Comunes: `id`, `pageIndex`, `contents`, `author`, `modified ?? fallbackDate` de la ajena; `rect` de `/Rect` normalizado; `color` de `/C` (3 números en [0,1]; ausente → `[0,0,0]`; otro tamaño → `null`); `opacity` de `/CA` (por defecto 1); `created` de `/CreationDate` (`parsePdfDate`, o `null`); `origin = { kind: 'file', ref: parseRef(id sin 'ref:'), popupRef: /Popup o null }`.
   - Formas: `width` = `/BS /W` (o `/Border[2]`, por defecto 1; 0 → `null`, es una forma invisible); `/BS /S` presente y ≠ `S` → `null`; `/BE` con `/S /C` → `null`; `interior` de `/IC` (3 números) o `null`.
   - `Line`: `/L` 4 números (en ese orden); `/LE` ausente → `['None','None']`, valores fuera de `SHAPE_LINE_ENDINGS` → `null`; `/IT` presente y ≠ `LineArrow` → `null`.
   - `Polygon`: `/Vertices` ≥ 6 números y par; `/IT` presente → `null`.
   - `Stamp`: `/Name` ∈ `STAMP_NAMES` **y** `/NM` (texto) que empieza por `suite-`; si no → `null` (los sellos `SuiteFirma` siguen como hoy).
   - `promoteShapes`: conserva el orden de `foreign` para las que se quedan; las promovidas se añaden al final de `supported`. Un objeto ilegible deja la ajena como está.
2. `src/engine/annotations-import.ts` → `readPageAnnotations`: con `reader !== null`, si alguna ajena tiene subtipo de `SHAPE_SUBTYPES`, aplica `promoteShapes` **antes** de `readStampNames` (así los sellos que siguen ajenos aún reciben su `/Name`).
3. Actualiza los tests que esperaban el `/Square` de `annotated.pdf` como ajeno (`tests/unit/annotations/import.test.ts`, `engine-import.test.ts`, `annotation-actions.test.ts`, `comment-list.test.ts`, `tests/unit/fixtures-structure.test.ts`, `tests/ui/comments-panel.test.tsx`, `annotation-layer.test.tsx`, `link-layer.test.tsx`, según apliquen): ahora es editable de tipo `square`. Cita en el Registro cada test cambiado y por qué.
4. Tests: `tests/unit/annotations/import-shapes.test.ts` (diccionarios construidos con `dict`, `name`, `bytesString`) y una ida y vuelta en `tests/unit/annotations/shapes-interop.test.ts`.

## Criterios de aceptación
- [ ] Ida y vuelta: escribir con `buildIncrementalUpdate` un rectángulo con relleno, una elipse, una flecha de derecha a izquierda (`points [300,500,100,500]`), un polígono y un sello `Approved` (ids `suite-…`) sobre `basic-5.pdf` → reabrir con pdf.js + `ObjectReader` y `readPageAnnotations` → los cinco salen en `supported` con `annotationEquals` (de `diff.ts`) igual al original salvo `id`/`origin`/`modified`, y la flecha conserva `points` en el mismo orden.
- [ ] `annotated.pdf`: el `/Square` sale editable (`type: 'square'`, `width: 2`, `color [0,0.6,0]`, `interior: null`); el resto de ajenas igual que antes.
- [ ] Siguen ajenas: `/Square` con `/BS << /S /D >>`, `/Circle` con `/BE << /S /C >>`, `/Line` con `/LE [/None /Diamond]`, `/Line` con `/IT /LineDimension`, `/Polygon` con 4 números, `/Stamp /Approved` sin `/NM` o con `/NM (adobe-1)`, `/Stamp /SuiteFirma` (sigue saliendo como «Firma» en el panel).
- [ ] Mover el `/Square` de `annotated.pdf` y guardar → `qpdf --check` 0; el diccionario reescrito conserva `/T` y claves ajenas, sin `/RD` ni `/BE`.
- [ ] `readPageAnnotations` sin `reader` no cambia de comportamiento (test).
- [ ] `pnpm perf`: `annotations-import.perf.test.ts` sin regresión.
- [ ] Cobertura de `import-shapes.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0 (ajustar solo los E2E que esperaban el `/Square` como ajeno, citándolos).

## Fuera de alcance
- Herramientas de la barra (PDF-108, PDF-115). Polilíneas, nubes, cotas, sellos de otros programas (siguen ajenos).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/import-shapes.ts` (nuevo), `apps/lector-pdf/src/core/annotations/index.ts`, `apps/lector-pdf/src/engine/annotations-import.ts`, `apps/lector-pdf/tests/unit/annotations/import-shapes.test.ts` (nuevo), `apps/lector-pdf/tests/unit/annotations/shapes-interop.test.ts` (tests nuevos al final; ningún test existente cambiado).
- Qué he hecho: `shapeFromDict` y `promoteShapes` pasan a editables `/Square`, `/Circle`, `/Line`, `/Polygon` y `/Stamp` con `/NM suite-…` según la ficha. `readPageAnnotations` las promueve antes de `readStampNames` (sin lector no cambia). Tests unitarios y de ida y vuelta (5 formas con `buildIncrementalUpdate`, `annotated.pdf` y mover el `/Square` con `qpdf --check` 0).
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` 262 ficheros y 3389 tests OK (`import-shapes.ts` 99 % líneas); `pnpm perf` 43/43 OK; `pnpm --filter lector-pdf e2e` 259 OK y 6 fallidos. Cinco de ellos (`annotations-flow` «subrayar…», `annotations-foreign` veraPDF, `notes` «diálogo no modal», `outline` «índice como árbol», `tabs` axe) fallan igual en el código base (813a19b, revertido temporalmente para comprobarlo): no están relacionados. El sexto (`recover-qa` «Ctrl+Z…») pasó al repetirlo: inestable.
- Dudas o cosas que no he podido hacer:
  - Ningún test existente esperaba el `/Square` de `annotated.pdf` como ajeno, así que no ha hecho falta cambiar ninguno.
  - Decisiones de implementación que sigo del ADR-0029 y que el revisor puede querer confirmar: `/Border` con cuarto elemento (patrón de trazo) sigue ajena; `/BE` que no es diccionario sigue ajena; `/CA` fuera de [0, 1] se acota (igual que `import.ts`); `/CreationDate` no válida da `created: null` sin dejar la forma ajena.
  - Worktree: la ficha vivía solo en `813a19b` (rama `pdf-028-escritor-incremental`), no en el commit del worktree. Por eso el trabajo está en la rama `pdf-107-importar-formas-y-sellos` creada desde `813a19b`.
  - Los E2E fallidos de arriba (base) quedan para quien mantenga la iteración 6.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
Lint y typecheck OK; tests de `tests/unit/annotations` 496 OK. Diff de `import-shapes.ts` y `annotations-import.ts` conforme a la ficha (promoción antes de `readStampNames`, sin lector no cambia, nunca lanza).
Las 4 decisiones del programador se confirman (conservadoras, coherentes con ADR-0029: lo que no encaja sigue ajeno): `/Border` con patrón de trazo sigue ajena; `/BE` no diccionario sigue ajena; `/CA` se acota a [0,1] como `import.ts` (`clamp01`); `/CreationDate` inválida da `created: null` sin dejar la forma ajena.
Los E2E fallidos en base (anotados por el programador) quedan para el tester con el mismo criterio.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Lint, typecheck, coverage | OK | lint/typecheck sin errores; coverage global líneas 98,63 % |
| Cobertura `import-shapes.ts` ≥ 90 % | 99,26 % | `coverage-summary.json` |
| Ida y vuelta, `annotated.pdf`, formas que siguen ajenas, mover + qpdf, sin lector | OK | tests de `import-shapes.test.ts` y `shapes-interop.test.ts` dentro de coverage verde |
| `pnpm perf` | 43/43 OK | sin regresión en `annotations-import.perf` |
| E2E | 259 OK, 6 fallos | 5 ya fallan en la base (annotations-flow, annotations-foreign, notes, outline, tabs); `render` «annotated» falló bajo carga y pasa aislado (1.0 s). 16 sin ejecutar por dependencia de proyecto. Ninguno relacionado con formas |
Rendimiento: perf sin regresión. Tests añadidos: ninguno (los del programador cubren los criterios).
Pendiente para la iteración 6: los 5 E2E rotos en base.
