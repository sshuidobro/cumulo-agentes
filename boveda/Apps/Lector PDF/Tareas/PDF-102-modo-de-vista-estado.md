---
tipo: tarea
id: PDF-102
titulo: Modo de vista - estado, preferencia y navegación por filas
app: pdf
estado: en-revision
depende_de: [PDF-096]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, core, estado, visor]
---

# PDF-102 · Modo de vista: estado, preferencia y navegación por filas

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0024-modos-de-pagina]]

## Objetivo
El modo de vista (`continuous`/`paged` × `none`/`pairs`/`cover`) vive en `useViewer`, se recuerda como preferencia global y «página siguiente/anterior» avanzan por filas en doble página. Sin interfaz (PDF-050).

## Contexto
- Leer: `src/core/layout.ts` (`Spread`, PDF-096), `src/core/zoom.ts` (`resolveZoom`, `fitZoom`, `Size`), `src/state/viewer-store.ts`, `src/state/view-actions.ts`, `src/state/navigation.ts`, `src/state/appearance-actions.ts` (patrón de preferencia con validador), `tests/unit/navigation*.test.ts` si existe.

## Qué hay que hacer
1. `src/core/view-mode.ts`:
```ts
export interface ViewMode { readonly scroll: 'continuous' | 'paged'; readonly spread: Spread }
export const DEFAULT_VIEW_MODE: ViewMode; // { scroll: 'continuous', spread: 'none' }
export function isViewMode(v: unknown): v is ViewMode;
/** Primera página de la fila de `page`. none: page; pairs: page − page % 2; cover: 0 si page = 0, si no page − ((page − 1) % 2). */
export function rowFirstPage(page: number, spread: Spread): number;
/** Primera página de la fila siguiente (dir 1) o anterior (dir −1), acotada a [0, count − 1]; null si no hay. */
export function stepRow(page: number, dir: 1 | -1, spread: Spread, count: number): number | null;
/** Tamaño de referencia para los ajustes de zoom: la fila de `page` (anchos rotados sumados, alto máximo) en pt, y el hueco extra en px. */
export function referenceSize(dims: PageDimsTable, viewRotation: Rotation, spread: Spread, page: number): { readonly pagePt: Size; readonly extraWidthPx: number };
/** Ventana de contenido del modo por páginas: desde `rowTops[row] − padding` con alto `rowHeights[row] + 2·padding`. */
export function pagedWindow(layout: Layout, row: number): { readonly top: number; readonly height: number };
```
   `extraWidthPx` es `DEFAULT_GAP` si la fila tiene dos páginas, si no 0 (el llamante lo suma a `margin.width` de `resolveZoom`).
2. `viewer-store.ts`: `viewMode: ViewMode` en `ViewerState` (inicial `DEFAULT_VIEW_MODE`). Es global: `openDocument` no lo reinicia (el `initialViewerState` lo lleva, así que conservar el valor actual al abrir, como `dimsVersion`).
3. `view-actions.ts`: `loadViewMode()` (al arrancar, desde `prefs` clave `viewMode` con `isViewMode`; inválido → por defecto) y `setViewMode(mode: ViewMode)` (store + `prefs.set`); al cambiar `spread`, `currentPage` pasa a `rowFirstPage(currentPage, spread)` y se pide `goToPage` a esa página para no perder la posición.
4. `navigation.ts`: `nextPage`/`prevPage` usan `stepRow` con el `spread` actual; `firstPage`/`lastPage` van a la fila de la primera/última página.
5. Tests unitarios `tests/unit/view-mode.test.ts` y ampliar los de navegación.

## Criterios de aceptación
- [ ] `rowFirstPage`: pairs 0→0, 1→0, 4→4, 5→4; cover 0→0, 1→1, 2→1, 3→3, 4→3.
- [ ] `stepRow` cover con 6 páginas: 0→1, 1→3, 3→5, 5→null; dir −1: 5→3, 1→0, 0→null. pairs con 5: 4→null, 4 (−1)→2.
- [ ] `referenceSize` pairs, p. 0 de 600×800 pt + p. 1 de 600×800 pt, rotación 0 → `{ pagePt: { width: 1200, height: 800 }, extraWidthPx: 12 }`; con rotación de vista 90 → `{ width: 1600, height: 600 }`; fila de una página → `extraWidthPx: 0`.
- [ ] `isViewMode` rechaza `null`, `{}`, `{ scroll: 'x', spread: 'none' }`, y acepta las 6 combinaciones válidas.
- [ ] Preferencia: `setViewMode({ scroll: 'paged', spread: 'cover' })` escribe `viewMode` en `prefs`; `loadViewMode()` con un valor corrupto deja el modo por defecto sin lanzar; abrir otro documento conserva el modo.
- [ ] Navegación: con pairs, `nextPage()` desde la p1 (índice 0) va al índice 2; con `none` todo igual que antes (los tests actuales pasan sin cambios).
- [ ] Cobertura de `view-mode.ts` ≥ 95 %; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Visor y menú (PDF-050). Pantalla completa (PDF-097).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: ninguno en esta ronda. La implementación ya estaba en el commit `c047858` (`apps/lector-pdf/src/core/view-mode.ts`, `src/state/viewer-store.ts`, `src/state/view-actions.ts`, `src/state/navigation.ts`, `src/state/document-actions.ts`, `src/main.tsx`, `tests/unit/view-mode.test.ts`, `tests/unit/view-actions.test.ts`, `tests/unit/navigation.test.ts`, `tests/unit/document-actions.test.ts`). Lo he verificado contra cada criterio.
- Qué he hecho: revisado el código existente contra la ficha: `ViewMode`, `isViewMode`, `rowFirstPage`, `stepRow`, `referenceSize`, `pagedWindow`, `viewMode` en el store (conservado al abrir otro documento), `loadViewMode`/`setViewMode` con `prefs`, y `nextPage`/`prevPage`/`firstPage`/`lastPage` por filas. Los tests cubren los valores exactos de los criterios de aceptación.
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos); `pnpm typecheck` OK; `pnpm coverage` OK (exit 0; 196 ficheros, 2335 tests pasan; `view-mode.ts` con 98,11 % de líneas, 96,87 % de ramas).
- Dudas o cosas que no he podido hacer: no he commiteado (lo pediste así). `referenceSize` está implementada, pero no he comprobado que el visor la use para el zoom de ajuste; no figura en los criterios de la ficha. Tampoco he ejecutado `pnpm perf` ni e2e porque la ficha no los pide.
