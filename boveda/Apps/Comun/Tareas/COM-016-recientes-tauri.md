---
tipo: tarea
id: COM-016
titulo: Documentos recientes en Tauri (lista guardada por Rust)
app: comun
estado: en-curso
depende_de: [COM-015]
intentos: 0
skills: [stack-tauri, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, comun, plataforma, recientes, rust]
---

# COM-016 · Documentos recientes en Tauri (lista guardada por Rust)

Plan: [[Apps/Comun/Plan|Plan de Comun]] · [[Apps/Lector PDF/Plan|Plan del Lector PDF]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · [[ADR-0008-plataforma-ficheros]]

## Objetivo
En escritorio, Rust guarda la lista de recientes (rutas que el usuario abrió por diálogo o por el sistema) en `recent.json` de la carpeta de datos de la app y permite reabrir una entrada por su id, sin que la web pueda inyectar rutas arbitrarias.

## Contexto
- Leer: `packages/platform/rust/src/files.rs` (registro de rutas por token), `rust/src/commands.rs` (`suite_open_dialog`, `suite_take_pending_opens`, `FileInfoDto`), `rust/tests/*.rs`, `packages/platform/src/tauri/platform-tauri.ts` y `tauri-api.ts`, `apps/lector-pdf/src-tauri/` (registro de comandos y `capabilities/default.json`).
- `serde_json` ya está disponible si el crate lo usa; si no, añadirlo es estándar del stack (anotar versión exacta en el Registro).

## Qué hay que hacer
1. `rust/src/recent.rs` (puro, sin Tauri): `RecentList { entries: Vec<RecentEntry> }`, `RecentEntry { id: String, path: PathBuf, name: String, size: Option<u64>, opened_at: u64 }`; `load(path) -> RecentList` (fichero ausente o corrupto → lista vacía, sin pánico), `save(path, &list) -> Result<(), FileError>` atómico (temporal + renombrar, como `files.rs`), `touch(&mut self, path, size, now)` (si la ruta existe en la lista, actualiza y la sube; si no, la añade al principio con id nuevo; máximo 20), `remove(id)`, `clear()`.
2. Comandos: `suite_recent_list() -> Vec<RecentDto>` (`available` = `path.exists()`), `suite_recent_open(id) -> Result<FileInfoDto, String>` (registra la ruta en el registro de tokens como si se hubiera elegido en el diálogo y devuelve su info; ruta inexistente → error `not-found`), `suite_recent_remove(id)`, `suite_recent_clear()`. `suite_open_dialog`, «Guardar como» y las aperturas del SO llaman a `touch` y guardan.
3. `platform-tauri.ts`: implementa `recentFiles`, `openRecent`, `removeRecent`, `clearRecents` con esos comandos (`openRecent` construye el `OpenedFile` igual que `openFile`).
4. Tests Rust (`rust/tests/recent.rs`): carga de fichero corrupto, máximo 20, `touch` sin duplicar, guardado atómico; tests TS con `mockIPC`.

## Criterios de aceptación
- [ ] `cargo fmt --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace --all-features` con código 0, con los tests nuevos.
- [ ] Rust: abrir 21 rutas distintas → 20 entradas; abrir de nuevo la 5.ª → pasa a ser la primera sin duplicar; `recent.json` con `{basura` → lista vacía y se sobrescribe bien al siguiente `touch`.
- [ ] `suite_recent_open` con un id desconocido → error; con una ruta borrada → `not-found`; con una válida → el token permite `suite_read_range`.
- [ ] TS (`mockIPC`): `openRecent` devuelve un `OpenedFile` con `path` y `canSaveInPlace: true`; `recentFiles` traduce `available`.
- [ ] No existe ningún comando que acepte una ruta escrita por la web para añadirla a recientes (revisión del código: solo `touch` desde diálogo, SO o guardar como).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz (PDF-049). Lista de saltos del SO (Windows Jump List, menú Dock).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
