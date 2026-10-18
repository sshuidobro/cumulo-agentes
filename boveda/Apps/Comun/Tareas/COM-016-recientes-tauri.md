---
tipo: tarea
id: COM-016
titulo: Documentos recientes en Tauri (lista guardada por Rust)
app: comun
estado: hecha
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
- [x] `cargo fmt --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace --all-features` con código 0, con los tests nuevos.
- [x] Rust: abrir 21 rutas distintas → 20 entradas; abrir de nuevo la 5.ª → pasa a ser la primera sin duplicar; `recent.json` con `{basura` → lista vacía y se sobrescribe bien al siguiente `touch`.
- [x] `suite_recent_open` con un id desconocido → error; con una ruta borrada → `not-found`; con una válida → el token permite `suite_read_range`.
- [x] TS (`mockIPC`): `openRecent` devuelve un `OpenedFile` con `path` y `canSaveInPlace: true`; `recentFiles` traduce `available`.
- [x] No existe ningún comando que acepte una ruta escrita por la web para añadirla a recientes (revisión del código: solo `touch` desde diálogo, SO o guardar como).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz (PDF-049). Lista de saltos del SO (Windows Jump List, menú Dock).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `packages/platform/rust/src/recent.rs` (nuevo), `packages/platform/rust/src/lib.rs`, `packages/platform/rust/src/commands.rs`, `packages/platform/rust/Cargo.toml`, `packages/platform/rust/tests/recent.rs` (nuevo), `packages/platform/src/tauri/platform-tauri.ts`, `packages/platform/tests/tauri/recent-tauri.test.ts` (nuevo).
- Qué he hecho: módulo puro `recent` (`RecentList`, `load` tolerante, `save` atómico vía `atomic_write`, `touch` con máximo 20, `remove`, `clear`, `open_recent`). En `commands.rs`: estado con candado `recents_gate`, `touch` en `suite_open_dialog`, «Guardar como» y aperturas del SO; comandos `suite_recent_list`, `suite_recent_open`, `suite_recent_remove`, `suite_recent_clear` registrados. En TS: `recentFiles`, `openRecent`, `removeRecent`, `clearRecents` sobre esos comandos; `unknown-recent` se mapea a `not-found`.
- Dependencias: `serde` pasa de opcional a obligatoria (`=1.0.229`) y `serde_json =1.0.154` pasa de dev-dependency a dependencia normal. Ambas versiones ya estaban en el lockfile; no entra ninguna dependencia nueva.
- Comandos ejecutados y resultado: en `packages/platform/rust`: `cargo fmt --check` OK; `cargo clippy --all-targets --all-features -- -D warnings` OK; `cargo test --all-features` OK (tests nuevos de `recent.rs`: 14 en total en ese fichero, además de los existentes). En `apps/lector-pdf/src-tauri`: `cargo check` OK. En raíz: `pnpm lint` OK, `pnpm typecheck` OK, `pnpm test` 187 ficheros y 2 187 tests en verde, `pnpm coverage` OK (líneas 98,71 %). No he lanzado e2e ni perf.
- Dudas o cosas que no he podido hacer:
  - Interpretación 1: `suite_recent_open` también sube la entrada a primera posición (se trata como una elección del diálogo). La ficha no lo dice de forma explícita; si el revisor lo quiere distinto, es un cambio de una línea.
  - Interpretación 2: en «Guardar como» se anota la ruta al elegir el destino, no al terminar la escritura. Un destino nuevo queda sin tamaño (`size: null`) hasta que se vuelva a abrir.
  - Los errores de guardar `recent.json` en `touch` y en `suite_recent_open` se ignoran (la apertura no falla por eso). En `suite_recent_remove` y `suite_recent_clear` sí se devuelve error, y TS lo registra con el logger.
  - Una ruta que no sea UTF-8 no se puede serializar en JSON: la entrada no se guarda y no hay error visible. Caso raro; lo anoto.
  - Los criterios de la ficha no están marcados: los verifica el tester.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Verificado: `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` y `cargo test --all-features` en `packages/platform/rust` en verde (14 tests de `recent.rs`); `cargo check` en `apps/lector-pdf/src-tauri` OK. No he lanzado e2e/perf.
- Interpretación 1 (`suite_recent_open` sube la entrada): confirmada. Es coherente con tratarla como elección del diálogo y mantiene el orden por último uso.
- Interpretación 2 (Guardar como anota al elegir destino, sin tamaño si es nuevo): confirmada. Si el usuario cancela la escritura, la entrada queda con `available: false`, que la UI (PDF-049) ya sabe mostrar. (opcional) Valorar anotar tras la escritura.
- Interpretación 3 (errores de guardado ignorados en `touch`/`recent_open`, devueltos en remove/clear; ruta no UTF-8 no se guarda): confirmada. La apertura no debe fallar por un efecto secundario; caso no UTF-8 aceptable y documentado.
- Seguridad: ningún comando acepta una ruta de la web; `suite_recent_open` solo recibe id y la ruta sale de la lista de Rust. Candado `recents_gate` serializa lectura-modificación-escritura. Sin cambios pedidos.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| cargo fmt/clippy/test (workspace) | OK | `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace --all-features`: todo en 0; `recent.rs` 14 tests, files 15, files_qa 9, args 5, lib 5+3 |
| 21 rutas→20; reabrir 5.ª sin duplicar; `{basura` | OK | tests `abrir_21_rutas_distintas_deja_20_entradas`, `volver_a_abrir_la_quinta_la_pone_primera_sin_duplicarla`, `fichero_corrupto_da_lista_vacia_y_se_sobrescribe_en_el_siguiente_touch` |
| `open_recent`: id desconocido, ruta borrada, válida | OK | tests `open_recent_*` (error, `not-found` conservando entrada, token que permite leer por rangos) |
| TS con `mockIPC` | OK | `recent-tauri.test.ts` 7 tests; `packages/platform` 222 tests en verde |
| Ninguna ruta de la web | OK | revisado `commands.rs`: `suite_recent_*` solo reciben `id`; `touch` solo desde `suite_open_dialog`, `suite_save_dialog` y aperturas del SO |
| lint, typecheck, test, coverage | OK | `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 188 ficheros / 2203 tests, `pnpm coverage` 0 |

Nota: en una primera pasada de `pnpm test` falló una vez `apps/lector-pdf/tests/unit/forms-write.test.ts` (casilla desmarcada /Off), ajeno a COM-016 (fichero con cambios sin commit de otra ficha); en 2 reejecuciones posteriores pasó. Posible flaky bajo carga: conviene vigilarlo. Sin e2e ni rendimiento (fuera de petición).
Tests añadidos: ninguno (cobertura existente suficiente).
