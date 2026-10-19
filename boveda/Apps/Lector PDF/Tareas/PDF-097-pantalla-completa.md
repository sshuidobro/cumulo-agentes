---
tipo: tarea
id: PDF-097
titulo: Modo pantalla completa (lectura y presentación)
app: pdf
estado: en-curso
depende_de: [PDF-050, COM-017]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, ui, visor]
---

# PDF-097 · Modo pantalla completa (lectura y presentación)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0024-modos-de-pagina]] · Paridad: [[Paridad Adobe Acrobat]] (área 1)

## Objetivo
Como el «Modo de pantalla completa» de Adobe (Ctrl+L): la ventana ocupa la pantalla, desaparecen barras y panel, se ve una página (o fila) entera sobre fondo negro, y se avanza con clic, →, Av Pág o Espacio. Esc o Ctrl+L salen y todo vuelve como estaba.

## Contexto
- Leer: `src/ui/App.tsx` (barras y panel), `src/ui/viewer/Viewer.tsx` (modo `paged`, PDF-050), `src/ui/toolbar/ViewMenu.tsx`, `src/ui/shortcuts.ts`, `src/state/view-actions.ts` (`setViewMode`, `setZoomMode`), `packages/platform/src/types.ts` (`setFullscreen`, `onFullscreenChange`, COM-017).
- Textos en `src/ui/messages-view.ts`.

## Qué hay que hacer
1. `src/state/fullscreen-actions.ts`: store `useFullscreen` `{ on: boolean }`; `enterFullscreen()`: guarda `{ viewMode, zoomMode, sidebar }` actuales, pone `{ scroll: 'paged', spread: actual }` (sin escribir la preferencia: usa una variante `applyViewMode(mode, { persist: false })` de `view-actions.ts`) y `fit-page`, cierra el panel, `platform.setFullscreen(true)`; si devuelve `err`, sigue en «pantalla completa dentro de la ventana» (barras ocultas igualmente). `exitFullscreen()`: restaura lo guardado y `setFullscreen(false)`. Suscripción a `onFullscreenChange(false)` → `exitFullscreen()` (salida por el SO o F11).
2. `App.tsx`: con `on`, no se renderizan `MainToolbar`, barra de comentarios ni panel; el visor ocupa todo con fondo `#000` (también en tema claro) y sin huecos entre páginas visibles (la fila centrada vertical y horizontalmente).
3. `Viewer.tsx` con `on`: clic izquierdo en una página → fila siguiente; clic derecho no hace nada especial; el cursor se oculta tras 2 s sin mover el ratón y vuelve al moverlo. Las anotaciones no se pueden crear (herramienta forzada a `select` y restaurada al salir) pero los enlaces funcionan.
4. Atajos: `fullscreen: ['Mod+L']` (alterna), y con `on`: `Escape` sale (antes que «cancelar herramienta»), → / Av Pág / Espacio / Intro avanzan, ← / Re Pág / Retroceso retroceden, Inicio/Fin a la primera/última.
5. `ViewMenu.tsx`: entrada «Pantalla completa» con el atajo a la derecha.
6. Aviso al entrar: `viewMsg.fullscreenHint` «Pulsa Esc para salir de la pantalla completa.» durante 3 s (aviso existente, `role="status"`).
7. Tests UI y E2E `tests/e2e/fullscreen.spec.ts` (Chromium headless admite `requestFullscreen`; si no, el test comprueba el modo «dentro de la ventana»).

## Criterios de aceptación
- [ ] E2E: Ctrl+L con `basic-5.pdf` → no hay barra de herramientas ni panel; la p1 entera visible y centrada sobre fondo negro (píxel de esquina del visor = `rgb(0, 0, 0)`); aviso «Pulsa Esc…».
- [ ] E2E: clic en la página, →, Av Pág y Espacio avanzan una página cada uno (indicador interno `data-current-page`); ← y Re Pág retroceden; Fin va a la 5.
- [ ] E2E: Esc → todo como antes: modo de vista, zoom, panel abierto con su pestaña y herramienta anteriores; la preferencia `viewMode` no ha cambiado.
- [ ] E2E con «Doble página» activo antes: en pantalla completa se ven filas de dos y → avanza de fila en fila.
- [ ] E2E: un enlace interno de `links.pdf` funciona en pantalla completa; arrastrar no crea anotaciones.
- [ ] UI: `setFullscreen` devuelve `err('unsupported')` → igualmente se ocultan barras y Esc sale; `onFullscreenChange(false)` desde la plataforma → sale y restaura.
- [ ] Axe sin incidencias `serious`/`critical` en pantalla completa.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.
- [ ] Manual (Registro): en `tauri dev`, Ctrl+L ocupa toda la pantalla (sin bordes de ventana) y Esc vuelve a la ventana normal con su tamaño.

## Fuera de alcance
- Transiciones entre páginas, avance automático, puntero láser.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
