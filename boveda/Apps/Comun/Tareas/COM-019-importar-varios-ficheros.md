---
tipo: tarea
id: COM-019
titulo: Platform.importFiles - elegir varios ficheros a la vez
app: comun
estado: pendiente
depende_de: [COM-018]
intentos: 0
skills: [stack-tauri, stack-typescript-react]
creado: 2026-10-19
actualizado: 2026-10-19
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
