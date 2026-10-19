---
tipo: tarea
id: COM-018
titulo: Platform.exportFile e importFile - exportar e importar sin tocar recientes
app: comun
estado: pendiente
depende_de: [COM-017]
intentos: 0
skills: [stack-tauri, stack-typescript-react]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, comun, plataforma]
---

# COM-018 · `Platform.exportFile` e `importFile`: exportar e importar sin tocar recientes

Plan: [[Apps/Comun/Plan|Plan de Comun]] (iteración 4) · Lo usan: [[PDF-111-xfdf-interfaz]], [[PDF-113-exportar-interfaz]]

## Objetivo
Dos operaciones de plataforma: guardar ficheros exportados (PNG, JPEG, ZIP, TXT, XFDF) y leer un fichero auxiliar pequeño (XFDF), con los diálogos del sistema, sin anotarlos en «Recientes» ni dejarlos registrados como documento abierto. Hoy `saveAs` y `openFile` hacen las dos cosas (web: `remember`; Tauri: `suite_save_dialog` y `suite_open_dialog` llaman a `remember`).

## Contexto
- `packages/platform/src/types.ts` → `Platform`, `FileFilter`, `SaveOutcome`.
- `packages/platform/src/web/platform-web.ts` → `saveAs` (líneas ~213-233), `writeTo`, `contentParts`, `env.download`.
- `packages/platform/src/tauri/platform-tauri.ts` → `saveAs` (líneas ~196-207), `save`, `closeFile`.
- `packages/platform/rust/src/commands.rs` → `suite_open_dialog` (líneas ~226-243), `suite_save_dialog` (líneas ~245-262), `remember`.
- `packages/platform/src/web/platform-web.ts` → `openFile`/`openHandle` (lectura con picker o `<input type=file>`).
- Fakes que implementan `Platform`: `apps/lector-pdf/tests/helpers/fake-platform.ts` → `createFakePlatform` (y cualquier otro que encuentre `pnpm typecheck`).

## Qué hay que hacer
1. `types.ts` → `Platform`:
```ts
export type ExportOutcome = 'saved' | 'downloaded' | 'cancelled';
/** Guarda `bytes` con el diálogo de guardar. No lo anota en recientes ni lo deja abierto. */
exportFile(suggestedName: string, filters: readonly FileFilter[], bytes: Uint8Array): Promise<Result<ExportOutcome>>;
export interface ImportedFile { readonly name: string; readonly bytes: Uint8Array }
/** Elige un fichero con el diálogo de abrir y devuelve su contenido completo; null = cancelado. Más de `maxBytes` → err('out-of-range') sin leerlo. No lo anota en recientes ni lo deja abierto. */
importFile(filters: readonly FileFilter[], maxBytes: number): Promise<Result<ImportedFile | null>>;
```
   Exporta `ExportOutcome` e `ImportedFile` desde `index.ts`.
2. Web: con `showSaveFilePicker` → `writeTo(handle, { kind: 'bytes', bytes })` **sin** `remember` → `'saved'`; `AbortError` → `'cancelled'`; sin el API → `env.download(new Blob([bytes]), name)` → `'downloaded'`.
   Web `importFile`: con `showOpenFilePicker` → `getFile()` sin `remember`; sin el API → `<input type=file>` como `openFile`; comprueba `file.size > maxBytes` antes de `arrayBuffer()`.
3. Rust: `suite_save_dialog` y `suite_open_dialog` ganan el parámetro `remember: Option<bool>` (`None` = `true`, compatible); con `false` no llaman a `remember`. Test Rust del caso `false` si el módulo tiene tests del comando; si no, test de la función que decide (extrae `fn should_remember(flag: Option<bool>) -> bool`).
4. Tauri (TS): `exportFile` invoca `suite_save_dialog` con `{ suggestedName, filters, remember: false }`; `null` → `'cancelled'`; si no, `save(toOpened(api, dto), { kind: 'bytes', bytes })` y después `closeFile` del token (aunque falle el guardado) → `'saved'`.
   Tauri `importFile`: `suite_open_dialog` con `remember: false`; si `dto.size > maxBytes` → `closeFile` y `err('out-of-range')`; si no, lee con `source.read(0, size)`, cierra el token (también si falla) y devuelve `{ name, bytes }`.
5. `createFakePlatform`: `exportFile` por defecto devuelve `ok('saved')` y guarda la última llamada en una propiedad espiable (`lastExport`); `importFile` por defecto devuelve `ok(null)` (los tests lo sustituyen con `overrides`).
6. Tests en `packages/platform/tests/` siguiendo los de `saveAs` (web con `WebEnv` falso; Tauri con `@tauri-apps/api/mocks` o el `TauriApi` falso existente).

## Criterios de aceptación
- [ ] Web: `exportFile` con picker escribe los bytes exactos y `recentFiles()` no cambia; sin picker llama a `download` con el nombre sugerido; cancelar → `ok('cancelled')`.
- [ ] Tauri: se invoca `suite_save_dialog` con `remember: false`, luego el guardado y `suite_close`; cancelar → `ok('cancelled')`; error de E/S → `err` con el código mapeado y el token cerrado igualmente.
- [ ] Web y Tauri: `importFile` devuelve nombre y bytes exactos, no cambia `recentFiles()`, cierra el token en Tauri; un fichero mayor que `maxBytes` → `err('out-of-range')` sin leerlo; cancelar → `ok(null)`.
- [ ] `saveAs` y `openFile` siguen anotando en recientes (tests actuales sin cambios).
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace --all-features` con código 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Guardar varios ficheros en una carpeta (las exportaciones múltiples van en un ZIP, [[ADR-0032-exportar-imagenes-y-texto]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
