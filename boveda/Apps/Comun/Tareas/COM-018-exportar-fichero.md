---
tipo: tarea
id: COM-018
titulo: Platform.exportFile e importFile - exportar e importar sin tocar recientes
app: comun
estado: en-test
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

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `packages/platform/rust/src/commands.rs` (la función auxiliar `remember` pasa a `add_to_recents`; el parámetro `remember` de `suite_open_dialog` y `suite_save_dialog` la sombreaba y no compilaba). Ficha: `estado` y `actualizado`.
- Qué he hecho: la implementación ya estaba en el repositorio (WIP de commits anteriores): `ExportOutcome`/`ImportedFile`/`exportFile`/`importFile` en `types.ts`, versiones web y Tauri, parámetro `remember: Option<bool>` en Rust, `createFakePlatform` con `lastExport`, y tests en `packages/platform/tests/web/platform-web-export.test.ts` y `tests/tauri/export-tauri.test.ts`. He verificado cada punto de la ficha contra el código y he corregido el error de compilación de Rust. No he cambiado nada más.
- Comandos ejecutados y resultado:
  - `cargo fmt --all --check`: 0.
  - `cargo clippy --workspace --all-targets --all-features -- -D warnings`: 0.
  - `cargo test --workspace --all-features`: 0 (todos los tests Rust pasan, incluido `should_remember`).
  - `pnpm lint`: 0.
  - `pnpm typecheck`: `packages/platform` OK; **falla en `apps/lector-pdf`** (fuera de alcance): `tests/ui/tab-bar.test.tsx(26)` llama a `initServices(createFakePlatform())` pero `initServices` espera `AppServices` (`platform`, `assetBaseUrl`); `tests/unit/tab-close-guard.test.ts(97,118)` llama a un `never`. Es WIP previo de lector-pdf.
  - `pnpm coverage` (con `--coverage.reportsDirectory` propio porque otro proceso de vitest tenía el directorio de cobertura bloqueado): exit 1 solo por 2 tests de `apps/lector-pdf`: `tests/ui/comment-toolbar.test.tsx` (barra «Comentar») y `tests/ui/sidebar.test.tsx` (panel lateral, rol `complementary`). Ambos fallan en HEAD por WIP ajeno a esta ficha. `packages/platform`: 24 ficheros, 250 tests, todos pasan.
- Dudas o cosas que no he podido hacer:
  - El typecheck de `apps/lector-pdf` y los 2 tests de UI de lector-pdf no pasan. Son ajenos a COM-018 y no los he tocado porque están fuera de alcance; el líder debe asignarlos a la ficha del lector PDF correspondiente. Hasta entonces el criterio «pnpm typecheck y pnpm coverage con código 0» no se cumple en el monorepo completo.
  - Hay otro proceso de vitest con cobertura en el mismo directorio (pid 14113 al ejecutarse); no lo he detenido.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Revisado `types.ts`, `platform-web.ts` (exportFile/importFile), `platform-tauri.ts` (exportFile/importFile), Rust y fake. Cumple los criterios: sin `remember`, token cerrado en `finally`, `out-of-range` antes de leer, cancelar correcto.
- Comprobado: `pnpm lint` 0; tsc de `packages/platform` OK; vitest de `packages/platform` 250/250; `cargo test` y `clippy -D warnings` OK.
- Nota para el tester/líder: el typecheck y 2 tests de UI de `apps/lector-pdf` fallan por WIP ajeno (ver registro del programador); no atribuible a COM-018.
