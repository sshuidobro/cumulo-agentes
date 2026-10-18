---
tipo: tarea
id: COM-017
titulo: Pantalla completa en @suite/platform
app: comun
estado: en-curso
depende_de: [COM-016]
intentos: 0
skills: [stack-tauri, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, comun, plataforma]
---

# COM-017 · Pantalla completa en @suite/platform

Plan: [[Apps/Comun/Plan|Plan de Comun]] · [[Apps/Lector PDF/Plan|Plan del Lector PDF]] (iteración 4) · Decisiones: [[ADR-0024-modos-de-pagina]]

## Objetivo
Las apps pueden poner la ventana a pantalla completa y enterarse cuando sale (Esc del sistema, F11, gesto del SO), igual en web y en escritorio.

## Contexto
- Leer: `packages/platform/src/types.ts` (`Platform`), `src/web/platform-web.ts` y `src/web/web-env.ts` (inyección de `window`/`document` para tests), `src/tauri/tauri-api.ts` y `platform-tauri.ts` (`getCurrentWindow()`), `tests/web/fakes.ts`, `tests/tauri/*` (uso de `mockIPC`/api falsa), `apps/lector-pdf/src-tauri/capabilities/default.json`.

## Qué hay que hacer
1. `types.ts`, en `Platform`:
```ts
/** Pone o quita la pantalla completa. err('unsupported') si el entorno no lo permite. */
setFullscreen(on: boolean): Promise<Result<void>>;
isFullscreen(): boolean;
/** Avisa cuando cambia (también si lo cambia el usuario o el SO). Devuelve la baja. */
onFullscreenChange(cb: (on: boolean) => void): () => void;
```
2. Web: `document.documentElement.requestFullscreen({ navigationUI: 'hide' })` / `document.exitFullscreen()`; sin `requestFullscreen` o si rechaza → `err(platformError('unsupported', causa))`; `isFullscreen` = `document.fullscreenElement !== null`; `onFullscreenChange` con el evento `fullscreenchange`.
3. Tauri: `tauri-api.ts` añade `setFullscreen(on)`, `isFullscreen()` y `onResized(cb)` de `getCurrentWindow()`; `platform-tauri.ts` guarda el último estado (`isFullscreen` síncrono), lo refresca en cada `onResized` con `await isFullscreen()` y avisa a los suscriptores solo si cambia. Errores → `err(platformError('io', causa))`.
4. `apps/lector-pdf/src-tauri/capabilities/default.json`: permisos `core:window:allow-set-fullscreen` y `core:window:allow-is-fullscreen`.
5. `apps/lector-pdf/tests/helpers/fake-platform.ts`: implementa los tres métodos en memoria (`setFullscreen` cambia el estado y avisa).
6. Tests: web con `document` falso (`requestFullscreen` que resuelve, que rechaza y ausente), Tauri con la api falsa.

## Criterios de aceptación
- [ ] Web: `setFullscreen(true)` llama a `requestFullscreen` y devuelve `ok`; si rechaza → `err` `unsupported`; sin la API → `err` `unsupported` sin lanzar.
- [ ] Web: un evento `fullscreenchange` con `fullscreenElement` → el callback recibe `true`; tras la baja ya no se llama.
- [ ] Tauri: `setFullscreen(true)` llama a `window.setFullscreen(true)`; un `onResized` que pasa `isFullscreen` de `false` a `true` avisa una vez; dos `onResized` sin cambio no avisan.
- [ ] La capacidad incluye los dos permisos y `cargo check --workspace --all-features` con código 0 (el `build.rs` de Tauri valida los identificadores de permiso).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- La interfaz de pantalla completa del Lector (PDF-097).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
