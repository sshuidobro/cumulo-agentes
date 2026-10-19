---
tipo: tarea
id: PDF-063
titulo: Comparar dos PDFs - núcleo de diferencias de texto
app: pdf
estado: en-curso
depende_de: [PDF-022]
intentos: 0
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
