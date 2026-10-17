---
tipo: tarea
id: PDF-015
titulo: Panel lateral con pestañas y miniaturas virtualizadas
app: pdf
estado: pendiente
depende_de: [PDF-012]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, miniaturas, rendimiento]
---

# PDF-015 · Panel lateral y miniaturas

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Un panel lateral izquierdo que se abre/cierra (F4) con pestañas («Miniaturas»; «Marcadores» llega en PDF-016 y «Comentarios» en PDF-036). Las miniaturas se muestran en una lista virtualizada (igual de fluida con 100 000 páginas), se dibujan bajo demanda con prioridad menor que las páginas, marcan la página actual y llevan a la página al pulsarlas o con el teclado.

## Contexto
- Leer: `src/core/layout.ts`, `render-queue.ts`, `canvas-size.ts`, `src/state/render-service.ts`, `src/engine/render.ts`, `src/ui/viewer/Viewer.tsx` (cómo virtualiza), `src/state/navigation.ts`, `packages/platform/src/types.ts` (`prefs`).
- pdf.js: `doc.getPageMode()` → `'UseNone' | 'UseOutlines' | 'UseThumbs' | ...` (puede ser `null`).
- Patrón ARIA: lista de opciones con `aria-activedescendant` (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).

## Qué hay que hacer
1. Store: `sidebar: 'none' | 'thumbnails' | 'outline' | 'comments'`. Acciones en `src/state/sidebar-actions.ts`: `toggleSidebar()` (abre la última pestaña usada o `thumbnails`), `showSidebarTab(tab)`. La pestaña elegida se guarda en `prefs` (`'sidebar'`, con *guard* de los 4 valores). Al abrir un documento: si `getPageMode()` es `UseThumbs` → `thumbnails`; `UseOutlines` → `outline`; si no, lo guardado en `prefs` (por defecto `'none'`).
2. `src/ui/sidebar/Sidebar.tsx` (+ CSS Module, ancho 232 px, borde derecho): `role="tablist"` con pestañas (`role="tab"`, `aria-selected`, `aria-controls`) y el panel (`role="tabpanel"`). En esta ficha solo existe la pestaña «Miniaturas»; deja preparado un array de pestañas al que PDF-016 y PDF-036 añaden la suya. Flechas izquierda/derecha cambian de pestaña (patrón ARIA *tabs*).
3. `src/ui/sidebar/Thumbnails.tsx`: contenedor de scroll `role="listbox"`, `aria-label={msg.thumbnails}`, `tabIndex={0}`, `aria-activedescendant={'thumb-' + currentPage}`.
   - Layout con `computeLayout(dims, { scale: THUMB_WIDTH / (dims.width(0) o alto si está girada), rotation, gap: 32, padding: 12 })`, `THUMB_WIDTH = 128`; misma virtualización que el visor (`visibleRange` con *overscan* 2) y `scrollMap` para el escalado.
   - Cada miniatura (`ThumbnailItem.tsx`, `React.memo`): `role="option"`, `id="thumb-<i>"`, `aria-selected={i === currentPage}`, `aria-label={msg.pageOf(i+1, n)}`; marco con un `<canvas>` y debajo la etiqueta (etiqueta de página si existe, si no el número). Se dibuja con `renderQueue.request({ key: 'thumb:<i>', priority: 2, run })` (mismo `renderPageToCanvas` que las páginas; `planCanvas` con `devicePixelRatio`); al desmontar `cancel` + `releaseCanvas`.
   - Clic → `goToPage(i)`. Teclado en la lista: ↑/↓ → página anterior/siguiente, Inicio/Fin → primera/última, Re Pág/Av Pág → ±(miniaturas visibles). La lista desplaza su scroll para mantener visible la `currentPage` cuando esta cambia (si ya es visible, no se mueve).
4. Barra: botón «Panel lateral» (`IconSidebar`, `aria-pressed`) y atajo `toggle-sidebar` `['F4']`. `App.tsx`: el visor ocupa el resto del ancho; al abrir/cerrar el panel el visor mantiene la página (el anclaje de PDF-009 ya lo cubre al cambiar el ancho).
5. Mensajes: `sidebar` «Panel lateral», `thumbnails` «Miniaturas».
6. Tests: `tests/ui/sidebar.test.tsx`, `tests/ui/thumbnails.test.tsx` (motor simulado), `tests/e2e/thumbnails.spec.ts`.

## Criterios de aceptación
- [ ] (T) Con 100 000 páginas y panel de 600 px de alto, la lista monta ≤ 12 `role=option`; tras llevar su scroll al final, la última opción existe y sigue habiendo ≤ 12.
- [ ] (T) Clic en la miniatura 7 → `goToPage(6)`; con foco en la lista, `ArrowDown` → página siguiente y `aria-activedescendant` cambia; `End` → última.
- [ ] (T) Las miniaturas se piden con prioridad 2 (las páginas del visor van antes: con la cola llena de trabajos de prioridad 0, ninguna miniatura empieza).
- [ ] (T) `F4` abre y cierra el panel; la pestaña se recuerda en `prefs`; un documento con `PageMode /UseOutlines` abre la pestaña `outline` (simulado en esta ficha: comprueba el valor del store).
- [ ] E2E: `pages-5000.pdf` con el panel abierto → la miniatura 1 tiene un `canvas` dibujado (píxeles no blancos) en < 3 s; desplazar la lista al final no deja más de 20 `canvas` de miniatura en el DOM; clic en la última miniatura → «Página 5000 de 5000» visible.
- [ ] E2E: con el visor desplazándose a la página 40, la miniatura 40 está visible y marcada (`aria-selected="true"`).
- [ ] Accesibilidad: pestañas y lista operables solo con teclado; foco visible.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Marcadores (PDF-016), comentarios (PDF-036), arrastrar miniaturas para reordenar (PDF-053), ancho redimensionable del panel.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
