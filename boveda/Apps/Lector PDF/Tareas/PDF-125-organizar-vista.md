---
tipo: tarea
id: PDF-125
titulo: Organizar - vista de cuadrícula con selección, teclado y barra
app: pdf
estado: en-revision
depende_de: [PDF-124, PDF-114]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-5, organizar, ui]
---

# PDF-125 · Organizar: vista de cuadrícula con selección, teclado y barra

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]], [[ADR-0027-dialogos-diferidos]] · Antes: [[PDF-124-organizar-estado]] · Sigue: [[PDF-126-organizar-arrastrar-e2e]]

## Objetivo
«Más acciones → Organizar páginas…» sustituye el visor por una cuadrícula virtualizada de miniaturas del plan, donde se seleccionan páginas con ratón y teclado y se giran, borran, mueven con el teclado e insertan páginas en blanco, con deshacer, guardar y cerrar.

## Contexto
- `src/state/organize-actions.ts` y `organize-store.ts` (PDF-124); `src/core/organize/plan.ts` (PDF-053).
- **Patrón de miniatura**: `src/ui/sidebar/ThumbnailItem.tsx` (render por `renderQueue` con `PRIORITY_THUMBNAIL`, `planCanvas`, `releaseCanvas`, modo noche). **Patrón de lista virtualizada con teclado**: `src/ui/sidebar/Thumbnails.tsx`.
- `src/ui/App.tsx:100-186` (dónde va la vista; `lazy` como `PrintDialog`), `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/kit/IconButton.tsx`, `src/ui/icons.tsx`, `src/ui/use-shortcuts.ts`, `src/ui/shortcuts.ts`.
- `src/ui/viewer/use-viewport-size.ts`; `useViewer` → `pageDims` / dimensiones por página.

## Qué hay que hacer
1. `src/core/organize/grid.ts` (puro):
```ts
export interface GridMetrics { readonly columns: number; readonly cell: number; readonly gap: number; readonly rowHeight: number; readonly rows: number }
export const ORGANIZE_CELL_SIZES = [120, 180, 240] as const;   // ancho de la miniatura en px CSS
export function gridMetrics(viewportWidth: number, count: number, cell: number): GridMetrics;  // gap 16, etiqueta 24 px, columnas ≥ 1
export function visibleCells(m: GridMetrics, scrollTop: number, viewportHeight: number, overscanRows: number): { readonly first: number; readonly last: number };
export function neighbour(m: GridMetrics, count: number, index: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown', pageRows: number): number;
```
2. `src/ui/organize/OrganizeView.tsx` (+ `OrganizeView.module.css`), cargado con `lazy` desde `App.tsx`, que lo muestra en lugar de `<div className={styles.body}>` cuando `useOrganize(s => s.open)`:
   - Estados: `loading` (mensaje y spinner como `LoadingState`), `error` (mensaje y botón «Cerrar»), `ready`/`saving`.
   - Cuadrícula `role="listbox"` `aria-multiselectable="true"` `aria-label={organizeMsg.title}` con `aria-activedescendant` del foco; solo se montan las filas visibles ± 2 (nunca más de 12 filas de celdas). Altura total = `rows × rowHeight` en un contenedor con *scroll*.
   - Celda (`OrganizeCell.tsx`, `role="option"`, `aria-selected`): miniatura de la página de origen dibujada con `rotation: slot.rotate` (el giro del hueco es absoluto) y la caja con la proporción de la página ya girada; `blank` = rectángulo blanco con borde; etiqueta «n» (posición nueva, 1-based) y, si el origen es otra posición, «(antes n)» en gris. Seleccionadas con borde de acento y fondo; foco visible.
   - Ratón: clic `selectOnly`; Ctrl/Cmd+clic `toggleKey`; Mayús+clic `extendTo`; doble clic → cierra la vista y va a esa página en el visor **solo si no hay cambios**; con cambios no hace nada.
   - Teclado: flechas/Inicio/Fin/RePág/AvPág mueven el foco (`neighbour`) y seleccionan solo ese; con Mayús, extienden; Espacio alterna; Ctrl+A todas; Supr/Retroceso borrar; Ctrl+[ y Ctrl+] girar izquierda/derecha; Alt+← / Alt+→ mueven la selección una posición; Ctrl+Z / Ctrl+Y / Ctrl+Mayús+Z; Ctrl+S guardar; Escape cierra (con aviso si hay cambios). Los atajos nuevos se añaden a `shortcuts.ts` (`organize-rotate-left`, `organize-rotate-right`, `organize-delete`, `organize-move-left`, `organize-move-right`) y solo están activos con la vista abierta.
   - El foco va a la cuadrícula al abrir y vuelve al botón «Más acciones» al cerrar.
3. `src/ui/organize/OrganizeToolbar.tsx` (`role="toolbar"`): Girar a la izquierda, Girar a la derecha, Eliminar, Insertar página en blanco (menú: «Antes de la selección» / «Después de la selección»), Deshacer, Rehacer (con `organizeMsg.undoLabel`), tamaño de miniatura (3 botones o `select` con `ORGANIZE_CELL_SIZES`), texto «N páginas · M seleccionadas», «Guardar» (primario) y «Cerrar». Botones de icono con `aria-label` y `title` con atajo; deshabilitados sin selección o mientras guarda.
4. Guardando: capa sobre la vista con `organizeMsg.saving(done, total)`, barra de progreso (`role="progressbar"`) y «Cancelar» → `cancelOrganizeSave`.
5. `DocumentMenu.tsx`: entrada «Organizar páginas…» (deshabilitada sin documento listo).
6. `organizeMsg` (PDF-124) gana los textos de la vista: `rotateLeft` «Girar a la izquierda», `rotateRight` «Girar a la derecha», `delete` «Eliminar páginas», `insertBlank` «Insertar página en blanco», `before`, `after`, `thumbSize` «Tamaño de miniatura», `count(n, m)`, `close` «Cerrar», `was(n)` «(antes n)», `pageOption(n)` «Página n» (nombre accesible de la celda, con «, girada 90°» si procede).
7. Tests: `tests/unit/organize/grid.test.ts`; `tests/ui/organize-view.test.tsx` (Testing Library, `setDocOpsRunner(inProcessDocOps())`, documento `basic-5.pdf` cargado como en los tests de miniaturas).

## Criterios de aceptación
- [ ] UI: abrir desde el menú con teclado (Intro) → la cuadrícula tiene foco y 5 opciones; flecha derecha + Mayús+flecha derecha → 2 seleccionadas y «5 páginas · 2 seleccionadas»; Supr → 3 opciones; Ctrl+Z → 5; Ctrl+] → la opción enfocada anuncia «girada 90°».
- [ ] UI: Alt+→ mueve la página enfocada una posición y la etiqueta muestra «(antes 1)»; Ctrl+S llama a `saveOrganize` (espía) y Escape con cambios pregunta con las tres opciones.
- [ ] UI: con 100 000 huecos (store preparado sin documento real: celdas sin miniatura) hay ≤ 12 filas montadas y `aria-activedescendant` sigue al foco al pulsar Fin.
- [ ] Unit: `gridMetrics`, `visibleCells` y `neighbour` en bordes (primera/última fila incompleta, 1 columna).
- [ ] axe sin violaciones en la vista (tema claro y oscuro); todos los botones de icono tienen `aria-label` y `title`.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto (vista diferida).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Arrastrar y soltar y e2e ([[PDF-126-organizar-arrastrar-e2e]]). Insertar desde archivo y extraer desde la vista ([[PDF-127-extraer-dividir-interfaz]], [[PDF-128-insertar-combinar-interfaz]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/organize/grid.ts` (nuevo: `gridMetrics`, `visibleCells`, `neighbour`, `fitBox`, constantes); `src/ui/organize/OrganizeView.tsx`, `OrganizeView.module.css`, `OrganizeCell.tsx`, `OrganizeToolbar.tsx` (nuevos); `src/ui/App.tsx` (vista lazy que sustituye al visor; deshacer/rehacer y atajos del visor apagados con la vista abierta); `src/ui/toolbar/DocumentMenu.tsx` (entrada «Organizar páginas…»); `src/ui/shortcuts.ts` (5 ids nuevos); `src/ui/messages-organize.ts` (textos de la vista); `src/ui/icons.tsx` (`IconInsertPage`). Tests: `tests/unit/organize/grid.test.ts` (24 casos), `tests/ui/organize-view.test.tsx` (8 casos).
- Qué he hecho: cuadrícula virtualizada (listbox con `aria-activedescendant`, máximo 12 filas montadas) con selección por ratón y teclado, giros, borrado, Alt+flechas, inserción en blanco, deshacer/rehacer, tamaño, guardado con progreso y cancelación, error y cierre con aviso. Miniaturas por la cola de render con el giro absoluto del hueco.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `npx vitest run --coverage` (raíz, directorio de informes propio): 294 ficheros, 3797 tests OK, código 0 (una primera pasada dio un timeout de 5 s en `page-tree.test.ts` PDF-052 con la máquina cargada; relanzado solo, 18/18, y la pasada completa siguiente fue verde). Cobertura de `grid.ts`: 100 % líneas. `vite build` a un directorio de la sesión (no `dist/`, para no interferir con el E2E ajeno) y `check-bundle`: arranque 539 292 bytes, presupuesto 600 000 OK.
- Dudas o cosas que no he podido hacer: (1) **Atajos**: el registro rechaza atajos duplicados y `Alt+←/→` (atrás/adelante) y `Retroceso` (pantalla completa) ya están usados. Por eso `organize-move-left` y `organize-move-right` van con `chords: []` y la cuadrícula atiende Alt+flechas y Retroceso directamente; `organize-delete` tiene solo `Supr`. Revisar si el líder prefiere otra solución. (2) La ficha pide `setDocOpsRunner(inProcessDocOps())` con `basic-5.pdf`: en jsdom no se puede (los fixtures usan `import.meta.url` y pdf.js necesita Node). El test usa una operación falsa que devuelve los giros de basic-5 (5 páginas, sin girar). (3) **axe** no se ha ejecutado: `axe-core` solo llega como dependencia de `@axe-core/playwright` (raíz), no del app; queda para el E2E del tester. (4) Criterio «Ctrl+] anuncia girada 90°»: el giro actúa sobre la selección (sin selección no hace nada, sin volver al foco); el test pulsa Inicio antes. (5) Decisiones menores que tomé: tamaño de miniatura por defecto 180 px (el selector no se guarda); al abrir, el primer hueco tiene foco sin selección; `pageOption(n, rotation)` recibe el giro para la frase «girada N°»; el tamaño de una página se intercambia si el giro del hueco es 90 o 270, igual que en `insertBlank`. (6) `visibleCells` corta en 12 filas: con un viewport muy alto (más de ~12 filas) las filas de abajo no se montan.

