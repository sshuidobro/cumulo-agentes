---
tipo: tarea
id: PDF-100
titulo: Pestañas - historial, búsqueda, posición y panel lateral por documento
app: pdf
estado: en-revision
depende_de: [PDF-094]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, estado, pestanas]
---

# PDF-100 · Pestañas: historial, búsqueda, posición y panel lateral por documento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · Base: [[PDF-094-sesiones-de-documento]]

## Objetivo
Al volver a una pestaña, «Atrás/Adelante», la búsqueda abierta y la pestaña del panel lateral son las que el usuario dejó en ese documento, y el cambio de pestaña no borra el historial, ni cierra la búsqueda, ni mueve la posición recordada.

## Contexto
- Leer: `src/state/tabs.ts` (`registerTabParticipant`, `isSwitchingTab`), `src/state/history.ts` (pilas y suscripción que llama a `clearHistory`), `src/state/search-actions.ts` (`activeSession`, `debounceTimer`, `cancelSearch`, suscripción que llama a `closeSearch`), `src/state/search-store.ts`, `src/state/position-sync.ts` (suscripción de `startPositionSync`), `src/state/sidebar-actions.ts` (`lastTab`), `src/state/view-actions.ts` (rueda pendiente).
- No tocar `document-actions.ts` ni los módulos de anotaciones (PDF-101 trabaja en paralelo con ellos).

## Qué hay que hacer
1. `history.ts`: participante `history` (orden 30), instantánea `{ back: readonly ViewPosition[]; forward: readonly ViewPosition[] }`; `suspend` devuelve las pilas y las vacía (`syncFlags()`); `resume` las restaura (`syncFlags()`); `dispose` no hace nada. La suscripción que llama a `clearHistory()` no actúa si `isSwitchingTab()`.
2. `search-actions.ts`: participante `search` (orden 30), instantánea `{ open: boolean; query: string; options: SearchOptions }` (los campos de `useSearch` con esos nombres; ver `search-store.ts`). `suspend`: `cancelSearch()`, limpia `debounceTimer`, guarda la instantánea y deja `useSearch` en `initialSearchState`. `resume`: si `open`, `openSearch()`, restaura opciones y llama a `setQuery(query)` (la búsqueda se repite; el resultado actual es el que dé una búsqueda nueva desde la página actual). La suscripción que llama a `closeSearch()` no actúa si `isSwitchingTab()`.
3. `position-sync.ts`: la suscripción de `startPositionSync` no hace nada mientras `isSwitchingTab()` (ni restaura la posición recordada ni programa guardado). Sin participante (el `flushPosition` ya lo hace el participante `document`).
4. `sidebar-actions.ts`: participante `sidebar` (orden 30), instantánea `{ lastTab: SidebarTab }` (el estado visible del panel ya va en `useViewer`).
5. `view-actions.ts`: participante `view` (orden 30) sin estado (`undefined`): `suspend` cancela el `requestAnimationFrame` de la rueda pendiente y vacía `pendingSteps`.
6. Tests en `tests/unit/tabs-modules.test.ts` usando `activateTab` real con dos documentos de `FakePlatform` (como `document-tabs.test.ts` de PDF-094).

## Criterios de aceptación
- [ ] Doc A: seguir 2 enlaces internos (historial con 2 atrás); abrir B; en B, `canGoBack()` es `false`; volver a A → `canGoBack()` `true` y `goBack()` lleva a la posición anterior al 2.º enlace.
- [ ] Doc A con búsqueda abierta «lorem» y «Coincidir mayúsculas» activado; abrir B → barra de búsqueda cerrada y `useSearch.query === ''`; volver a A → barra abierta, «lorem», la opción activada y el contador con el mismo total que antes de cambiar.
- [ ] Una búsqueda en curso en A (fixture grande de `tests/fixtures`, 200+ páginas) al cambiar a B: su `AbortSignal` queda abortado y no llega ningún resultado de A al store mientras B está activa (espía de `useSearch.setState`).
- [ ] Cambiar de pestaña 10 veces seguidas no escribe `positions` en preferencias más de una vez por pestaña suspendida (espía), y nunca con la posición de la otra pestaña (la entrada de A conserva la página de A).
- [ ] Panel lateral: A con «Índice», B con «Miniaturas»; alternar → cada documento conserva el suyo y `toggleSidebar` (F4) reabre la última pestaña de cada documento.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Anotaciones, formularios y borradores (PDF-101). Interfaz (PDF-095).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/state/history.ts`, `search-actions.ts`, `position-sync.ts`, `sidebar-actions.ts`, `view-actions.ts`, `apps/lector-pdf/src/main.tsx` (registro de los 4 participantes nuevos), `apps/lector-pdf/tests/unit/tabs-modules.test.ts` (nuevo).
- Qué he hecho: participantes `history`, `search`, `sidebar` y `view` (orden 30), cada uno con `registerXParticipant()` llamado desde `main.tsx` como `registerDocumentParticipant`. Las suscripciones de historial y búsqueda no actúan si `isSwitchingTab()`; la de posición tampoco. En `search` la suspensión incrementa el `token` antes de cancelar, para que el `onDone` cancelado no publique nada en el store. Las opciones de búsqueda se restauran siempre (también con la barra cerrada), porque `closeSearch` ya las conserva. `sidebar` vuelve a «miniaturas» al suspender, según el contrato de `TabParticipant` (sin documento).
- Comandos ejecutados y resultado: `pnpm exec vitest run tests/unit/tabs-modules.test.ts` → 6/6 OK. `pnpm lint` → código 0 (tras quitar una variable sin uso en el test). `pnpm coverage` → código 0, cobertura global 96,56 % líneas 98,77 %. `pnpm typecheck` no está limpio por ficheros de anotaciones de otros programadores (`src/core/annotations/*`, `src/ui/viewer/AnnotationLayer.tsx`, `annotation-shapes.tsx`, `tests/unit/annotations/*`, `tests/support/standard-annotations.ts`); no hay ningún error en los ficheros tocados por esta ficha.
- Dudas o cosas que no he podido hacer: (1) el criterio cita «lorem», pero no hay fixture con esa palabra; he usado «marcador» sobre `basic-5.pdf` (5 coincidencias, con «Coincidir mayúsculas» activado). (2) El criterio de 200+ páginas usa `images-200.pdf`. (3) La prueba del criterio de búsqueda sustituye el backend (`setSearchBackend`) por uno que se queda parado en la página 3, para poder observar la señal abortada. (4) No he hecho commit, como se pidió.
