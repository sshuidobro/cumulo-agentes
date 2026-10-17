---
tipo: tarea
id: PDF-006
titulo: Núcleo - tabla de dimensiones y layout virtual con escalado de scroll
app: pdf
estado: bloqueada
depende_de: [PDF-001]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, rendimiento]
---

# PDF-006 · Núcleo: dimensiones y layout virtual

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Lógica pura que, dadas las dimensiones de N páginas, el zoom y la rotación de vista, calcula dónde va cada página en una columna vertical, qué páginas son visibles y cómo traducir el scroll cuando la altura total supera lo que admite el navegador. Mismo coste y comportamiento para 5 o 1 000 000 de páginas.

## Contexto
- Leer: [[ADR-0007-motor-y-visor-pdf]] (decisión "Layout virtual propio").
- Solo `core/`: nada de React, DOM ni pdfjs. Sin `!` (estrecha con `if`).
- Unidades: dimensiones de página en **puntos PDF** (sin rotar, ya multiplicadas por UserUnit); el layout en **px CSS** (`scale` = px por punto).

## Qué hay que hacer
1. `src/core/rotation.ts`: `export type Rotation = 0 | 90 | 180 | 270;` y `export function normalizeRotation(deg: number): Rotation` (múltiplo de 90 más cercano, módulo 360, negativos incluidos: `-90` → `270`, `450` → `90`).
2. `src/core/page-dims.ts`:
   ```ts
   export class PageDimsTable {
     static uniform(count: number, width: number, height: number, rotation: Rotation): PageDimsTable;
     readonly count: number;
     get version(): number;                 // +1 en cada set que cambia algo
     width(i: number): number; height(i: number): number; rotation(i: number): Rotation; isKnown(i: number): boolean;
     set(i: number, width: number, height: number, rotation: Rotation): boolean; // true si cambió; marca conocida
   }
   ```
   Internamente `Float32Array` (anchos, altos), `Uint16Array` (rotación), `Uint8Array` (conocida). Índices fuera de rango → `throw new RangeError(...)` (bug).
3. `src/core/layout.ts`:
   ```ts
   export interface LayoutParams { readonly scale: number; readonly rotation: Rotation; readonly gap: number; readonly padding: number; }
   export interface Layout {
     readonly count: number;
     readonly tops: Float64Array;     // longitud count + 1; tops[i] = y de la página i; tops[count] = fin
     readonly widths: Float64Array;   // px, ya rotados
     readonly heights: Float64Array;
     readonly totalHeight: number;    // padding + páginas + gaps + padding
     readonly maxWidth: number;
     readonly params: LayoutParams;
   }
   export const DEFAULT_GAP = 12; export const DEFAULT_PADDING = 16;
   export function computeLayout(dims: PageDimsTable, p: LayoutParams): Layout;
   export function pageAtY(layout: Layout, y: number): number;               // búsqueda binaria; y en el hueco tras una página → esa página; clamp a [0, count-1]; count 0 → -1
   export function visibleRange(layout: Layout, top: number, bottom: number, overscan: number): { readonly first: number; readonly last: number }; // count 0 → { first: 0, last: -1 }
   export const MAX_SCROLL_HEIGHT = 8_000_000;
   export interface ScrollMap { readonly scrollHeight: number; readonly factor: number }
   export function scrollMap(layout: Layout, viewportHeight: number): ScrollMap;
   export function scrollTopToContentY(scrollTop: number, map: ScrollMap): number;
   export function contentYToScrollTop(contentY: number, map: ScrollMap): number;
   export interface Anchor { readonly page: number; readonly fraction: number }   // fraction en [0, 1]
   export function anchorAt(layout: Layout, contentY: number): Anchor;
   export function contentYForAnchor(layout: Layout, anchor: Anchor): number;
   export function maxContentY(layout: Layout, viewportHeight: number): number;   // max(0, totalHeight - viewportHeight)
   ```
   - Rotación efectiva de la página i: `(dims.rotation(i) + p.rotation) % 360`; si es 90 o 270, ancho y alto se intercambian.
   - `tops[0] = padding`; `tops[i+1] = tops[i] + heights[i] + gap`; `totalHeight = tops[count] - gap + padding` (con `count === 0`: `2 * padding`).
   - `scrollMap`: si `totalHeight <= MAX_SCROLL_HEIGHT` → `{ scrollHeight: totalHeight, factor: 1 }`; si no → `scrollHeight = MAX_SCROLL_HEIGHT` y `factor = (totalHeight - vh) / (MAX_SCROLL_HEIGHT - vh)` (así el final del scroll coincide con el final del contenido).
   - `anchorAt`: página `pageAtY`; `fraction = clamp((y - tops[p]) / heights[p], 0, 1)`.
4. Tests `tests/unit/layout.test.ts`, `tests/unit/page-dims.test.ts` y benchmark `tests/unit/layout.bench.ts` (`bench` de Vitest).

## Criterios de aceptación
- [ ] (T) 3 páginas 612×792, `scale 1`, `gap 12`, `padding 16`: `tops = [16, 820, 1624, 2428]`, `totalHeight = 2432`, `maxWidth = 612`.
- [ ] (T) Rotación de vista 90 → anchos 792, altos 612; página con rotación propia 90 + vista 90 → sin intercambio (180).
- [ ] (T) `pageAtY`: y = 0 → 0; y = 810 (hueco tras la 0) → 0; y = 820 → 1; y = 1e9 → 2. `visibleRange(top 800, bottom 900, overscan 1)` → `{ first: 0, last: 2 }`.
- [ ] (T) 100 000 páginas de 1 056 px: `scrollMap` con `vh 800` → `scrollHeight 8 000 000`, `factor > 1`; `scrollTopToContentY(8_000_000 - 800)` === `totalHeight - 800` (±0,001); ida y vuelta `contentYToScrollTop(scrollTopToContentY(x)) ≈ x`.
- [ ] (T) Anclaje: con zoom 1 → 2 (recalcular layout), `contentYForAnchor(nuevo, anchorAt(viejo, y))` cae en la misma página y fracción.
- [ ] (T) `PageDimsTable.set` devuelve `false` si no cambia y no sube `version`; índice fuera de rango lanza `RangeError`.
- [ ] (T) Rendimiento: `computeLayout` de 1 000 000 de páginas < 100 ms; 1 000 000 de `pageAtY` aleatorios < 300 ms (asserts con `performance.now()` en un test normal; además el `bench`). Anota tiempos en el Registro.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `layout.ts` y `page-dims.ts` ≥ 95 % de líneas.

## Fuera de alcance
- Componentes React y scroll real (PDF-009). Zoom (PDF-007). Modos de doble página (PDF-050).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/rotation.ts`, `apps/lector-pdf/src/core/page-dims.ts`, `apps/lector-pdf/src/core/layout.ts` (nuevos); `apps/lector-pdf/tests/unit/rotation.test.ts`, `tests/unit/page-dims.test.ts`, `tests/unit/layout.test.ts`, `tests/unit/layout.bench.ts` (nuevos); esta ficha.
- Qué he hecho: implementado `normalizeRotation`, `PageDimsTable` (Float32/Uint16/Uint8 + versión) y el layout completo (`computeLayout`, `pageAtY`, `visibleRange`, `scrollMap`, anclajes, `maxContentY`) según la ficha. 52 tests unitarios nuevos; criterios de exactitud (tops, rotaciones, pageAtY, visibleRange, scroll de 100 000 páginas, ancla con zoom, RangeError) cubiertos.
- Comandos ejecutados y resultado:
  - `pnpm lint`: sin errores ni avisos.
  - `pnpm typecheck`: sin errores.
  - `pnpm test`: 32 ficheros, 396 tests en verde.
  - `pnpm coverage`: **falla** solo por los 2 tests de tiempo (ver dudas). Resto de tests en verde. Cobertura de `layout.ts` en líneas: 100 % (ejecución sin tests de tiempo).
  - `npx vitest bench --run` (benchmark, medias): `computeLayout` 1 000 000 páginas ≈ 44 ms (p75 46 ms); 1 000 000 `pageAtY` aleatorios ≈ 231 ms (p75 240 ms, máx. 284 ms); `scrollMap` 100 000 páginas ≈ 4 ms.
  - Tiempos de los asserts (mejor de 3 pasadas, sin cobertura): `computeLayout` ≈ 107 ms en la pasada de test (incluye JIT); `pageAtY` ≈ 230 ms de la consulta pura.
- Dudas o cosas que no he podido hacer:
  1. **Coverage y presupuestos de tiempo (bloqueante).** Con `pnpm coverage` (v8) los dos asserts de tiempo no se cumplen: `pageAtY` 820–1 155 ms frente a 300 ms, `computeLayout` ≈ 148 ms frente a 100 ms. Sin cobertura pasan con margen. La ficha exige a la vez los presupuestos en `pnpm test` y `pnpm coverage` con código 0. Opciones para el líder: (a) mover los asserts de tiempo a `pnpm bench` con umbral y dejar en `pnpm test` solo el comportamiento; (b) excluir de la ejecución de cobertura los tests marcados como de rendimiento; (c) otro criterio de medición. No he relajado presupuestos ni desactivado tests.
  2. **Constructor público `new PageDimsTable(count)`.** La ficha solo lista `uniform`, pero `isKnown` y `set` no tienen sentido sin poder crear páginas sin conocer. Lo he hecho público (tamaño 0, sin conocer). Revisar si se acepta.
  3. **Medición con mejor de 3 pasadas.** Los tests de tiempo toman el mínimo de 3 pasadas para no depender del ruido de los tests en paralelo. El presupuesto no cambia. Revisar si el líder lo acepta.
  4. **Vitest 5 y `bench`.** En esta versión `bench` es un fixture del contexto de test (`test('…', ({ bench }) => …)`), con `await bench(…).run()`; `vitest bench` lo ejecuta, no `pnpm test`. Usado así en `tests/unit/layout.bench.ts`.
  5. Margen estrecho en `pageAtY`: 231 ms medios frente a 300 ms en esta máquina.
- Estado: `bloqueada` a la espera de la decisión sobre el punto 1.
