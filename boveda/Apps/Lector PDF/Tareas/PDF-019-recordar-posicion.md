---
tipo: tarea
id: PDF-019
titulo: Recordar la última página, el zoom y la rotación de cada documento
app: pdf
estado: en-revision
depende_de: [PDF-012]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, preferencias]
---

# PDF-019 · Recordar última página y zoom

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
Al reabrir un PDF, el lector vuelve a la misma página (y posición dentro de ella), con el mismo modo de zoom y rotación de vista que tenía al cerrarlo, en web y escritorio. Se recuerdan los últimos 500 documentos, identificados por la huella del PDF (no por la ruta), y nada sale del ordenador.

## Contexto
- Leer: `src/core/zoom.ts`, `rotation.ts`, `src/state/viewer-store.ts`, `navigation.ts`, `view-actions.ts`, `document-actions.ts`, `src/ui/viewer/Viewer.tsx`, `packages/platform/src/prefs.ts`.
- `LoadedPdf.fingerprint` (PDF-005). Las preferencias se guardan con `platform.prefs` (clave `positions`).

## Qué hay que hacer
1. `src/core/reading-positions.ts`:
   ```ts
   export interface ReadingPosition { readonly page: number; readonly yFraction: number; readonly zoomMode: ZoomMode; readonly rotation: Rotation; readonly updatedAt: number }
   export interface PositionsState { readonly version: 1; readonly entries: readonly (readonly [string, ReadingPosition])[] } // más reciente al final
   export const MAX_POSITIONS = 500;
   export function emptyPositions(): PositionsState;
   export function isPositionsState(v: unknown): v is PositionsState; // valida estructura y tipos de cada entrada (zoomMode válido, rotación 0/90/180/270, números finitos)
   export function rememberPosition(s: PositionsState, fingerprint: string, pos: ReadingPosition): PositionsState; // mueve al final; recorta las más antiguas por encima de 500
   export function lookupPosition(s: PositionsState, fingerprint: string): ReadingPosition | null;
   ```
2. Store: `currentYFraction: number` (posición dentro de la página actual), que `Viewer` actualiza al desplazarse (solo si cambia > 0,01).
3. `src/state/position-sync.ts`: `export function startPositionSync(): () => void` (se llama una vez en `main.tsx`):
   - Se suscribe al store; con documento `ready`, cuando cambian `currentPage`, `currentYFraction`, `zoomMode` o `rotation`, guarda con *debounce* de 1 000 ms (`rememberPosition` + `prefs.set('positions', ...)` con `now = Date.now()`).
   - Guarda inmediatamente en `pagehide` y antes de cerrar o cambiar de documento (`closeDocument`/`openDocument` llaman a `flushPosition()` exportada).
   - Al pasar a `ready`: `lookupPosition`; si existe y `page < numPages` → `setZoomMode(zoomMode)`, rotación, y `goToPage(page, { yFraction })`. Si no existe, el documento empieza en la página 1 con el modo por defecto.
4. Tests: `tests/unit/reading-positions.test.ts`, `tests/unit/position-sync.test.ts` (store real, `prefs` en memoria, temporizadores falsos de Vitest), `tests/e2e/remember.spec.ts`.

## Criterios de aceptación
- [ ] (T) `rememberPosition` con 501 documentos distintos deja 500 y elimina el más antiguo; recordar uno existente lo mueve al final sin duplicarlo.
- [ ] (T) `isPositionsState` rechaza: `null`, versión 2, `rotation 45`, `page -1`, `zoomMode { kind: 'custom', zoom: 'x' }`; acepta un estado válido. Un valor corrupto en `prefs` se trata como vacío (gracias al *guard*).
- [ ] (T) Sync: cambiar de página 5 veces en 500 ms produce **una** escritura tras 1 s; `flushPosition()` escribe al momento; al abrir un documento con posición guardada en la página 42 con zoom `fit-page` y rotación 90 → `goToPage(42, ...)`, `zoomMode fit-page`, `rotation 90`.
- [ ] (T) Una posición guardada con `page 900` para un documento de 10 páginas se ignora (empieza en la 1).
- [ ] E2E: abrir `pages-5000.pdf`, ir a la página 2 345, poner zoom 150 % → recargar la página del navegador y abrir el mismo fichero → «2345» en el campo de página y «150 %» en el zoom, en < 5 s.
- [ ] E2E: abrir `basic-5.pdf` por primera vez → empieza en la página 1.
- [ ] Privacidad: solo se guarda la huella, página, fracción, zoom, rotación y fecha (sin nombre ni ruta). El revisor lo comprueba en `rememberPosition`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Lista de recientes (PDF-049). Opción para desactivarlo (se añadirá con una pantalla de preferencias).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/reading-positions.ts` (nuevo), `apps/lector-pdf/src/state/position-sync.ts` (nuevo), `apps/lector-pdf/src/state/viewer-store.ts` (campo `currentYFraction`), `apps/lector-pdf/src/state/navigation.ts` (`setCurrentYFraction`), `apps/lector-pdf/src/state/document-actions.ts` (`flushPosition` en `openDocument` y `beginReplacement`), `apps/lector-pdf/src/ui/viewer/Viewer.tsx` (reporta la fracción vertical), `apps/lector-pdf/src/main.tsx` (`startPositionSync()`), tests `apps/lector-pdf/tests/unit/reading-positions.test.ts`, `apps/lector-pdf/tests/unit/position-sync.test.ts`, `apps/lector-pdf/tests/e2e/remember.spec.ts`.
- Qué he hecho: estado de posiciones validado y acotado a 500 documentos por huella (solo página, fracción, zoom, rotación y fecha). Guardado con retraso de 1 s, escritura inmediata en `pagehide` y en cada cambio de documento; al pasar a «listo» restaura zoom, rotación y página si existe y la página cabe. Página indexada desde 0, como `currentPage`.
- Comandos ejecutados y resultado: `pnpm exec eslint --max-warnings 0` sobre los ficheros tocados: sin avisos. `pnpm exec vitest run` sobre reading-positions, position-sync y navigation: 19 tests en verde. `pnpm exec playwright test tests/e2e/remember.spec.ts`: 2 tests en verde. `pnpm test` en raíz: 1214 tests en verde, 5 ficheros de UI no cargan (`tests/ui/app`, `open`, `page-navigator`, `tauri-integration`, `zoom-controls`) por `./Thumbnails` inexistente en `src/ui/sidebar/Sidebar.tsx`. `pnpm typecheck` falla en `src/state/viewer-store.ts` (`SidebarState`) y `src/ui/toolbar/MainToolbar.tsx` (`sidebar`): trabajo en curso de PDF-015, no de esta ficha. `tests/unit/document-actions.test.ts` falla por `sidebarForOpenedDocument` no definido, mismo origen.
- Dudas o cosas que no he podido hacer: no he hecho commit porque el árbol lo comparten PDF-014 y PDF-015 (instrucción explícita). No he podido ejecutar `pnpm lint` ni `pnpm coverage` completos ni la batería de UI hasta que PDF-015 cierre su parte. Decisión tomada sin ficha: `custom` se valida dentro de [MIN_ZOOM, MAX_ZOOM] y la restauración de rotación usa `setState` directo desde `position-sync.ts`.
