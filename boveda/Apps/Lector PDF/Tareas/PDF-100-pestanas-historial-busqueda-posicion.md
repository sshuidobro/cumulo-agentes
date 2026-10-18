---
tipo: tarea
id: PDF-100
titulo: Pestañas - historial, búsqueda, posición y panel lateral por documento
app: pdf
estado: pendiente
depende_de: [PDF-094]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
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
