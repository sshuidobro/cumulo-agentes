---
tipo: tarea
id: PDF-096
titulo: Layout de doble página (pares y con portada)
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, core, visor]
---

# PDF-096 · Layout de doble página (pares y con portada)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0024-modos-de-pagina]] · [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
`computeLayout` coloca las páginas en filas de una o dos (pares 1-2, 3-4… o con portada 1, 2-3, 4-5…) manteniendo el coste lineal y las consultas en O(log n). Con `spread: 'none'` el resultado es idéntico al actual.

## Contexto
- Leer: `src/core/layout.ts` completo, `tests/unit/layout.test.ts`, `tests/perf/layout.perf.test.ts`, y los usos de `layout.tops/widths/maxWidth` en `src/ui/viewer/Viewer.tsx`, `src/ui/sidebar/Thumbnails.tsx`, `src/ui/sidebar/CommentsPanel.tsx`, `src/core/annotations/comment-list.ts` (estos últimos **no** se tocan: siguen con `spread` por defecto).
- Solo se tocan `src/core/layout.ts` y sus tests.

## Qué hay que hacer
1. Tipos:
```ts
export type Spread = 'none' | 'pairs' | 'cover';
export interface LayoutParams { /* actuales */ readonly spread?: Spread } // ausente = 'none'
export interface Layout {
  /* actuales: count, tops, widths, heights, totalHeight, maxWidth, params */
  /** x de cada página dentro de una columna de ancho `maxWidth` (el visor suma el margen de centrado). */
  readonly lefts: Float64Array;
  /** Fila de cada página. */
  readonly rowOf: Uint32Array;
  /** Longitud `rowCount + 1`: primera página de cada fila; `rowStart[rowCount] === count`. */
  readonly rowStart: Uint32Array;
  /** Longitud `rowCount + 1`: y de cada fila; `rowTops[rowCount]` = final de la última fila + gap (como `tops[count]`). */
  readonly rowTops: Float64Array;
  readonly rowHeights: Float64Array;
  readonly rowWidths: Float64Array;
  readonly rowCount: number;
}
```
2. Reglas:
   - Filas: `none` → una página por fila. `pairs` → (0,1), (2,3)…; si `count` es impar, la última fila tiene una. `cover` → (0), (1,2), (3,4)…; la última puede tener una.
   - Ancho de fila = suma de anchos (ya rotados) + `gap` entre las dos. Alto de fila = máximo de los altos.
   - `tops[i] = rowTops[rowOf[i]]` (las páginas de una fila se alinean arriba). `tops[count] = rowTops[rowCount]`.
   - `maxWidth` = máximo de `rowWidths`. Fila centrada: `x0 = (maxWidth − rowWidth) / 2`; primera página `lefts = x0`, segunda `x0 + w1 + gap`. Las filas de una sola página también se centran.
   - `totalHeight` = `padding + Σ alturas de fila + gaps + padding` (misma fórmula que hoy, por filas).
3. Consultas:
   - `pageAtY(layout, y)` devuelve la **primera** página de la fila que contiene `y` (búsqueda binaria en `rowTops`, sin llamadas auxiliares en el bucle). Con `none` coincide con la actual.
   - `visibleRange` amplía `last` hasta la última página de su fila antes de sumar `overscan`.
   - `anchorAt` / `contentYForAnchor`: la fracción se mide sobre la altura de la **fila** (`rowHeights`) y `contentYForAnchor` usa la fila de `anchor.page`. Con `none`, igual que hoy.
   - Nuevas: `export function rowRange(layout: Layout, page: number): { readonly first: number; readonly last: number }` y `export function rowWidthOf(layout: Layout, page: number): number`.
4. Tests en `tests/unit/layout.test.ts` (añadir, no borrar) y dos casos en `tests/perf/layout.perf.test.ts`.

## Criterios de aceptación
- [ ] Con `spread` ausente o `'none'`, para 5 tablas de dimensiones (uniforme, mezclada, con rotaciones 0/90/180/270, 0 páginas, 1 página) `tops`, `widths`, `heights`, `totalHeight` y `maxWidth` son idénticos (`toEqual`) a los de la versión anterior (fijados como valores esperados en el test), y `lefts[i] === (maxWidth − widths[i]) / 2`.
- [ ] `pairs` con 5 páginas 600×800 px (scale 1), gap 12, padding 16: `rowCount` 3; `rowStart` `[0,2,4,5]`; `tops` `[16,16,828,828,1640,2452]`; `maxWidth` 1212; `lefts` `[0,612,0,612,306]`; `totalHeight` 2456.
- [ ] `cover` con 4 páginas: filas `[0]`, `[1,2]`, `[3]`; `pageAtY` en la fila 2 devuelve 1; `rowRange(layout, 2)` → `{ first: 1, last: 2 }`.
- [ ] Fila con alturas distintas (p. ej. 600×800 y 800×600): `rowHeights` = 800 y la fila siguiente empieza en `rowTop + 800 + gap`.
- [ ] `visibleRange(layout, y, y, 0)` con `y` en una fila de dos → `{ first, last }` incluye ambas.
- [ ] `anchorAt` y `contentYForAnchor` son inversas (±0,5 px) en los tres modos sobre 1 000 posiciones aleatorias con semilla.
- [ ] Rendimiento (`pnpm perf`): `computeLayout` de 1 000 000 de páginas con `pairs` < 150 ms; 1 000 000 de `pageAtY` aleatorios < 300 ms. Los dos tests actuales siguen pasando sin cambiar su umbral.
- [ ] Cobertura de `layout.ts` ≥ 95 % de líneas y ramas; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz y modo por páginas (PDF-050). Desplazamiento horizontal (descartado en ADR-0024).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
