---
tipo: tarea
id: PDF-015
titulo: Panel lateral con pestañas y miniaturas virtualizadas
app: pdf
estado: en-revision
depende_de: [PDF-012]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos: `apps/lector-pdf/src/core/sidebar.ts`, `src/state/sidebar-actions.ts`, `src/ui/sidebar/Sidebar.tsx`, `src/ui/sidebar/Thumbnails.tsx`, `src/ui/sidebar/ThumbnailItem.tsx`, `src/ui/sidebar/Sidebar.module.css`; tests `tests/unit/sidebar.test.ts`, `tests/unit/sidebar-actions.test.ts`, `tests/ui/sidebar.test.tsx`, `tests/ui/thumbnails.test.tsx`, `tests/e2e/thumbnails.spec.ts`. Cambios añadidos a ficheros compartidos: `src/state/viewer-store.ts` (campo `sidebar`), `src/state/document-actions.ts` (lee el PageMode y fija el panel al abrir), `src/ui/App.tsx` y `App.module.css` (F4, cuerpo con panel y visor), `src/ui/toolbar/MainToolbar.tsx` (botón «Panel lateral»), `src/ui/shortcuts.ts` (`toggle-sidebar` = F4), `src/ui/messages.ts`, `src/ui/icons.tsx` (`IconSidebar`).
- Qué he hecho: panel con pestaña «Miniaturas» (`role=tablist`/`tab`/`tabpanel`, flechas izquierda y derecha entre pestañas), lista `role=listbox` virtualizada con `computeLayout` + `scrollMap` (overscan 2), miniaturas en `renderQueue` con prioridad 2, marcado de la página actual, clic y teclado (↑/↓, Inicio/Fin, Re/Av Pág) que llevan al visor con `goToPage`. Store `sidebar` con `toggleSidebar`/`showSidebarTab` y prefs `sidebar` con guarda de 4 valores; al abrir, `PageMode` (`UseThumbs`/`UseOutlines`) manda sobre lo guardado.
- Comandos ejecutados y resultado: `pnpm typecheck` sin errores; `pnpm test` 105 ficheros, 1344 tests en verde; `pnpm coverage` código 0; `pnpm exec eslint` sobre todos mis ficheros sin avisos; `pnpm --filter lector-pdf e2e`: 52 pasan y 1 falla (ver dudas); `tests/e2e/thumbnails.spec.ts` 3/3 en verde (miniatura 1 dibujada en < 3 s, ≤ 20 lienzos tras recorrer la lista, clic en la 5000, miniatura 40 marcada). `pnpm lint` falla solo en `tests/e2e/text-qa.spec.ts` (no es mío).
- Dudas o cosas que no he podido hacer:
  1. **e2e `viewer.spec.ts:88` (Tab hasta el visor) falla, y no es por este cambio en exclusiva.** El bucle da 12 pulsaciones y antes del visor hay ya 16 controles tabulables (Abrir, Deshacer, Rehacer, Atrás, Adelante, navegador de página ×3, Seleccionar, Mano, zoom ×4, girar ×2); mi botón «Panel lateral» añade el 17.º. No lo he tocado porque no es mío (viene de PDF-012 y PDF-014); quien lo posea debe ampliar el bucle o ajustar el test.
  2. Persistencia de la última pestaña: `prefs.sidebar` guarda también `none`, así que tras cerrar el panel la pestaña recordada vive solo en memoria de sesión; al reabrir la app, «Panel lateral» abre miniaturas. Lo he interpretado como la ficha pide (guarda los 4 valores). Es decisión del líder si debe persistir la última pestaña aparte.
  3. Un PDF con `PageMode /UseOutlines` deja el store en `outline`: el panel se abre con la barra de pestañas sin ninguna seleccionada y sin contenido hasta que PDF-016 añada la pestaña «Marcadores».
  4. No he hecho `git commit`: el árbol tiene cambios de PDF-012/014/019 sin confirmar y no quería mezclarlos con este trabajo.

### [revisor] ronda 1 — 2026-10-18 — CAMBIOS
Comprobado: `pnpm typecheck` OK; `pnpm test` 1348 en verde. `pnpm lint` falla (ver punto 2). Código del panel, miniaturas, virtualización, prioridad 2, cancelación/liberación de lienzos y teclado: correcto, sin hallazgos bloqueantes.
1. `apps/lector-pdf/tests/e2e/viewer.spec.ts:88` — el test «el visor es enfocable con Tab» falla porque el botón «Panel lateral» (esta ficha) eleva a 17 los controles previos al visor y el bucle solo da 12 pulsaciones. El criterio exige `pnpm --filter lector-pdf e2e` con código 0 y el test está sin tocar — hacerlo robusto, igual que se hizo con zoom-controls: sin número fijo de pulsaciones, pulsar Tab hasta que el visor tenga el foco con un límite holgado (p. ej. 40) o enfocar por rol y comprobar el orden relativo.
2. `apps/lector-pdf/tests/e2e/text-qa.spec.ts:6,20` — `pnpm lint` falla (`consistent-type-imports` y `no-non-null-assertion`). NO atribuible al programador: es de un tester (PDF-013/014). Se señala para que el líder lo derive al tester; hasta que se arregle el criterio `pnpm lint` código 0 no puede darse por cumplido, pero no es trabajo de esta ficha.
3. (opcional) `src/state/sidebar-actions.ts` — `lastTab` solo vive en memoria; decisión del líder si debe persistirse (duda 2 del programador).

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/viewer.spec.ts` (test «el visor es enfocable con Tab»: bucle de hasta 40 pulsaciones que para al enfocar el visor, sin número fijo), `apps/lector-pdf/tests/e2e/text-qa.spec.ts` (lint: `import type { Page }` en vez de `import()`, y `boundingBox()` comprobado con error en vez de `!`; la prueba no cambia).
- Qué he hecho: atendido el punto 1 del revisor (Tab del visor robusto con el botón «Panel lateral») y el punto 2 (los dos errores de lint de `text-qa.spec.ts`, que el líder me ha autorizado a arreglar). Sin cambios en código de producción.
- Comandos ejecutados y resultado: `pnpm lint` código 0; `pnpm typecheck` código 0; `pnpm test` 106 ficheros, 1348 tests en verde. E2E completo en el puerto 4394 (config temporal fuera del repo, retirada después): 57/57 en la última pasada. En dos pasadas anteriores fallaron tests de tareas largas (`viewer.spec.ts:101` y `render.spec.ts:116`, límite 100 ms) con la carga de la máquina a 15–18 por otros testers en paralelo; aislados pasan 4/4 veces y en la pasada final todo pasó.
- Dudas o cosas que no he podido hacer: `pnpm --filter lector-pdf e2e` fija el puerto 4173 en `playwright.config.ts`, así que usé una copia temporal con 4394 (no modificada en el repo). Los dos tests de tareas largas dependen de la carga del equipo: si el tester los ve rojos con otros procesos corriendo, conviene repetirlos aislados antes de tocar código. No he hecho commit.

