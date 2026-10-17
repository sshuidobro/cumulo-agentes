---
tipo: tarea
id: COM-008
titulo: Crear el crate Rust suite-platform con registro de ficheros y E/S atómica
app: comun
estado: hecha
depende_de: []
intentos: 0
skills: [stack-tauri, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform, rust]
---

# COM-008 · Crate Rust `suite-platform`: registro de ficheros y E/S atómica

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
Existe el crate `packages/platform/rust` (`suite-platform`, solo `std`, sin Tauri) con: registro de rutas por *token*, lectura por rangos, escritura atómica y "copiar + anexar" atómico, probado con `cargo test` en esta máquina.

## Contexto
- Leer: [[ADR-0008-plataforma-ficheros]], skill `stack-tauri` (sección Rust).
- Rust 1.97 instalado. **No** hace falta WebKitGTK: este crate no depende de Tauri (la *feature* `tauri` llega en COM-009).
- Nada de `unwrap()`/`expect()` fuera de tests. Mutex envenenado: `lock().unwrap_or_else(|e| e.into_inner())`.

## Qué hay que hacer
1. `Cargo.toml` en la raíz del repo:
   ```toml
   [workspace]
   resolver = "2"
   members = ["packages/platform/rust"]
   ```
   `packages/platform/rust/Cargo.toml`:
   ```toml
   [package]
   name = "suite-platform"
   version = "0.1.0"
   edition = "2021"
   rust-version = "1.80"
   publish = false

   [lib]
   name = "suite_platform"

   [features]
   default = []
   ```
2. `src/lib.rs`: `pub mod files; pub use files::*;`
3. `src/files.rs`:
   ```rust
   pub const MAX_READ_LEN: u64 = 16 * 1024 * 1024;

   #[derive(Debug, Clone, PartialEq, Eq)]
   pub enum FileError { NotFound, PermissionDenied, ChangedOnDisk { expected: u64, actual: u64 }, OutOfRange, UnknownToken, Io(String) }
   impl FileError { pub fn code(&self) -> &'static str } // "not-found" "permission-denied" "changed-on-disk" "out-of-range" "unknown-token" "io"
   impl std::fmt::Display for FileError   // mensajes en español (abajo)
   impl std::error::Error for FileError {}
   impl From<std::io::Error> for FileError // ErrorKind::NotFound → NotFound, PermissionDenied → PermissionDenied, resto → Io(e.to_string())

   #[derive(Debug, Clone, PartialEq, Eq)]
   pub struct FileInfo { pub token: String, pub name: String, pub path: String, pub size: u64, pub last_modified_ms: Option<u64> }

   #[derive(Default)]
   pub struct FileRegistry { /* Mutex<(u64, HashMap<String, PathBuf>)> */ }
   impl FileRegistry {
       pub fn new() -> Self;
       pub fn register(&self, path: &Path) -> String;          // "t1", "t2", ... siempre token nuevo
       pub fn path(&self, token: &str) -> Result<PathBuf, FileError>; // UnknownToken
       pub fn unregister(&self, token: &str) -> bool;
   }
   pub fn file_info(token: &str, path: &Path) -> Result<FileInfo, FileError>; // name = file_name con to_string_lossy; size y mtime (ms) de metadata
   pub fn read_range(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>, FileError>;
   pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), FileError>;
   pub fn atomic_copy_append(base: &Path, expected_base_size: u64, delta: &[u8], target: &Path) -> Result<(), FileError>;
   ```
   Mensajes `Display`: NotFound "No se encuentra el fichero. Puede que se haya movido o borrado." · PermissionDenied "No hay permiso para acceder al fichero." · ChangedOnDisk "El fichero ha cambiado en el disco desde que se abrió. Guarda una copia con «Guardar como»." · OutOfRange "Se ha intentado leer fuera del fichero." · UnknownToken "El fichero ya no está abierto." · Io(m) "No se ha podido leer o escribir el fichero ({m})."
4. Reglas de implementación:
   - `read_range`: `len > MAX_READ_LEN` → `OutOfRange`; `offset > tamaño` → `OutOfRange`; recorta el final al tamaño; `seek` + `read_exact` del tramo recortado (`offset == tamaño` → vector vacío).
   - Temporal: función privada `temp_path_for(target)` → mismo directorio, nombre `.{nombre}.suite-tmp-{pid}-{n}` (`n` de un `AtomicU64` estático).
   - `atomic_write`: crea el temporal con `create_new`, `write_all`, `sync_all`; si el destino existe copia sus permisos al temporal; `rename(temp, path)`. Ante cualquier error borra el temporal (ignorando el error del borrado) y devuelve el error.
   - `atomic_copy_append`: tamaño actual de `base` ≠ `expected_base_size` → `ChangedOnDisk { expected, actual }` sin crear nada. Si no: `std::fs::copy(base, temp)`, abrir el temporal en modo *append*, `write_all(delta)`, `sync_all`, comprobar que el tamaño del temporal es `expected + delta.len()` (si no → `Io("tamaño inesperado")`), `rename(temp, target)`. Mismo borrado del temporal ante error. Debe funcionar con `base == target`.
5. Tests en `packages/platform/rust/tests/files.rs` con un ayudante que crea un directorio único bajo `std::env::temp_dir()` y lo borra al final.

## Criterios de aceptación
- [ ] (T) `read_range` de `"0123456789"`: `(2,3)` → `"234"`; `(8,10)` → `"89"`; `(10,5)` → vacío; `(11,1)` → `OutOfRange`; `(0, MAX_READ_LEN+1)` → `OutOfRange`; fichero inexistente → `NotFound`.
- [ ] (T) `atomic_write` crea un fichero nuevo y reemplaza uno existente; tras ello el directorio solo contiene el fichero destino (ningún `.suite-tmp`). Directorio destino inexistente → `Err(NotFound)` y no queda temporal.
- [ ] (T) `atomic_copy_append`: base `"abc"` + delta `"de"` a otro destino → destino `"abcde"` y base intacta; con `base == target` → `"abcde"`; `expected` 4 con base de 3 → `ChangedOnDisk { expected: 4, actual: 3 }` y el destino no cambia; no quedan temporales en ningún caso.
- [ ] (T) Base de 50 MiB + delta de 1 KiB: resultado correcto en < 3 s (anota el tiempo en el Registro).
- [ ] (T) Registro: `register` → `path` devuelve la ruta; tokens distintos para la misma ruta; `unregister` → luego `UnknownToken`; 8 hilos × 1 000 `register` → 8 000 tokens únicos.
- [ ] (T) `FileError::code()` y `to_string()` dan los textos de la tabla; `io::ErrorKind::NotFound` → `FileError::NotFound`.
- [ ] `cargo fmt --check`, `cargo clippy -p suite-platform --all-targets -- -D warnings` y `cargo test -p suite-platform` con código 0 desde la raíz del repo. `target/` no aparece en `git status`.

## Fuera de alcance
- Comandos Tauri, diálogos, eventos (COM-009). Bloqueo de ficheros entre procesos.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `Cargo.toml` (raíz, workspace), `packages/platform/rust/Cargo.toml`, `packages/platform/rust/src/lib.rs`, `packages/platform/rust/src/files.rs`, `packages/platform/rust/tests/files.rs`, `Cargo.lock` (generado), esta ficha.
- Qué he hecho: crate `suite-platform` solo con `std` (sin Tauri). Registro de tokens `t1..tN` con `Mutex` (poison-safe), `read_range` con recorte y límite de 16 MiB, `atomic_write` y `atomic_copy_append` con temporal `.{nombre}.suite-tmp-{pid}-{n}` en el mismo directorio, borrado del temporal ante error y copia de permisos en `atomic_write`. Mensajes de error en español y códigos estables. 15 tests de integración cubren todos los criterios (T).
- Comandos ejecutados y resultado: `cargo fmt --check -p suite-platform` → 0; `cargo clippy -p suite-platform --all-targets -- -D warnings` → 0; `cargo test -p suite-platform` → 15 passed, 0 failed. Tiempo de `atomic_copy_append` con base de 50 MiB + 1 KiB: **65 ms** (límite 3 s). `target/` aparece ignorado por `.gitignore` (la entrada ya estaba en el working tree, editada por COM-004; no la he tocado). Todos los comandos se ejecutaron desde la raíz del repo.
- Dudas o cosas que no he podido hacer: el test de permisos (`atomic_write` conserva modo) va con `#[cfg(unix)]` porque el crate debe compilar también en Windows; en Windows no se ejecuta. No he hecho `fsync` del directorio tras el `rename` (no lo pide la ficha; anotado por si el tester lo quiere como mejora de durabilidad).

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Verificado desde la raíz: `cargo fmt --check` 0, `cargo clippy -p suite-platform --all-targets -- -D warnings` 0, `cargo test -p suite-platform` 15/15. `git status` limpio (`target/` ignorado). Sin `unwrap`/`expect` fuera de tests, mutex tolerante a envenenamiento, temporal borrado ante error, comprobación de tamaño y `base == target` correctos. Cada criterio (T) tiene su test.
1. `packages/platform/rust/src/files.rs:190` (opcional) — hacer `fsync` del directorio tras `rename` mejoraría la durabilidad ante corte de corriente; no bloquea.
2. `packages/platform/rust/src/files.rs:225` (opcional) — `copy_append_temp` podría validar el tamaño antes del `copy` si `base` cambia durante la copia (condición de carrera estrecha); ya queda cubierta por la comprobación final de tamaño.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| read_range (rangos, recorte, vacío, OutOfRange, NotFound) | OK | `cargo test -p suite-platform`: `read_range_*` verdes; más límites extremos (`u64::MAX`, len 0, `MAX_READ_LEN` exacto) en `files_qa.rs` |
| atomic_write nuevo/reemplazo, sin temporales, dir inexistente → NotFound | OK | tests `atomic_write_*` verdes; destino-directorio falla sin dejar temporal |
| atomic_copy_append (otro destino, base==target, ChangedOnDisk, sin temporales) | OK | tests `copy_append_*` verdes; añadidos base inexistente, destino inexistente, destino directorio, delta vacío |
| 50 MiB + 1 KiB < 3 s | OK | test `copy_append_con_base_de_50_mib_es_rapido` verde (0,36 s la suite entera; el programador midió 65 ms) |
| Registro (rutas, tokens únicos, unregister, 8×1000 hilos) | OK | tests `registro_*` verdes; añadido token desconocido y no reutilización tras unregister |
| code()/Display/From<io::Error> | OK | `file_error_codigos_y_mensajes`, `file_error_desde_io_error` |
| fmt, clippy -D warnings, test, `target/` ignorado | OK | los tres con código 0; `git status` no muestra `target/` |
| Regresión TS | OK | `pnpm lint`, `pnpm typecheck` 0; `pnpm test` 67/67 |

Sin fallos. Casos límite probados: Unicode (ñ, emoji, árabe) y espacios en ruta/nombre, fichero vacío, directorio como origen/destino.
Tests añadidos: `packages/platform/rust/tests/files_qa.rs` (9 tests, todos verdes; fmt y clippy limpios con ellos).
Rendimiento: copy+append 50 MiB ≈ 65 ms (presupuesto 3 s).
Observación no bloqueante: sin `fsync` del directorio tras `rename` (ya anotado por programador/revisor).
