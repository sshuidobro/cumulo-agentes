---
tipo: tarea
id: COM-009
titulo: Añadir los comandos Tauri de suite-platform (feature tauri)
app: comun
estado: hecha
depende_de: [COM-008]
intentos: 0
skills: [stack-tauri, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform, rust, tauri]
---

# COM-009 · Comandos Tauri de `suite-platform`

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
Con `--features tauri`, el crate exporta los comandos `suite_*` que usa `platform-tauri.ts` (COM-010): diálogos de abrir/guardar en Rust, lectura por rangos, escritura atómica con cuerpo binario, ficheros abiertos desde el SO. Compila con `cargo check`/`clippy` y la parte pura se prueba con `cargo test`.

## Contexto
- Leer: `packages/platform/rust/src/files.rs`, [[ADR-0008-plataforma-ficheros]], [[COM-010-platform-tauri]] (el contrato JS↔Rust de abajo debe coincidir exactamente).
- **Requisito del sistema** (una vez): `apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev` (necesario para compilar cualquier crate que dependa de `tauri` en Linux). Anota en el Registro si ya estaba instalado.
- API Tauri 2: `tauri::ipc::Request` (`body()` → `InvokeBody::Raw(Vec<u8>)`, `headers()`), `tauri::ipc::Response::new(Vec<u8>)` (JS recibe `ArrayBuffer`), `tauri_plugin_dialog::DialogExt` (`app.dialog().file().add_filter(..).set_file_name(..).blocking_pick_file()` / `blocking_save_file()`; devuelven `Option<FilePath>`; `FilePath::into_path()`), `Emitter::emit`.

## Qué hay que hacer
1. `Cargo.toml` del crate: dependencias opcionales exactas y *feature*:
   ```toml
   [features]
   default = []
   tauri = ["dep:tauri", "dep:tauri-plugin-dialog", "dep:serde"]

   [dependencies]
   tauri = { version = "=2.12.4", optional = true }
   tauri-plugin-dialog = { version = "=2.8.3", optional = true }
   serde = { version = "=1.0.229", features = ["derive"], optional = true }
   ```
2. `src/args.rs` (sin *feature*, puro): `pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf>` — ignora `args[0]` y los que empiezan por `-`; relativos se resuelven contra `cwd`; solo conserva los que son ficheros existentes.
3. `src/commands.rs` con `#[cfg(feature = "tauri")]` (declarado así en `lib.rs`):
   ```rust
   #[derive(Default)]
   pub struct SuitePlatformState { pub registry: FileRegistry, pub pending: Mutex<Vec<FileInfo>> }

   #[derive(Serialize)] #[serde(rename_all = "camelCase")]
   pub struct FileInfoDto { pub token: String, pub name: String, pub path: String, pub size: u64, pub last_modified: Option<u64> }
   impl From<FileInfo> for FileInfoDto

   #[derive(Deserialize)]
   pub struct FileFilterDto { pub name: String, pub extensions: Vec<String> }

   #[derive(Serialize, Debug)]
   pub struct CommandError { pub code: String, pub message: String }
   impl From<FileError> for CommandError // code = e.code(), message = e.to_string()

   pub const OS_OPEN_EVENT: &str = "suite://file-opened";
   ```
   Comandos (`#[tauri::command]`, todos devuelven `Result<_, CommandError>` salvo los indicados):
   | Comando | Parámetros JS | Devuelve |
   |---|---|---|
   | `suite_open_dialog` (async) | `{ filters: FileFilterDto[] }` | `FileInfoDto \| null` (registra la ruta) |
   | `suite_save_dialog` (async) | `{ suggestedName: string, filters }` | `FileInfoDto \| null` (registra; si no existe: `size 0`, `lastModified null`) |
   | `suite_read_range` (async) | `{ token, offset: u64, length: u64 }` | `Response` binaria |
   | `suite_file_info` (async) | `{ token }` | `FileInfoDto` |
   | `suite_write_atomic` (async) | cuerpo binario; cabecera `x-suite-token` | `FileInfoDto` del destino tras escribir |
   | `suite_append_atomic` (async) | cuerpo binario = delta; cabeceras `x-suite-token` (destino), `x-suite-base-token`, `x-suite-expected-size` | `FileInfoDto` del destino |
   | `suite_close` | `{ token }` | `bool` (sin `Result`) |
   | `suite_take_pending_opens` | `{}` | `Vec<FileInfoDto>` (vacía la cola; sin `Result`) |
   Cabecera ausente o inválida, o cuerpo no binario → `CommandError { code: "bad-request", message: "Petición no válida." }`.
   Además: `pub fn register_os_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>)` — registra cada ruta, añade su `FileInfo` a `pending` y emite `OS_OPEN_EVENT` con carga `()`; y `pub fn handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static` que devuelve `tauri::generate_handler![...]` con los 8 comandos (la app lo pasa a `invoke_handler`).
4. Tests: `tests/args.rs` (sin *feature*) y, en `commands.rs`, `#[cfg(test)]` para `From<FileError> for CommandError` y `From<FileInfo> for FileInfoDto` (se ejecutan con `--features tauri`).

## Criterios de aceptación
- [x] (T) `paths_from_args(["app", "-v", "a.pdf", "/abs/b.pdf", "noexiste.pdf"], cwd)` con `a.pdf` y `/abs/b.pdf` creados en un temporal → solo esos dos, `a.pdf` resuelto contra `cwd`.
- [x] (T) `CommandError::from(FileError::ChangedOnDisk{..})` → `code "changed-on-disk"` y el mensaje en español; `FileInfoDto` serializa a JSON con claves `token, name, path, size, lastModified` (test con `serde_json` como *dev-dependency* `=1.0.154`).
- [x] `cargo test -p suite-platform` (sin *feature*) y `cargo test -p suite-platform --features tauri` con código 0.
- [x] `cargo clippy -p suite-platform --all-targets --features tauri -- -D warnings` y `cargo fmt --check` con código 0.
- [x] Ningún `unwrap()`/`expect()` en `commands.rs` fuera de `#[cfg(test)]` (`grep` en el Registro).

## Fuera de alcance
- Crear la app Tauri (PDF-021). Código TypeScript (COM-010). Impresión.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/platform/rust/Cargo.toml` (feature `tauri`, dependencias y `dev-dependency` serde_json exactas), `packages/platform/rust/src/lib.rs`, `packages/platform/rust/src/args.rs` (nuevo), `packages/platform/rust/src/commands.rs` (nuevo), `packages/platform/rust/tests/args.rs` (nuevo), `Cargo.lock`.
- Qué he hecho: módulo `args` puro con `paths_from_args` y 4 tests. Módulo `commands` tras la feature `tauri` con los 8 comandos `suite_*` según la tabla, `register_os_paths`, `handler()` y tests de `From<FileError>`, `From<FileInfo>` y serialización camelCase. El registro de rutas de los diálogos y de los ficheros del SO se hace en Rust; JS solo recibe tokens y la ruta que devuelve el propio diálogo.
- Comandos ejecutados y resultado: `apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev` (no estaba instalado; instalado ahora). `cargo test -p suite-platform` → 0 (args 4, files 15, files_qa 9). `cargo test -p suite-platform --features tauri` → 0 (lib 4 + resto). `cargo clippy -p suite-platform --all-targets --features tauri -- -D warnings` → 0. `cargo fmt --check -p suite-platform` → 0. Búsqueda de `unwrap()`/`expect(` en `commands.rs`: solo aparecen en `#[cfg(test)]` (`serde_json::to_value(...).expect`); el código de comandos usa `unwrap_or_else` y `let else`.
- Dudas o cosas que no he podido hacer (programador): (1) `generate_handler!` no admite turbofish, así que `handler()` infiere `R` del `Invoke<R>`; compila y clippy pasa. (2) Los comandos de diálogo son genéricos sobre `R` para que `handler<R>()` tenga la firma de la ficha; la app debe registrar `tauri_plugin_dialog::init()` y `invoke_handler(suite_platform::commands::handler())` y gestionar `SuitePlatformState` (PDF-021). (3) Las capabilities de `dialog` quedan para PDF-021. (4) Los comandos son `async` pero llaman a E/S síncrona (`atomic_write`, `read_range`) sin `spawn_blocking`; lo he dejado así por simplicidad y para no copiar el cuerpo binario; a revisar con cargas grandes. (5) `register_os_paths` descarta en silencio las rutas que no se pueden leer y no emite el evento si no hay ninguna válida.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Verificado: `cargo test -p suite-platform` (con y sin `--features tauri`), `clippy --all-targets --features tauri -D warnings` y `cargo fmt --check` con código 0. Contrato JS↔Rust (nombres de comandos, parámetros camelCase, cabeceras `x-suite-*`, evento) coincide con COM-010. Sin `unwrap`/`expect` fuera de tests; `read_range` ya limita `MAX_READ_LEN`. Sin cambios bloqueantes.
1. `commands.rs:185-237` — (opcional) comandos `async` con E/S síncrona; valorar `spawn_blocking` con ficheros grandes (PDF-021).
2. `commands.rs:262` — (opcional) rutas del SO ilegibles se descartan en silencio; considerar avisar al usuario.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| paths_from_args | OK | `cargo test -p suite-platform --test args`: 5 tests en verde (incluye el del criterio, opciones, directorios, vacío y Unicode) |
| CommandError / FileInfoDto | OK | 4 tests de `commands::tests` en verde con `--features tauri` |
| cargo test con y sin feature | OK | ambos código 0 (args 5, files 15, files_qa 9) |
| clippy -D warnings y fmt --check | OK | ambos código 0 |
| Sin unwrap/expect fuera de tests | OK | `grep` en commands.rs: solo líneas 322 y 346, dentro de `#[cfg(test)]` (desde la 287) |

Regresión TS: `pnpm lint` y `pnpm typecheck` 0; `pnpm test` 138 en verde. Contrato con COM-010: `platform-tauri.ts` aún no existe; se comprobaron nombres de comandos y cabeceras en `commands.rs`, sin contraste posible con JS.
Tests añadidos: `admite_rutas_con_espacios_tildes_y_emojis` en `packages/platform/rust/tests/args.rs`.   Rendimiento: no aplica.
