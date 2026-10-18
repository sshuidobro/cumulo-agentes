---
tipo: tarea
id: COM-017
titulo: Pantalla completa en @suite/platform
app: comun
estado: en-revision
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: ninguno de código. La implementación ya estaba en el repositorio desde el commit `c047858` (trabajo en curso de la iteración 3, no desde cero como indica la ficha): `packages/platform/src/types.ts`, `src/web/platform-web.ts`, `src/tauri/platform-tauri.ts`, `src/tauri/tauri-api.ts`, `apps/lector-pdf/src-tauri/capabilities/default.json`, `apps/lector-pdf/tests/helpers/fake-platform.ts`, `packages/platform/tests/web/fullscreen-web.test.ts`, `packages/platform/tests/tauri/fullscreen-tauri.test.ts`. Solo se ha actualizado esta ficha.
- Qué he hecho: he verificado cada punto de «Qué hay que hacer» y cada criterio contra el código existente. Los criterios 1 a 4 se cumplen: los 64 tests de plataforma (web y Tauri) pasan y `cargo check --workspace --all-features` termina con código 0. No he modificado código porque ya cumplía lo pedido.
- Comandos ejecutados y resultado: `npx vitest run` en `packages/platform` con `tests/web/fullscreen-web.test.ts` y `tests/tauri`: 8 ficheros y 64 tests OK. `cargo check --workspace --all-features`: OK. `pnpm typecheck`: OK. `pnpm lint`: FALLA, con 9622 errores que solo están en `apps/lector-pdf/dist-firma/` (salida de build minificada versionada en git, sin estar en `ignores` de `eslint.config.*`; no es de esta ficha). `pnpm coverage`: FALLA por un test ajeno, `apps/lector-pdf/tests/ui/zoom-controls.test.tsx` («el campo, la lista y los botones son alcanzables con Tab»); el resto pasa (2334 de 2335). El criterio de lint y de coverage no se cumple por causas fuera de COM-017.
- Dudas o cosas que no he podido hacer: (1) ¿Quién añade `dist-firma/` al `ignores` de ESLint, o se saca del repositorio? Es decisión del líder y no la he tomado. (2) El fallo de `zoom-controls` podría venir del trabajo sin commit de otros agentes en `messages-forms.ts`; no lo he investigado. (3) Si el líder quiere que esta ficha vuelva a implementarse desde cero, hay que aclararlo porque el código ya existe.
