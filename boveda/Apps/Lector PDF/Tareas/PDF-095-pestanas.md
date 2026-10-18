---
tipo: tarea
id: PDF-095
titulo: Barra de pestañas y atajos para varios documentos
app: pdf
estado: pendiente
depende_de: [PDF-100, PDF-101, PDF-049]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, ui, pestanas]
---

# PDF-095 · Barra de pestañas y atajos para varios documentos

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · Paridad: [[Paridad Adobe Acrobat]] (área 1)

## Objetivo
Como en Adobe Reader, con más de un documento abierto aparece una barra de pestañas encima de la barra de herramientas: clic o teclado para cambiar, botón × para cerrar (preguntando si hay cambios), marca de cambios sin guardar, y Ctrl+Tab / Ctrl+Mayús+Tab / Ctrl+W / Ctrl+F4.

## Contexto
- Leer: `src/state/tabs.ts` (PDF-094), `src/ui/App.tsx`, `src/ui/shortcuts.ts` y `src/ui/use-shortcuts.ts`, `src/ui/toolbar/MainToolbar.tsx`, `src/state/unsaved-guard.ts` (`installCloseGuard`), `src/state/save-actions.ts` (`isSaving`), `src/ui/kit/` (botones e iconos), `src/ui/icons.tsx`.
- Textos en `src/ui/messages-tabs.ts` (`tabsMsg`).
- Patrón ARIA «Tabs» de WAI-ARIA APG (activación manual: las flechas mueven el foco, Intro/Espacio activan).

## Qué hay que hacer
1. `src/ui/tabs/TabBar.tsx` + `TabBar.module.css`: se muestra solo con **2 o más** pestañas. `role="tablist"` con `aria-label` «Documentos abiertos»; cada pestaña es un `role="tab"` con `aria-selected`, `aria-controls` al visor, `title` = nombre completo, texto truncado con elipsis (ancho máx. 220 px, mín. 120 px; si no caben, la barra hace scroll horizontal y la activa se mantiene visible con `scrollIntoView({ inline: 'nearest' })`), «• » delante si `dirty`, indicador de carga si `status === 'loading'` e icono de aviso si `'error'`. Botón × (`aria-label` «Cerrar “<nombre>”», `tabIndex={-1}`) a la derecha. Clic central (botón 1) cierra. *Roving tabindex*: solo la activa tiene `tabIndex=0`; ←/→ mueven el foco, Inicio/Fin a la primera/última, Intro/Espacio activan, Supr cierra la enfocada.
2. `App.tsx`: `<TabBar />` encima de `MainToolbar`; el visor y el panel se montan una vez (cambian de contenido al cambiar `useViewer`).
3. Atajos en `shortcuts.ts` (sintaxis de `@suite/shared`: solo existe `Mod`, que es Ctrl fuera de Mac): `next-tab: ['Mod+Tab']`, `prev-tab: ['Mod+Shift+Tab']`, `close-tab: ['Mod+W', 'Mod+F4']`, con descripciones `tabsMsg.nextTab` «Documento siguiente», `tabsMsg.prevTab` «Documento anterior», `tabsMsg.closeTab` «Cerrar documento». Con una sola pestaña, `close-tab` cierra el documento. Chrome no deja a una página capturar Ctrl+Tab ni Ctrl+W: los atajos funcionan en la app de escritorio (y en Playwright); en el navegador se usa la barra con ratón o teclado. Anotarlo para el Manual en el Registro.
4. Bloqueos: con `isSaving()`, con un diálogo modal abierto (`useChoice`, contraseña, impresión) o mientras se dibuja la firma, cambiar o cerrar pestaña no hace nada.
5. Cierre de ventana (`installCloseGuard`): si `hasAnyUnsavedChanges()`, se cancela el cierre y, pestaña a pestaña con cambios (de izquierda a derecha), se activa y se llama a `confirmDiscardOrSave()`; un «Cancelar» detiene el proceso y deja la app abierta en esa pestaña; si todas siguen, `closeWindow()`.
6. Tests UI `tests/ui/tab-bar.test.tsx` y E2E `tests/e2e/tabs.spec.ts`, `tests/e2e/tabs-performance.spec.ts`.

## Criterios de aceptación
- [ ] E2E: abrir `basic-5.pdf` → no hay barra de pestañas; abrir `links.pdf` → barra con 2, la activa `links.pdf`; clic en `basic-5.pdf` → se muestra con su página y zoom anteriores.
- [ ] E2E teclado: Ctrl+Tab y Ctrl+Mayús+Tab alternan (circular con 3 documentos); Tab hasta la barra, → y Intro activan la siguiente; Supr la cierra.
- [ ] E2E: con un resaltado sin guardar en `basic-5.pdf`, su pestaña muestra «• »; Ctrl+W sobre ella → «¿Guardar los cambios…?»; «Cancelar» la deja abierta; «No guardar» la cierra y queda `links.pdf` sin barra (1 pestaña).
- [ ] E2E: abrir 10 documentos (copias de `basic-5.pdf` con nombres distintos generadas por el test) y un 11.º → aviso «Puedes tener hasta 10…» y siguen 10.
- [ ] E2E: abrir de nuevo un documento ya abierto → se activa su pestaña y aviso «… ya está abierto.».
- [ ] E2E cierre de ventana (web, `beforeunload` simulado como en `save-qa.spec.ts`) con 2 pestañas sucias → se pregunta por la primera y luego por la segunda.
- [ ] Rendimiento (`tabs-performance.spec.ts`, fixtures de `perf-fixture.ts` de 1 000 páginas, 3 pestañas): cambiar de pestaña con Ctrl+Tab hasta que el lienzo de la página visible está pintado ≤ 500 ms (p95 de 20 cambios); tras 20 cambios, `JSHeapUsedSize` (CDP `Performance.getMetrics`, tras `HeapProfiler.collectGarbage`) ≤ el medido tras la 1.ª ronda + 50 MB; ninguna *long task* > 200 ms durante los cambios.
- [ ] Axe sin incidencias `serious`/`critical` con 3 pestañas (una sucia, una con error).
- [ ] UI: la barra no aparece con 0 o 1 pestaña; los textos y `aria-label` coinciden con los indicados.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.
- [ ] Manual (Registro): en `tauri dev`, Ctrl+Tab y Ctrl+W funcionan; abrir dos PDFs desde el explorador de archivos («Abrir con») crea dos pestañas.

## Fuera de alcance
- Arrastrar pestañas para reordenar o sacarlas a otra ventana. Restaurar las pestañas al reiniciar la app (los recientes cubren reabrir).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
