---
tipo: tarea
id: PDF-019
titulo: Recordar la última página, el zoom y la rotación de cada documento
app: pdf
estado: pendiente
depende_de: [PDF-012]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
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
