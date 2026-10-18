---
tipo: tarea
id: COM-014
titulo: Platform.print() - imprimir la ventana en web y en Tauri
app: comun
estado: en-revision
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `packages/platform/src/types.ts`, `packages/platform/src/web/web-env.ts`, `packages/platform/src/web/platform-web.ts`, `packages/platform/src/tauri/platform-tauri.ts`, `packages/platform/rust/src/commands.rs`, `packages/platform/tests/web/fakes.ts`, `packages/platform/tests/web/platform-web-print.test.ts` (nuevo), `packages/platform/tests/tauri/print.test.ts` (nuevo), `apps/lector-pdf/tests/helpers/fake-platform.ts`, `apps/lector-pdf/tests/helpers/save-harness.ts` (este último, no listado en la ficha, porque construye su propio `Platform` y el typecheck falla sin `print`).
- Qué he hecho: `Platform.print()` añadido a la interfaz. Web: `WebEnv.print` (por defecto `window.print()`), `print()` lo llama una vez y devuelve `ok`; si lanza, devuelve `err('io')` (decisión menor: la ficha no lo decía y así el `Result` cumple su contrato). Tauri: `print()` invoca `suite_print` y un rechazo se traduce a `err('io')`. Rust: `suite_print<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), String>` (genérico porque `WebviewWindow` lo exige), registrado en `handler()`. No hace falta tocar `capabilities/default.json`: el comando se ejecuta en Rust y la app no define manifiesto de comandos.
- Comandos ejecutados y resultado:
  - `pnpm lint`: 0 (sin avisos).
  - `pnpm typecheck`: 0.
  - `cargo fmt --check`: 0 (tras `cargo fmt`, que solo cambió `commands.rs`).
  - `cargo clippy --workspace --all-targets --all-features -- -D warnings`: 0.
  - `cargo test --workspace --all-features`: 0 (36 tests en total).
  - `pnpm --filter @suite/platform` (vitest del paquete): 203 tests en verde, antes de los últimos retoques.
  - `pnpm test`: una pasada dio 1 timeout de 5 s en `apps/lector-pdf/tests/unit/pdf/filters.test.ts`, que pasa aislado (18/18). Otra pasada de cobertura dio 2 timeouts en `annotations/commands.test.ts` y `pdf/fuzz-roundtrip.test.ts`, que pasan aislados (24/24). Son fallos de carga: varios Vitest de otros agentes corrían a la vez.
  - `pnpm coverage` con `--coverage.reportsDirectory` propio en el scratchpad: 0. 160 ficheros, 1831 tests en verde, 97,18 % de líneas. El `pnpm coverage` literal falló (código 1) porque otro proceso de Vitest (pid 4676) tenía bloqueado `coverage/`; no lo he matado.
- Dudas o cosas que no he podido hacer: no he hecho ningún test Rust nuevo porque `window.print()` necesita un runtime de Tauri; la comprobación del diálogo nativo queda para la máquina del usuario, como indica ADR-0021. La ficha pide `Result<(), String>` mientras que los demás comandos devuelven `CommandError {code, message}`; he seguido la ficha y la skill `stack-tauri`, y el error llega a JS como cadena, que `platform-tauri` traduce a `io`.
