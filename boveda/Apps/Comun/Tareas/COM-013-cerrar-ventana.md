---
tipo: tarea
id: COM-013
titulo: Añadir Platform.closeWindow() para cerrar tras confirmar cambios sin guardar
app: comun
estado: en-test
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

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/platform/src/types.ts`, `src/web/web-env.ts` (campo `closeWindow`, por defecto `window.close()`), `src/web/platform-web.ts` (bandera `closing`; `beforeunload` no cancela tras `closeWindow`), `src/tauri/tauri-api.ts` (`destroyWindow`), `src/tauri/platform-tauri.ts` (`closeWindow` con log `error` si rechaza), `tests/web/fakes.ts`, `tests/web/web-env.test.ts`, `tests/web/platform-web-open.test.ts`, `tests/tauri/platform-tauri.test.ts`, `apps/lector-pdf/tests/helpers/fake-platform.ts` (stub `closeWindow`, necesario para que compile el typecheck de la app).
- Qué he hecho: añadido `Platform.closeWindow()` en web y Tauri según la ficha. Tests nuevos: beforeunload no cancelado tras `closeWindow` (web), `destroyWindow` llamado una vez, rechazo resuelto y registrado (Tauri), `defaultWebEnv().closeWindow` llama a `window.close`. Los dobles de `TauriApi` y `WebEnv` de los tests se actualizan con el nuevo miembro.
- Comandos ejecutados y resultado: `pnpm lint` 0 · `pnpm typecheck` 0 (platform y lector-pdf) · `pnpm test` 60 ficheros, 778 tests en verde · `pnpm coverage` 0 (cobertura de `packages/platform/src`: 97,9 % de líneas en la carpeta raíz; web 98 %, tauri 87,7 %). La primera ejecución de `pnpm coverage` falló porque otro proceso Vitest (agentes en paralelo) usaba `coverage/`; se repitió con `--coverage.reportsDirectory` en el scratchpad.
- Dudas o cosas que no he podido hacer: (1) La ficha dice que `core:window:allow-destroy` "ya está en las apps", pero no existe `capabilities/` en `apps/lector-pdf` (PDF-021 pendiente). Ese permiso debe estar en PDF-021, que ya lo lista. Sin él, `destroy()` falla en Tauri y `closeWindow` solo registra el error. (2) `packages/platform/tests/tauri/qa-edge-tauri.test.ts` es un fichero sin commitear de otro agente; he añadido `destroyWindow` a su doble de `TauriApi` (sin ello no compila) pero no lo he commiteado. (3) No se ha probado en navegador real: `window.close()` solo funciona en pestañas abiertas por script.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Comprobado: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 62 ficheros / 830 tests en verde, `pnpm coverage` 0 (una primera ejecución falló, probablemente por colisión con otros Vitest en paralelo; repetida dos veces con exit 0). Cada criterio tiene test que falla si se rompe; el diff no se sale del alcance; el stub en `fake-platform.ts` es necesario para compilar.
1. `packages/platform/src/web/platform-web.ts:268` (opcional) — si `window.close()` es ignorado (pestaña no abierta por script), `closing` queda en `true` para siempre y se pierde el aviso de `beforeunload` en cambios posteriores (riesgo de pérdida de datos). Restablecer la bandera tras un breve retardo si la página sigue viva, con test. No bloquea porque la ficha prescribe este diseño; el líder puede abrir una ficha de seguimiento.
2. `core:window:allow-destroy` sigue pendiente en PDF-021 (ya anotado por el programador); sin él `closeWindow` solo registra el error.
