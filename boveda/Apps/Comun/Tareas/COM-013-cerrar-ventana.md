---
tipo: tarea
id: COM-013
titulo: Añadir Platform.closeWindow() para cerrar tras confirmar cambios sin guardar
app: comun
estado: pendiente
depende_de: [COM-007, COM-010]
intentos: 0
skills: [stack-typescript-react, stack-tauri, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform]
---

# COM-013 · `Platform.closeWindow()`

Plan: [[Apps/Comun/Plan|Plan de Comun]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
Cuando la app cancela el cierre de la ventana para preguntar «¿Guardar los cambios?», necesita poder cerrar la ventana después, cuando el usuario elige «Guardar» o «No guardar», sin que `onCloseRequested` vuelva a cancelarlo.

## Contexto
- Leer: `packages/platform/src/types.ts` (`Platform`), `src/web/platform-web.ts` (`onCloseRequested` con `beforeunload`), `src/tauri/tauri-api.ts`, `src/tauri/platform-tauri.ts`.
- En Tauri la capacidad `core:window:allow-destroy` ya está en las apps (p. ej. [[PDF-021-app-tauri]]). `destroy()` cierra **sin** emitir `close-requested`.
- En el navegador, `beforeunload` solo permite el aviso nativo; no se puede mostrar un diálogo propio. Por eso en web `closeWindow` hace lo posible.

## Qué hay que hacer
1. `types.ts`: añade a `Platform` `/** Cierra la ventana sin volver a llamar a onCloseRequested. */ closeWindow(): Promise<void>;`.
2. Web: `closeWindow` marca una bandera interna `closing = true` (el oyente de `beforeunload` no previene si está activa) y llama a `env.closeWindow()` (nuevo campo de `WebEnv`, por defecto `() => window.close()`).
3. Tauri: `TauriApi` añade `destroyWindow(): Promise<void>` (`getCurrentWindow().destroy()`); `closeWindow` → `api.destroyWindow()`; si rechaza, `createLogger('platform').error` y no lanza.
4. Tests en los ficheros de test web y tauri existentes.

## Criterios de aceptación
- [ ] (T) Web: con `onCloseRequested(() => false)`, tras `closeWindow()` un `beforeunload` cancelable **no** queda `defaultPrevented`, y el `closeWindow` falso de `WebEnv` se llamó una vez.
- [ ] (T) Tauri: `closeWindow()` llama a `destroyWindow` del `TauriApi` falso; si rechaza, la promesa resuelve igualmente.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- El diálogo de confirmación (lo hace cada app, p. ej. [[PDF-037-guardar-anotaciones]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
