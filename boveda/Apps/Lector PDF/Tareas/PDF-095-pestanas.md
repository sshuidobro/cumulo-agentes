---
tipo: tarea
id: PDF-095
titulo: Barra de pestañas y atajos para varios documentos
app: pdf
estado: en-test
depende_de: [PDF-100, PDF-101, PDF-049, PDF-097]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-20
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
1. `src/ui/tabs/TabBar.tsx` + `TabBar.module.css`: se muestra solo con **2 o más** pestañas. `role="tablist"` con `aria-label` «Documentos abiertos»; cada pestaña es un `role="tab"` con `aria-selected`, `aria-controls` al visor, `title` = nombre completo, texto truncado con elipsis (ancho máx. 220 px, mín. 120 px; si no caben, la barra hace scroll horizontal y la activa se mantiene visible con `scrollIntoView({ inline: 'nearest' })`), «• » delante si `dirty`, indicador de carga si `status === 'loading'` e icono de aviso si `'error'`. Botón × a la derecha, **fuera del árbol de accesibilidad** (decisión del líder, ronda 3): `aria-hidden="true"`, `tabIndex={-1}`, `title` «Cerrar “<nombre>”» (tooltip para ratón); la pestaña lleva `aria-keyshortcuts="Delete"` para anunciar que Supr la cierra. Clic central (botón 1) cierra. *Roving tabindex*: solo la activa tiene `tabIndex=0`; ←/→ mueven el foco, Inicio/Fin a la primera/última, Intro/Espacio activan, Supr cierra la enfocada.
2. `App.tsx`: `<TabBar />` encima de `MainToolbar` (oculta en pantalla completa, `useFullscreen.on`, PDF-097); el visor y el panel se montan una vez (cambian de contenido al cambiar `useViewer`).
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
- [ ] UI: el × tiene `aria-hidden="true"`, `tabIndex=-1` y `title` «Cerrar “links.pdf”»; clic en él cierra la pestaña; cada `role="tab"` tiene `aria-keyshortcuts="Delete"`; no hay ningún `role="button"` accesible dentro del `tablist`.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.
- [ ] Manual (Registro): en `tauri dev`, Ctrl+Tab y Ctrl+W funcionan; abrir dos PDFs desde el explorador de archivos («Abrir con») crea dos pestañas.

## Fuera de alcance
- Arrastrar pestañas para reordenar o sacarlas a otra ventana. Restaurar las pestañas al reiniciar la app (los recientes cubren reabrir).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/Viewer.tsx` (el visor no roba el foco si está en la barra de pestañas); `apps/lector-pdf/tests/fixtures/catalog.ts` (fixture `pages-1000.pdf`); `apps/lector-pdf/tests/unit/fixtures.test.ts` (recuento 28 → 29 por el fixture nuevo); nuevos `apps/lector-pdf/tests/e2e/tabs.spec.ts`, `apps/lector-pdf/tests/e2e/tabs-performance.spec.ts` y `apps/lector-pdf/tests/e2e/tabs-kit.ts`.
- Qué he hecho: `TabBar`, `tab-actions.ts`, atajos, cableado en `App.tsx`, `unsaved-guard` y tests UI ya estaban en el árbol (commit 8a53421); los he verificado contra la ficha. He añadido los E2E de los criterios (6 de 7 pasan) y el de rendimiento (pasa). Copias de `basic-5.pdf` con `/ID` distinto para que pdf.js no las tome por duplicados. Corrección de foco: al cambiar con Intro, el visor se llevaba el foco y Supr no cerraba.
- Comandos ejecutados y resultado: `pnpm lint`: OK. `pnpm typecheck`: OK salvo errores en `tests/unit/pdf/rewrite.test.ts` (trabajo ajeno en curso, PDF-131; no lo he tocado). `pnpm coverage`: solo fallaba el recuento de fixtures, ya corregido; el resto (3334 tests) pasa. `playwright test tests/e2e/tabs.spec.ts --project=chromium`: 6 pasan, 1 falla (axe, ver abajo). `playwright test tests/e2e/tabs-performance.spec.ts --project=chromium-perf`: pasa; medidas: cambio de pestaña p95 97 ms (límite 500), heap 7.8 → 7.9 MB, 0 long tasks. La primera ejecución de perf se bloqueó por CPU ocupada por otros procesos (ADR-0016), no por la app. No he lanzado la suite E2E completa.
- Criterio NO cumplido: axe «critical aria-required-children» en el `role="tablist"`. La causa es que el botón × (`role=button`) es hijo directo de la lista a través del `div role=presentation` de cada pestaña; la ficha pide ambas cosas (× con nombre accesible dentro de cada pestaña y axe limpio). Solucionarlo exige mover el × fuera del `tablist` (cambio de estructura) o quitarlo del árbol de accesibilidad (cambiaría el test de la ×). Es una decisión de diseño: la dejo para el líder/revisor. Sin decidir, no marco la ficha como terminada.
- Para el Manual (no probado aquí): en el navegador Chrome no entrega Ctrl+Tab ni Ctrl+W a la página; los atajos funcionan en la app de escritorio y en Playwright, y en el navegador se usa la barra con ratón o teclado. Pendiente en `tauri dev` de la máquina del usuario: Ctrl+Tab, Ctrl+W y «Abrir con» con dos PDF.
- Dudas o cosas que no he podido hacer: (1) decisión sobre el criterio axe (ver arriba). (2) El criterio de rendimiento menciona «fixtures de 1 000 páginas»: uso tres copias de `pages-1000.pdf`. (3) No he hecho commit (petición del usuario).

### [programador] ronda 2 — 2026-10-19
- Ficheros cambiados: ninguno de código (el árbol ya contenía la ronda 1 committeada en 813a19b); solo esta ficha.
- Qué he hecho: he verificado el estado sin cambiar código. El único criterio abierto sigue siendo el axe. No hay comentario nuevo del revisor en el Registro, así que no he tocado la estructura de la barra. La ficha pide a la vez que el × (`aria-label`) esté dentro de cada pestaña y que axe no dé incidencias `critical`; con la estructura actual eso es imposible, así que es una decisión de diseño que no me corresponde tomar. Opciones para el líder: (A) sacar el × del `role="tablist"` a un contenedor hermano, manteniendo su posición visual a la derecha de cada pestaña; (B) dejar el × dentro con `aria-hidden="true"` (Supr ya cierra la pestaña enfocada) y el criterio axe se cumple, pero los lectores de pantalla no ven el botón; (C) relajar el criterio axe o aceptar la excepción documentada en el Manual.
- Comandos ejecutados y resultado: `pnpm lint`: exit 0. `pnpm typecheck`: exit 0. `playwright test tests/e2e/tabs.spec.ts --project=chromium` (en `apps/lector-pdf`): 6 pasan, 1 falla (axe `critical aria-required-children` en `div role="tablist"`). No he lanzado de nuevo el E2E de rendimiento ni `pnpm coverage`.
- Dudas o cosas que no he podido hacer: decisión de accesibilidad del × (opciones A/B/C arriba). Sin ella el criterio axe no se cumple y no puedo marcar la ficha como `en-revision`; la dejo `bloqueada`. Tampoco he hecho el commit de cierre porque no hay cambios de código que commitear.

### [lider] ronda 3 — 2026-10-19 · decisión de accesibilidad del ×
- **Decisión: opción B.** Es el patrón de Chrome, Firefox y VS Code: el × es una ayuda de ratón y el teclado/lector de pantalla cierra con Supr (y Ctrl+W). A (sacar el × a un contenedor hermano) complica el CSS y la posición sin mejorar nada para el lector de pantalla; C (relajar axe) va contra `calidad-profesional`.
- Instrucciones, en `apps/lector-pdf/src/ui/tabs/TabBar.tsx` → `TabItem`:
  1. En el botón ×: quitar `aria-label`; añadir `aria-hidden="true"` y `title={tabsMsg.closeNamed(tab.title)}`; mantener `tabIndex={-1}` y `onClick`. (axe `aria-hidden-focus` no salta con `tabIndex=-1`.)
  2. En el `role="tab"`: añadir `aria-keyshortcuts="Delete"`.
  3. Mantener el `div role="presentation"`. Si axe sigue dando `aria-required-children`, cambiar el `div` por `role="none"` y comprobar; no tocar nada más de la estructura.
  4. `tests/ui/tab-bar.test.tsx:87`: buscar el × con `screen.getByTitle(tabsMsg.closeNamed('links.pdf'))` y añadir los asertos del nuevo criterio UI.
  5. Pasar `tabs.spec.ts` completo (7/7), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` y dejar en `en-revision`.
- Para el Manual: «Cerrar pestaña: botón ×, clic central, Supr con la pestaña enfocada o Ctrl+W».
- `intentos` no se incrementa (el bloqueo era de la ficha, no del programador).

### [programador] ronda 4 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/ui/tabs/TabBar.tsx` (× con `aria-hidden="true"`, `title` y sin `aria-label`; `aria-keyshortcuts="Delete"` en cada `role="tab"`); `apps/lector-pdf/tests/ui/tab-bar.test.tsx` (aserciones del × y del nuevo criterio UI); esta ficha.
- Qué he hecho: aplicada la decisión de accesibilidad del líder (opción B) sin tocar la estructura: el `div role="presentation"` se mantiene y no fue necesario cambiarlo a `role="none"`. Axe pasa sin incidencias `serious`/`critical` con 3 pestañas.
- Comandos ejecutados y resultado: `pnpm lint`: exit 0. `pnpm typecheck`: exit 0. `tests/ui/tab-bar.test.tsx`: 15/15. `playwright test tests/e2e/tabs.spec.ts --project=chromium`: 7/7. `pnpm coverage`: exit 0 (líneas 98.63 %, sentencias 95.64 %, ramas 90.66 %, funciones 97.73 %). No he lanzado de nuevo `tabs-performance.spec.ts` en esta ronda (sin cambios de rendimiento; medido en ronda 1: p95 97 ms, 0 long tasks).
- Para el Manual: «Cerrar pestaña: botón ×, clic central, Supr con la pestaña enfocada o Ctrl+W». En el navegador Chrome no llegan Ctrl+Tab ni Ctrl+W a la página: se usa la barra con ratón o teclado; en la app de escritorio funcionan.
- Dudas o cosas que no he podido hacer: pendiente de verificar en `tauri dev` (máquina del usuario): Ctrl+Tab, Ctrl+W y «Abrir con» con dos PDF.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- Verificado: lint y typecheck OK; `tab-bar.test.tsx` 15/15; `tabs.spec.ts` 7/7. El × cumple la decisión del líder (aria-hidden, tabIndex -1, title, sin aria-label), `aria-keyshortcuts="Delete"` en cada tab, roving tabindex y teclado conformes a la ficha. Rendimiento (ronda 1) y cobertura (ronda 4) tomados del Registro del programador; el tester debe confirmarlos con `tabs-performance.spec.ts` y `pnpm coverage`. Sin problemas bloqueantes.
