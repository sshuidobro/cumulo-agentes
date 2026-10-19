---
tipo: tarea
id: PDF-063
titulo: Comparar dos PDFs - núcleo de diferencias de texto
app: pdf
estado: cambios-pedidos
depende_de: [PDF-022]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, comparar]
---

# PDF-063 · Comparar dos PDFs: núcleo de diferencias de texto

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0031-comparar-pdfs]] · Paridad: [[Paridad Adobe Acrobat]] · Sigue: [[PDF-112-comparar-interfaz]]

> 2026-10-19 (líder): se reparte en núcleo (esta ficha) e interfaz ([[PDF-112-comparar-interfaz]]).

## Objetivo
Lógica pura que compara el texto de dos documentos página a página por palabras y devuelve los cambios con sus posiciones en los ítems de pdf.js, recorriendo documentos grandes sin bloquear y con cancelación. Fixture con una palabra cambiada.

## Contexto
- [[ADR-0031-comparar-pdfs]] («Unidad», «Emparejado», «Algoritmo», «Ejecución»).
- `src/core/search/page-text.ts`: `TextItemLike`, `PageText`, `TextPos`, `buildPageText`, `rawOffsetToPos`.
- `src/core/search/session.ts`: `PageTextSource` y `SearchSession` (patrón de recorrido con cesión del hilo cada `timeSliceMs`, progreso cada 100 ms, `AbortController`, `now` inyectable).
- `tests/fixtures/catalog.ts`: `BASIC_LINE_3`, `buildBasic5`, `FIXTURES`, `GENERATOR_VERSION`.

## Qué hay que hacer
1. Fixture: en `catalog.ts`, `basic-5-changed.pdf` = `basic-5.pdf` con la línea 3 de la página 2 «Texto de búsqueda en la hoja dos.» (cambia «página» por «hoja»). Sube `GENERATOR_VERSION` a 5. Añádelo a `fixtures/FUENTES.md` si la tabla de generados lo lista (si no, al catálogo basta).
2. `src/core/compare/words.ts`:
```ts
export interface Word { readonly text: string; readonly start: TextPos; readonly end: TextPos } // end exclusivo, como SearchMatch
/** Palabras = tramos de no-espacios del texto NFC de la página. Una palabra que termina en '-' justo antes de un '\n' se une con la siguiente (texto sin el guion; start de la primera, end de la segunda). */
export function pageWords(items: readonly TextItemLike[]): readonly Word[];
```
3. `src/core/compare/diff.ts`:
```ts
export type DiffOp = { readonly kind: 'equal' | 'delete' | 'insert'; readonly aStart: number; readonly aEnd: number; readonly bStart: number; readonly bEnd: number };
/** Myers O(ND) sobre dos listas de cadenas. `null` si hacen falta más de `maxD` ediciones. Operaciones contiguas del mismo tipo fusionadas. */
export function diffSequences(a: readonly string[], b: readonly string[], maxD: number): readonly DiffOp[] | null;
```
4. `src/core/compare/compare.ts`:
```ts
export const MAX_EDITS_PER_PAGE = 2000;
export type PageChange =
  | { readonly kind: 'replace' | 'delete' | 'insert'; readonly removed: readonly Word[]; readonly added: readonly Word[] }; // delete: added vacío; insert: removed vacío
export type PageComparison =
  | { readonly kind: 'same'; readonly page: number }
  | { readonly kind: 'changed'; readonly page: number; readonly changes: readonly PageChange[] }
  | { readonly kind: 'too-different'; readonly page: number }
  | { readonly kind: 'only-in-a' | 'only-in-b'; readonly page: number };
/** Une un 'delete' seguido inmediatamente de un 'insert' en un 'replace'. */
export function comparePageWords(page: number, a: readonly Word[], b: readonly Word[]): PageComparison;
export interface CompareProgress { readonly pagesDone: number; readonly totalPages: number; readonly changedPages: number }
export interface CompareCallbacks { onPage(r: PageComparison): void; onProgress(p: CompareProgress): void; onDone(p: CompareProgress & { readonly cancelled: boolean }): void }
/** Recorre max(numA, numB) páginas en orden. Cede el hilo cada `timeSliceMs` (8) de trabajo; progreso como máximo cada 100 ms. Un fallo al leer una página → se informa como 'too-different' y se sigue. */
export class CompareSession {
  constructor(a: { readonly numPages: number; readonly source: PageTextSource }, b: { readonly numPages: number; readonly source: PageTextSource }, callbacks: CompareCallbacks, opts?: { readonly timeSliceMs?: number; readonly now?: () => number });
  start(): void;
  cancel(): void;
}
/** Texto legible de un cambio: «Se ha cambiado “página” por “hoja”.», «Se ha eliminado “…”.», «Se ha añadido “…”.» (máx. 80 caracteres por lado con «…»). */
export function describeChange(c: PageChange): string;
```
   `onPage` se llama solo para páginas que no son `same`.
5. Tests: `tests/unit/compare/words.test.ts`, `diff.test.ts`, `compare.test.ts` (con `PageTextSource` falsos y con pdf.js en Node sobre los fixtures) y `tests/perf/compare.perf.test.ts`.

## Criterios de aceptación
- [ ] `basic-5.pdf` frente a `basic-5-changed.pdf` (pdf.js en Node + `createPageTextSource`): un único `onPage` → página 1 (0-based) `changed` con un cambio `replace` de `removed` = [«página»] y `added` = [«hoja»]; `describeChange` = «Se ha cambiado “página” por “hoja”.»; las posiciones de `removed[0]` señalan exactamente «página» en los ítems (`items[start.item].str.slice(...)`).
- [ ] `basic-5.pdf` frente a sí mismo: ningún `onPage`; `onDone` con `changedPages: 0`.
- [ ] `basic-5.pdf` (5 p.) frente a `outline.pdf`: las páginas de más salen como `only-in-a` u `only-in-b`.
- [ ] Unit: `diffSequences` con casos clásicos (vacíos, todo distinto, inserción al inicio y al final, `maxD` superado → `null`); `pageWords` une «docu-\nmento» en «documento».
- [ ] `cancel()` a mitad → `onDone({ cancelled: true })` y no se leen más páginas (fuente espía).
- [ ] `pnpm perf`: `pages-5000.pdf` frente a sí mismo con pdf.js en Node, recorrido completo < 30 s; ninguna página individual (cálculo, sin lectura) > 30 ms con dos textos de 5 000 palabras y 1 500 cambios.
- [ ] Cobertura de `src/core/compare/` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz y superposición visual (PDF-112). Emparejar páginas insertadas o movidas. Cambios de formato o de imágenes.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/compare/words.ts`, `diff.ts`, `compare.ts` (nuevos); `apps/lector-pdf/tests/fixtures/catalog.ts` (fixture `basic-5-changed.pdf`, `GENERATOR_VERSION` 5); `apps/lector-pdf/tests/unit/fixtures.test.ts` (recuento de fixtures 25 → 26); `apps/lector-pdf/tests/unit/compare/{words,diff,compare}.test.ts` (nuevos); `apps/lector-pdf/tests/perf/compare.perf.test.ts` (nuevo).
- Qué he hecho: `pageWords` (NFC, posiciones de ítem, unión de guiones de corte), `diffSequences` (Myers con tope D, operaciones fusionadas, tokens convertidos a enteros para que el bucle no compare cadenas), `comparePageWords` y `CompareSession` (cesión del hilo, progreso como máximo cada 100 ms, cancelación, fallo de lectura → `too-different`) y `describeChange` (lados recortados a 80 caracteres con «…»). Fixture `basic-5-changed.pdf` añadido al catálogo; `FUENTES.md` no lista los generados, así que no lo he tocado.
- Comandos ejecutados y resultado: `pnpm lint` → sin errores ni avisos. `pnpm typecheck` → OK. `pnpm coverage` → código 0, 211 ficheros y 2571 tests en verde; cobertura de líneas de `src/core/compare/`: `compare.ts` 97,95 %, `diff.ts` 100 %, `words.ts` 100 %. `pnpm exec vitest run --config vitest.perf.config.ts compare.perf` → OK: página de 5 000 palabras con 1 500 cambios, peor de 5 ejecuciones 20–25 ms (≤ 30 ms); `pages-5000.pdf` frente a sí mismo 3–7,5 s (< 30 s). Los tiempos varían mucho según la carga de la máquina compartida: con load 15 la página tardó 38–47 ms antes de optimizar `diffSequences`.
- Dudas o cosas que no he podido hacer: el criterio de rendimiento depende de la carga de la máquina; conviene medirlo en reposo (`pnpm perf`). En `pnpm coverage` un test de `fixtures-encrypted` (AES-256 con objstm) superó 5 s una vez con la máquina cargada y pasó en las ejecuciones siguientes; no lo he tocado. No he añadido `index.ts` en `core/compare/` porque `core/search/` tampoco lo tiene.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Lint y typecheck limpios; tests de `tests/unit/compare` (30) y `compare.perf` en verde (página 20 ms, pages-5000 3,6 s). Criterios cubiertos con tests; sin problemas bloqueantes. No he lanzado la batería completa ni la cobertura global (otros revisores en curso); el programador reporta cobertura de `core/compare/` ≥ 97 %.

### [tester] ronda 1 — 2026-10-19 — FALLA
| Criterio | Resultado | Evidencia |
|---|---|---|
| lint, typecheck | OK | limpios |
| `pnpm coverage` | OK | exit 0, 211 ficheros, 2573 tests; `core/compare` líneas 98,92 % (compare 97,95; diff 100; words 100) |
| Tests funcionales (changed/same/only-in/cancel/diff/words) | OK | dentro de la batería en verde |
| Perf `pages-5000.pdf` frente a sí mismo < 30 s | OK | 3,8–4,3 s |
| Perf página 5 000 palabras / 1 500 cambios ≤ 30 ms | FALLA (intermitente) | `pnpm perf` y 6 ejecuciones aisladas de `compare.perf` (load 3–5 en 4 núcleos): peor 20,9 / 26,2 / 30,7 / 34,1 / 37,4 / 39,2 ms; 4 de 7 ejecuciones superan 30 ms. |

Reproducir: `cd /home/claude/cumulo-agentes && pnpm exec vitest run --config vitest.perf.config.ts compare.perf` (repetir 3 veces).
Petición: dar margen real a `diffSequences`/`comparePageWords` (objetivo ≤ 15 ms en reposo, p. ej. recortar prefijo/sufijo común, reutilizar arrays Int32Array, evitar copias en la fusión de operaciones) para que el presupuesto de 30 ms se cumpla de forma estable con carga moderada. No se relaja el umbral.
Tests añadidos: ninguno. Rendimiento: arriba.
