---
tipo: tarea
id: COM-019
titulo: Platform.importFiles - elegir varios ficheros a la vez
app: comun
estado: en-test
depende_de: [COM-018]
intentos: 0
skills: [stack-tauri, stack-typescript-react]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, comun, plataforma]
---

# COM-019 · `Platform.importFiles`: elegir varios ficheros a la vez

Plan: [[Apps/Comun/Plan|Plan de Comun]] · Lo usan: [[PDF-128-insertar-combinar-interfaz]] (combinar), [[PDF-129-pdf-desde-imagenes-interfaz]] (imágenes) · Decisión: [[ADR-0035-organizar-en-la-app]]

## Objetivo
Una operación de plataforma que abre el diálogo del sistema con selección múltiple y devuelve nombre y bytes de cada fichero, sin anotarlos en «Recientes», igual que `importFile` ([[COM-018-exportar-fichero]]) pero para varios.

## Contexto
- `packages/platform/src/types.ts` → `Platform.importFile`, `ImportedFile`.
- `packages/platform/src/web/platform-web.ts` → `importFile` (COM-018): picker con `showOpenFilePicker` y *fallback* `<input type=file>`.
- `packages/platform/src/tauri/platform-tauri.ts` → `importFile`; `packages/platform/rust/src/commands.rs` → `suite_open_dialog` (parámetro `remember` de COM-018), `remember`.
- Fakes: `apps/lector-pdf/tests/helpers/fake-platform.ts` → `createFakePlatform`.

## Qué hay que hacer
1. `types.ts`:
```ts
/**
 * Elige uno o varios ficheros (selección múltiple) y devuelve su contenido en el orden en que los da el sistema; null = cancelado.
 * Más de `maxCount` ficheros, o alguno mayor que `maxBytesEach` → err('out-of-range') sin leer ninguno. No toca recientes.
 */
importFiles(filters: readonly FileFilter[], maxBytesEach: number, maxCount: number): Promise<Result<readonly ImportedFile[] | null>>;
```
2. Web: `showOpenFilePicker({ multiple: true, types })` → `getFile()` de cada *handle*; sin el API, `<input type=file multiple accept=…>`. Comprueba tamaños y número antes de leer (`arrayBuffer()`).
3. Rust: comando nuevo `suite_open_dialog_multiple(filters, remember: Option<bool>) -> Result<Option<Vec<OpenedDto>>, String>` con `blocking_pick_files` del plugin `dialog`, sin `remember` cuando `remember == Some(false)` (reutiliza `should_remember` de COM-018). Registra los tokens como `suite_open_dialog` para poder leer y cerrar. Añade el permiso en las *capabilities* solo si hace falta un permiso nuevo del plugin (el de abrir ya está).
4. Tauri (TS): invoca el comando con `remember: false`; si alguno supera `maxBytesEach` o hay más de `maxCount` → cierra todos los tokens y `err('out-of-range')`; si no, lee cada uno con `source.read(0, size)` y cierra su token (también si falla).
5. `createFakePlatform`: `importFiles` por defecto `ok(null)`.
6. Tests en `packages/platform/tests/` como los de `importFile`, y test Rust del comando si el módulo los tiene (si no, de la función de conversión).

## Criterios de aceptación
- [ ] Web: con picker y con `<input multiple>` devuelve nombres y bytes exactos en orden; `recentFiles()` no cambia; cancelar → `ok(null)`; 3 ficheros con `maxCount: 2` → `err('out-of-range')` sin leer ninguno.
- [ ] Tauri: `suite_open_dialog_multiple` con `remember: false`; tokens cerrados en todos los casos (también con error de E/S).
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace --all-features` con código 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Elegir carpetas. Arrastrar varios ficheros a la ventana (lo hace la interfaz de cada app con `DataTransfer`).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `packages/platform/src/types.ts`, `packages/platform/src/web/platform-web.ts`, `packages/platform/src/web/web-env.ts` (nuevo `pickManyWithInput`), `packages/platform/src/tauri/platform-tauri.ts`, `packages/platform/rust/src/commands.rs` (`suite_open_dialog_multiple`, `register_all` y 2 tests), `packages/platform/tests/web/fakes.ts`, `packages/platform/tests/web/platform-web-import-many.test.ts` (nuevo), `packages/platform/tests/tauri/import-many-tauri.test.ts` (nuevo), `apps/lector-pdf/tests/helpers/fake-platform.ts` y `save-harness.ts` (`importFiles` por defecto `ok(null)`). Ficha: `estado`, `actualizado`.
- Qué he hecho: `importFiles` en la interfaz `Platform` con sus tres implementaciones (web con picker o `<input multiple>`, Tauri con el comando nuevo que devuelve el DTO existente `FileInfoDto` en lugar de un tipo `OpenedDto` nuevo, y los fakes). Comprueba número y tamaños antes de leer; cierra todos los tokens en Tauri en `finally`. Si falla el registro de una ruta, el comando Rust libera las ya registradas. Sin cambios en capabilities: el permiso de abrir del plugin cubre `blocking_pick_files`.
- Comandos ejecutados y resultado:
  - `pnpm lint`: OK.
  - `pnpm --filter @suite/platform exec vitest run`: 263 tests OK (incluye 13 nuevos).
  - `pnpm --filter @suite/platform typecheck`: OK.
  - `cargo fmt --check`: OK. `cargo clippy --workspace --all-targets --all-features -- -D warnings`: OK. `cargo test --workspace --all-features`: OK (todos los suites en verde).
  - `pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratchpad>/cov`: OK, líneas 98.31 %. Se usó otro directorio porque `pnpm coverage` lo tenía bloqueado otro proceso vitest (pid 1735) en ese momento.
  - `pnpm typecheck` (raíz): FALLA en `apps/lector-pdf` (`src/core/doc-ops/ops/index.ts`, `src/core/redact/apply.ts`, `tests/unit/redact/apply.test.ts`: `imageReplacements` y `u0`/`v0` posiblemente `undefined`). No son mis ficheros: hay cambios sin commit de otro trabajo en esos ficheros (redact). Mis cambios no introducen errores de tipos.
- Dudas o cosas que no he podido hacer: (1) Nombre del DTO: la ficha pide `OpenedDto`; he reutilizado `FileInfoDto` (mismo formato). (2) Tests de Rust de la ficha: se han añadido sobre `register_all`, no sobre el comando completo (el diálogo no es testeable sin la app). (3) No commiteo los cambios de redact de otros trabajos: el commit incluye solo los ficheros de COM-019.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- Lint y tests de `@suite/platform` (263) en verde; diff cumple los criterios (web con picker e input, comprobación previa de número y tamaños, Tauri con `remember: false` y tokens cerrados en `finally`, Rust con liberación en fallo parcial).
- El fallo de `pnpm typecheck` en `apps/lector-pdf` (redact) viene de cambios sin commit ajenos a esta ficha; no bloquea.
- (opcional) `register_all` se prueba, pero el comando completo no (el diálogo no es testeable sin app): aceptable.
