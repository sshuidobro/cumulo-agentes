---
tipo: tarea
id: PDF-006
titulo: Núcleo - tabla de dimensiones y layout virtual con escalado de scroll
app: pdf
estado: en-revision
depende_de: [PDF-001]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, rendimiento]
---

# PDF-006 · Núcleo: dimensiones y layout virtual

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0012-suite-de-rendimiento]]

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
     constructor(count: number);            // páginas 0×0, rotación 0, ninguna conocida (aceptado en ronda 1)
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
4. Tests `tests/unit/layout.test.ts`, `tests/unit/page-dims.test.ts`, benchmark informativo `tests/unit/layout.bench.ts` (`bench` de Vitest) y asserts de tiempo en `tests/perf/layout.perf.test.ts` (ver [[ADR-0012-suite-de-rendimiento]] y la entrada del líder en el Registro, ronda 2).

## Criterios de aceptación
- [ ] (T) 3 páginas 612×792, `scale 1`, `gap 12`, `padding 16`: `tops = [16, 820, 1624, 2428]`, `totalHeight = 2432`, `maxWidth = 612`.
- [ ] (T) Rotación de vista 90 → anchos 792, altos 612; página con rotación propia 90 + vista 90 → sin intercambio (180).
- [ ] (T) `pageAtY`: y = 0 → 0; y = 810 (hueco tras la 0) → 0; y = 820 → 1; y = 1e9 → 2. `visibleRange(top 800, bottom 900, overscan 1)` → `{ first: 0, last: 2 }`.
- [ ] (T) 100 000 páginas de 1 056 px: `scrollMap` con `vh 800` → `scrollHeight 8 000 000`, `factor > 1`; `scrollTopToContentY(8_000_000 - 800)` === `totalHeight - 800` (±0,001); ida y vuelta `contentYToScrollTop(scrollTopToContentY(x)) ≈ x`.
- [ ] (T) Anclaje: con zoom 1 → 2 (recalcular layout), `contentYForAnchor(nuevo, anchorAt(viejo, y))` cae en la misma página y fracción.
- [ ] (T) `PageDimsTable.set` devuelve `false` si no cambia y no sube `version`; índice fuera de rango lanza `RangeError`.
- [ ] ~~(T) Rendimiento con asserts en un test normal~~ → sustituido el 2026-10-17 por los dos criterios siguientes ([[ADR-0012-suite-de-rendimiento]]).
- [ ] (T, comportamiento, en `tests/unit/layout.test.ts`) 1 000 000 de páginas 612×792 con `base`: `count === 1_000_000`, `tops[1_000_000] === 804_000_016`, `totalHeight === 804_000_020`; `pageAtY(l, l.tops[123_456])` → `123_456`; `pageAtY(l, l.tops[999_999] + 1)` → `999_999`. Sin `performance.now()` en `tests/unit/`.
- [ ] (T, rendimiento, en `tests/perf/layout.perf.test.ts`, medido con `measureBest` por defecto: 1 calentamiento + mínimo de 5) `computeLayout` de 1 000 000 de páginas < 100 ms; 1 000 000 de `pageAtY` aleatorios (semilla 42) < 300 ms. Presupuestos sin cambiar. Anota los tiempos de `pnpm perf` en el Registro.
- [ ] `pnpm perf` con código 0 en **3 ejecuciones seguidas**.
- [ ] `vitest.perf.config.ts` coincide con el del paso 1 del Registro del líder (proyecto `lector-pdf-perf` con `root`, alias de pdf.js y `globalSetup`).
- [ ] `grep -rn "performance.now" apps/lector-pdf/tests/unit/layout.test.ts` no devuelve nada; la salida de `pnpm coverage` no lista `layout.perf.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `layout.ts` y `page-dims.ts` ≥ 95 % de líneas.

## Fuera de alcance
- Componentes React y scroll real (PDF-009). Zoom (PDF-007). Modos de doble página (PDF-050).
- Mover asserts de tiempo de otras fichas (`fixtures.test.ts` de PDF-002, `annotations/commands.test.ts` de PDF-023): no tocar esos ficheros.

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

### [lider] replanificación — 2026-10-17
Decisión: [[ADR-0012-suite-de-rendimiento]]. Los asserts de tiempo de reloj salen de `pnpm test`/`pnpm coverage` y van a una suite aparte, `pnpm perf`, sin cobertura y en serie. Presupuestos **sin relajar**. Estado → `cambios-pedidos` (no cuenta como rechazo: `intentos` sigue en 0). Comprobado por el líder: los dos tests de tiempo actuales, ejecutados solos en serie y sin cobertura, pasan en 1,7 s de suite.

Respuesta a las dudas:
1. Resuelta con la suite de rendimiento (abajo, pasos exactos).
2. Constructor público `new PageDimsTable(count)`: **aceptado**; añadido a la firma de la ficha.
3. "Mejor de N": **aceptado** y normalizado como `measureBest` (1 calentamiento descartado + mínimo de 5). No es relajar: descarta JIT y ruido, el umbral es el mismo.
4. `bench` como fixture de Vitest 5: **aceptado**. `tests/unit/layout.bench.ts` se queda donde está; es informativo (`pnpm exec vitest bench --run`), no puerta de calidad.
5. Margen estrecho de `pageAtY`: anotado; no se toca el umbral. Si falla en otra máquina, se optimiza el algoritmo en una ficha nueva.

Pasos exactos (ronda 2):
1. **Nuevo** `vitest.perf.config.ts` en la raíz del repo, con este contenido literal. **Corrección del líder (2026-10-17, misma ronda):** una primera redacción de este paso daba una versión simple con `include: ['apps/*/tests/perf/…', 'packages/*/tests/perf/…']` en la raíz; si ya la has creado, **sustitúyela** por esta, porque la simple no aplica el alias de pdf.js ni el `globalSetup` de fixtures que necesitan PDF-005, PDF-017 y PDF-022. Comprobado por el líder con Vitest 5.0.5: un proyecto en línea (no `extends`, porque `extends` **suma** el `include` de la app y metería todos los tests unitarios):
   ```ts
   import { defineConfig } from 'vitest/config';

   // Suite de rendimiento (ADR-0012): solo asserts de tiempo de reloj, sin cobertura y un fichero cada vez.
   // Un proyecto por app/paquete con tests/perf/. Mantener alias y globalSetup iguales que en el vitest.config.ts de la app.
   export default defineConfig({
     test: {
       projects: [
         {
           test: {
             name: 'lector-pdf-perf',
             root: './apps/lector-pdf',
             include: ['tests/perf/**/*.perf.test.ts'],
             environment: 'node',
             globalSetup: ['tests/setup/global-setup.ts'],
             alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
             fileParallelism: false,
           },
         },
       ],
       fileParallelism: false,
       coverage: { enabled: false },
     },
   });
   ```
   No toques `vitest.config.ts` (raíz) ni `apps/lector-pdf/vitest.config.ts`: su `include` (`tests/unit/**/*.test.ts`, `tests/ui/**/*.test.tsx`) ya deja fuera `tests/perf/`, así que `pnpm test` y `pnpm coverage` no ejecutan la suite de rendimiento.
2. `package.json` (raíz), en `scripts`, tras `"coverage"`: `"perf": "vitest run --config vitest.perf.config.ts"`.
3. `tsconfig.json` (raíz): añade `"vitest.perf.config.ts"` al array `include` (para que `pnpm typecheck` lo compruebe).
4. **Nuevo** `apps/lector-pdf/tests/perf/measure.ts`:
   ```ts
   export interface Measurement<T> { readonly value: T; readonly ms: number }
   export interface MeasureOptions { readonly warmup?: number; readonly runs?: number }
   /** Ejecuta fn `warmup` veces sin medir (por defecto 1) y luego `runs` veces (por defecto 5); devuelve el último valor y el tiempo mínimo. */
   export function measureBest<T>(fn: () => T, opts?: MeasureOptions): Measurement<T>;
   ```
   Usa `performance.now()`. `runs < 1` o `warmup < 0` → `throw new RangeError(...)`. Sin `!`.
5. **Nuevo** `apps/lector-pdf/tests/perf/layout.perf.test.ts`: mueve aquí los dos `it` de tiempo de `layout.test.ts` ("calcula 1 000 000 de páginas en menos de 100 ms" y "1 000 000 de consultas aleatorias en menos de 300 ms"), usando `measureBest(fn)` en vez de `bestOf(3, fn)`. Copia el generador `seeded` (semilla 42). Mismos umbrales: `100` y `300`. Mantén `expect(value.count).toBe(1_000_000)` y `expect(checksum).toBeGreaterThan(0)`.
6. `apps/lector-pdf/tests/unit/layout.test.ts`: borra esos dos `it` y la función `bestOf`; añade un `describe('1 000 000 de páginas')` con los asserts de comportamiento del criterio correspondiente (sin medir tiempo). `seeded` solo se queda si algún test de `tests/unit/` lo sigue usando (lint `no-unused-vars`).
7. Comprueba: `pnpm lint && pnpm typecheck && pnpm test && pnpm coverage` y `pnpm perf` tres veces. Anota en el Registro los tiempos que muestre el fallo o, si pasan, los de `pnpm exec vitest bench --run` y la duración de `pnpm perf`.

### [programador] ronda 2 — 2026-10-17
- Ficheros cambiados: `vitest.perf.config.ts` (nuevo, con la versión corregida de la ronda del líder: proyecto `lector-pdf-perf`); `package.json` (raíz, script `perf`); `tsconfig.json` (raíz, include); `apps/lector-pdf/tests/perf/measure.ts` (nuevo, `measureBest`); `apps/lector-pdf/tests/perf/layout.perf.test.ts` (nuevo, los dos asserts de tiempo); `apps/lector-pdf/tests/unit/layout.test.ts` (quitados `bestOf`, `seeded` y los dos `it` de tiempo; añadido `describe('1 000 000 de páginas')` con asserts de comportamiento); esta ficha.
- Qué he hecho: separados los tests de tiempo de `pnpm test`/`pnpm coverage` en la suite `pnpm perf` (ADR-0012), con los mismos umbrales (100 ms y 300 ms) y `measureBest` (1 calentamiento + mínimo de 5). Los asserts de comportamiento de 1 000 000 de páginas quedan en `tests/unit/` y sin `performance.now()`. Ningún test saltado ni presupuesto relajado.
- Comandos ejecutados y resultado:
  - `pnpm lint`: código 0, sin avisos.
  - `pnpm typecheck`: código 0.
  - `pnpm test`: 35 ficheros, 426 tests en verde; `layout.perf.test.ts` no se ejecuta.
  - `pnpm coverage`: código 0; `layout.ts` 98,7 % líneas (100 % en `page-dims.ts` y `rotation.ts` según `coverage-summary.json`); `layout.perf.test.ts` no aparece.
  - `pnpm perf` × 3 seguidas: código 0 las tres; duración del comando 2,85 s, 2,90 s y 2,84 s (el reporte interno de Vitest: 2,03 s). Los tiempos exactos por assert no se han extraído en esta ronda; ambos pasan.
  - `grep -rn "performance.now" apps/lector-pdf/tests/unit/layout.test.ts`: sin resultados.
  - `pnpm exec vitest bench --run apps/lector-pdf/tests/unit/layout.bench.ts`: ejecuta el benchmark (1 test en verde), pero esta versión no imprime tabla ni genera JSON; no tengo cifras nuevas de bench. Las de la ronda 1 se mantienen como referencia.
- Dudas o cosas que no he podido hacer:
  - Ninguna bloqueante. Margen de `pageAtY` sin cambios desde la ronda 1 (duda 5, ya anotada por el líder).
  - Para PDF-002 (app `lector-pdf`): **mecanismo exacto**. Su assert de tiempo va en `apps/lector-pdf/tests/perf/<nombre>.perf.test.ts` (patrón `tests/perf/**/*.perf.test.ts`), se ejecuta con `pnpm perf` y reutiliza el proyecto `lector-pdf-perf` de `vitest.perf.config.ts`, sin tocar la config. Medir con `measureBest(fn)` importado de `./measure` (`apps/lector-pdf/tests/perf/measure.ts`). Sin `performance.now()` en `tests/unit/`.
  - Para un paquete (p. ej. COM-002 en `packages/shared`): la config solo tiene un proyecto, el de `lector-pdf`. Haría falta añadir un proyecto `{ test: { name, root: './packages/<pkg>', include: ['tests/perf/**/*.perf.test.ts'], environment: 'node', fileParallelism: false } }` y decidir dónde vive `measureBest` (hoy está en `apps/lector-pdf`; no lo he movido a `packages/`, porque no está decidido).
- Estado: `en-revision`.
