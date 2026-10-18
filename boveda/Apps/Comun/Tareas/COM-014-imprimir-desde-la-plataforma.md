---
tipo: tarea
id: COM-014
titulo: Platform.print() - imprimir la ventana en web y en Tauri
app: comun
estado: pendiente
depende_de: []
intentos: 0
skills: [stack-tauri, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, comun, plataforma, impresion]
---

# COM-014 · Platform.print(): imprimir la ventana en web y en Tauri

Plan: [[Apps/Comun/Plan|Plan de Comun]] · [[Apps/Lector PDF/Plan|Plan del Lector PDF]] (iteración 3) · Decisiones: [[ADR-0021-impresion]] · [[ADR-0008-plataforma-ficheros]]

## Objetivo
Una sola llamada para abrir el diálogo de impresión del sistema con el contenido de impresión de la página, que funcione en el navegador y en el webview de Tauri (donde `window.print()` no siempre abre el diálogo, p. ej. en macOS).

## Contexto
- Leer: `packages/platform/src/types.ts`, `src/web/platform-web.ts`, `src/tauri/platform-tauri.ts`, `src/tauri/tauri-api.ts`, `packages/platform/rust/src/commands.rs`, `apps/lector-pdf/src-tauri/src/` (registro de comandos) y `capabilities/default.json`, tests de `packages/platform/tests/tauri/`.
- Tauri 2.12: `WebviewWindow::print()` en Rust abre el diálogo de impresión nativo del webview.

## Qué hay que hacer
1. `types.ts`: `Platform` gana `print(): Promise<Result<void>>` (resuelve cuando el diálogo se ha abierto; en web, cuando `window.print()` vuelve).
2. Web: `print()` llama a `window.print()` (inyectable en `WebEnv` para tests) y devuelve `ok`.
3. Rust: comando `suite_print(window: tauri::WebviewWindow) -> Result<(), String>` que llama a `window.print()` con el error traducido a texto; registrarlo junto a los demás comandos `suite_*`; `cargo fmt`, `clippy -D warnings` y `cargo test` en verde.
4. Tauri TS: `print()` invoca `suite_print`; error → `err(platformError('io', cause))`.
5. Tests: web (mock de `print`), Tauri con `mockIPC` (se invoca `suite_print`; error → `err`).

## Criterios de aceptación
- [ ] `pnpm --filter @suite/platform test` (o el filtro de vitest del paquete) en verde con los tests nuevos: web llama una vez a `window.print`; Tauri invoca `suite_print` y traduce el error.
- [ ] `cargo fmt --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace --all-features` con código 0.
- [ ] La `FakePlatform` de pruebas de la app (`apps/lector-pdf/tests/helpers/fake-platform.ts`) implementa `print` (registra las llamadas).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Qué se imprime (PDF-044). Imprimir sin diálogo o elegir impresora desde la app.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
