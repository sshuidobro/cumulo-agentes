//! Comandos Tauri `suite_*` que usa `platform-tauri.ts` (COM-010).
//! Solo se compila con la *feature* `tauri`. JS nunca recibe ni envía rutas
//! salvo la que el propio diálogo devuelve: el resto va por tokens opacos.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

use crate::files::{
    atomic_copy_append, atomic_write, file_info, read_range, FileError, FileInfo, FileRegistry,
};
use crate::recent::{self, RecentEntry, RecentList, RecentOpenError};

/// Evento que recibe JS cuando el SO pide abrir ficheros.
pub const OS_OPEN_EVENT: &str = "suite://file-opened";

const TOKEN_HEADER: &str = "x-suite-token";
const BASE_TOKEN_HEADER: &str = "x-suite-base-token";
const EXPECTED_SIZE_HEADER: &str = "x-suite-expected-size";

/// Estado gestionado por la app: registro de rutas, cola de ficheros abiertos desde el SO
/// y candado que serializa las lecturas y escrituras de `recent.json`.
#[derive(Default)]
pub struct SuitePlatformState {
    pub registry: FileRegistry,
    pub pending: Mutex<Vec<FileInfo>>,
    pub recents_gate: Mutex<()>,
}

/// Metadatos de un fichero tal como los recibe JS.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfoDto {
    pub token: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub last_modified: Option<u64>,
}

impl From<FileInfo> for FileInfoDto {
    fn from(info: FileInfo) -> Self {
        FileInfoDto {
            token: info.token,
            name: info.name,
            path: info.path,
            size: info.size,
            last_modified: info.last_modified_ms,
        }
    }
}

/// Documento reciente tal como lo recibe JS (`RecentFile` de `@suite/platform`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
    pub opened_at: u64,
    pub available: bool,
}

impl From<RecentEntry> for RecentDto {
    fn from(entry: RecentEntry) -> Self {
        let available = entry.path.exists();
        RecentDto {
            id: entry.id,
            name: entry.name,
            path: entry.path.to_string_lossy().into_owned(),
            size: entry.size,
            opened_at: entry.opened_at,
            available,
        }
    }
}

/// Filtro de extensiones para los diálogos.
#[derive(Deserialize)]
pub struct FileFilterDto {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Error serializado para JS: `code` estable y `message` en español.
#[derive(Serialize, Debug)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl From<FileError> for CommandError {
    fn from(error: FileError) -> Self {
        CommandError {
            code: error.code().to_string(),
            message: error.to_string(),
        }
    }
}

fn bad_request() -> CommandError {
    CommandError {
        code: "bad-request".to_string(),
        message: "Petición no válida.".to_string(),
    }
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, CommandError> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(bad_request)
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], CommandError> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        InvokeBody::Json(_) => Err(bad_request()),
    }
}

fn lock_pending(state: &SuitePlatformState) -> MutexGuard<'_, Vec<FileInfo>> {
    state.pending.lock().unwrap_or_else(|e| e.into_inner())
}

fn lock_recents(state: &SuitePlatformState) -> MutexGuard<'_, ()> {
    state.recents_gate.lock().unwrap_or_else(|e| e.into_inner())
}

/// `recent.json` en la carpeta de datos de la app.
fn recent_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FileError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("recent.json"))
        .map_err(|_| FileError::Io("carpeta de datos no disponible".to_string()))
}

/// Lee, cambia y guarda la lista de recientes con el candado tomado.
fn update_recents<R: Runtime, T>(
    app: &AppHandle<R>,
    state: &SuitePlatformState,
    change: impl FnOnce(&mut RecentList) -> T,
) -> Result<T, FileError> {
    let file = recent_file(app)?;
    let _gate = lock_recents(state);
    let mut list = recent::load(&file);
    let result = change(&mut list);
    recent::save(&file, &list)?;
    Ok(result)
}

/// Anota en recientes una ruta elegida por el usuario o recibida del SO. Es un
/// efecto secundario: si no se puede guardar la lista, la apertura sigue adelante.
fn remember<R: Runtime>(
    app: &AppHandle<R>,
    state: &SuitePlatformState,
    path: &Path,
    size: Option<u64>,
) {
    let _ = update_recents(app, state, |list| list.touch(path, size, recent::now_ms()));
}

fn recent_open_error(error: RecentOpenError) -> CommandError {
    match error {
        RecentOpenError::UnknownId => CommandError {
            code: "unknown-recent".to_string(),
            message: "Ese fichero ya no está en recientes.".to_string(),
        },
        RecentOpenError::File(error) => CommandError::from(error),
    }
}

fn apply_filters<R: Runtime>(
    dialog: FileDialogBuilder<R>,
    filters: &[FileFilterDto],
) -> FileDialogBuilder<R> {
    filters.iter().fold(dialog, |dialog, filter| {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog.add_filter(&filter.name, &extensions)
    })
}

fn picked_path(picked: FilePath) -> Result<PathBuf, CommandError> {
    picked
        .into_path()
        .map_err(|_| CommandError::from(FileError::Io("ruta no soportada".to_string())))
}

/// Registra una ruta que ya existe y devuelve sus metadatos. Si no se pueden leer, la quita.
fn register_existing(registry: &FileRegistry, path: &Path) -> Result<FileInfo, FileError> {
    let token = registry.register(path);
    file_info(&token, path).inspect_err(|_| {
        registry.unregister(&token);
    })
}

/// Registra la ruta de un destino de guardado. Si aún no existe, tamaño 0 y sin fecha.
fn register_target(registry: &FileRegistry, path: &Path) -> Result<FileInfo, FileError> {
    let token = registry.register(path);
    match file_info(&token, path) {
        Ok(info) => Ok(info),
        Err(FileError::NotFound) => Ok(FileInfo {
            token,
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            size: 0,
            last_modified_ms: None,
        }),
        Err(error) => {
            registry.unregister(&token);
            Err(error)
        }
    }
}

/// Diálogo de abrir: devuelve el fichero elegido (o `null` si se cancela).
#[tauri::command]
pub async fn suite_open_dialog<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SuitePlatformState>,
    filters: Vec<FileFilterDto>,
) -> Result<Option<FileInfoDto>, CommandError> {
    let dialog = apply_filters(app.dialog().file(), &filters);
    match dialog.blocking_pick_file() {
        None => Ok(None),
        Some(picked) => {
            let path = picked_path(picked)?;
            let info = register_existing(&state.registry, &path)?;
            remember(&app, &state, &path, Some(info.size));
            Ok(Some(info.into()))
        }
    }
}

/// Diálogo de guardar como: devuelve el destino elegido (o `null` si se cancela).
#[tauri::command]
pub async fn suite_save_dialog<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SuitePlatformState>,
    suggested_name: String,
    filters: Vec<FileFilterDto>,
) -> Result<Option<FileInfoDto>, CommandError> {
    let dialog = apply_filters(app.dialog().file(), &filters).set_file_name(suggested_name);
    match dialog.blocking_save_file() {
        None => Ok(None),
        Some(picked) => {
            let path = picked_path(picked)?;
            let info = register_target(&state.registry, &path)?;
            // Un destino que aún no existe no tiene tamaño: se anota sin él.
            let size = info.last_modified_ms.map(|_| info.size);
            remember(&app, &state, &path, size);
            Ok(Some(info.into()))
        }
    }
}

/// Lee `length` bytes desde `offset` del fichero registrado con `token`.
#[tauri::command]
pub async fn suite_read_range(
    state: State<'_, SuitePlatformState>,
    token: String,
    offset: u64,
    length: u64,
) -> Result<Response, CommandError> {
    let path = state.registry.path(&token)?;
    let bytes = read_range(&path, offset, length)?;
    Ok(Response::new(bytes))
}

/// Metadatos del fichero registrado con `token`.
#[tauri::command]
pub async fn suite_file_info(
    state: State<'_, SuitePlatformState>,
    token: String,
) -> Result<FileInfoDto, CommandError> {
    let path = state.registry.path(&token)?;
    Ok(file_info(&token, &path)?.into())
}

/// Escribe el cuerpo binario en el destino (cabecera `x-suite-token`) de forma atómica.
#[tauri::command]
pub async fn suite_write_atomic(
    state: State<'_, SuitePlatformState>,
    request: Request<'_>,
) -> Result<FileInfoDto, CommandError> {
    let token = header(&request, TOKEN_HEADER)?;
    let path = state.registry.path(token)?;
    let bytes = raw_body(&request)?;
    atomic_write(&path, bytes)?;
    Ok(file_info(token, &path)?.into())
}

/// Copia el fichero base y le añade el cuerpo (delta) en el destino de forma atómica.
/// Cabeceras: `x-suite-token` (destino), `x-suite-base-token` y `x-suite-expected-size`.
#[tauri::command]
pub async fn suite_append_atomic(
    state: State<'_, SuitePlatformState>,
    request: Request<'_>,
) -> Result<FileInfoDto, CommandError> {
    let target_token = header(&request, TOKEN_HEADER)?;
    let base_token = header(&request, BASE_TOKEN_HEADER)?;
    let expected_size: u64 = header(&request, EXPECTED_SIZE_HEADER)?
        .parse()
        .map_err(|_| bad_request())?;
    let delta = raw_body(&request)?;
    let target = state.registry.path(target_token)?;
    let base = state.registry.path(base_token)?;
    atomic_copy_append(&base, expected_size, delta, &target)?;
    Ok(file_info(target_token, &target)?.into())
}

/// Lista de recientes, la más reciente primero. `available` indica si la ruta sigue existiendo.
#[tauri::command]
pub async fn suite_recent_list<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<RecentDto>, CommandError> {
    let file = recent_file(&app)?;
    Ok(recent::load(&file)
        .entries
        .into_iter()
        .map(RecentDto::from)
        .collect())
}

/// Reabre el reciente `id`: registra su ruta como si se hubiera elegido en el diálogo.
/// JS nunca envía una ruta, solo el id de la lista que guarda Rust.
#[tauri::command]
pub async fn suite_recent_open<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SuitePlatformState>,
    id: String,
) -> Result<FileInfoDto, CommandError> {
    let file = recent_file(&app)?;
    let _gate = lock_recents(&state);
    let mut list = recent::load(&file);
    let info = recent::open_recent(&state.registry, &mut list, &id, recent::now_ms())
        .map_err(recent_open_error)?;
    // La apertura ya es válida: si no se puede guardar el orden, no se deshace.
    let _ = recent::save(&file, &list);
    Ok(info.into())
}

/// Quita una entrada de recientes. No borra el fichero.
#[tauri::command]
pub async fn suite_recent_remove<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SuitePlatformState>,
    id: String,
) -> Result<(), CommandError> {
    update_recents(&app, &state, |list| {
        list.remove(&id);
    })?;
    Ok(())
}

/// Vacía la lista de recientes. No borra ningún fichero.
#[tauri::command]
pub async fn suite_recent_clear<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SuitePlatformState>,
) -> Result<(), CommandError> {
    update_recents(&app, &state, RecentList::clear)?;
    Ok(())
}

/// Quita un token del registro. Devuelve `true` si existía.
#[tauri::command]
pub fn suite_close(state: State<'_, SuitePlatformState>, token: String) -> bool {
    state.registry.unregister(&token)
}

/// Vacía la cola de ficheros abiertos desde el SO.
#[tauri::command]
pub fn suite_take_pending_opens(state: State<'_, SuitePlatformState>) -> Vec<FileInfoDto> {
    std::mem::take(&mut *lock_pending(&state))
        .into_iter()
        .map(FileInfoDto::from)
        .collect()
}

/// Abre el diálogo de impresión nativo de la ventana (en macOS `window.print()` no siempre lo abre).
#[tauri::command]
pub async fn suite_print<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), String> {
    window
        .print()
        .map_err(|error| format!("No se ha podido abrir la impresión: {error}"))
}

/// Registra las rutas recibidas del SO, las añade a la cola y avisa a JS con `OS_OPEN_EVENT`.
/// Las rutas que no se pueden leer se descartan.
pub fn register_os_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let Some(state) = app.try_state::<SuitePlatformState>() else {
        return;
    };
    let mut queued = false;
    for path in paths {
        let Ok(info) = register_existing(&state.registry, &path) else {
            continue;
        };
        remember(app, &state, &path, Some(info.size));
        lock_pending(&state).push(info);
        queued = true;
    }
    if queued {
        let _ = app.emit(OS_OPEN_EVENT, ());
    }
}

/// Comandos `suite_*` para la app: `invoke_handler(suite_platform::commands::handler())`.
pub fn handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        suite_open_dialog,
        suite_save_dialog,
        suite_read_range,
        suite_file_info,
        suite_write_atomic,
        suite_append_atomic,
        suite_close,
        suite_take_pending_opens,
        suite_print,
        suite_recent_list,
        suite_recent_open,
        suite_recent_remove,
        suite_recent_clear,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_de_cambio_en_disco_se_convierte_con_codigo_y_mensaje_en_espanol() {
        let error = FileError::ChangedOnDisk {
            expected: 10,
            actual: 12,
        };

        let converted = CommandError::from(error.clone());

        assert_eq!(converted.code, "changed-on-disk");
        assert_eq!(converted.message, error.to_string());
        assert!(converted.message.contains("ha cambiado en el disco"));
    }

    #[test]
    fn error_de_token_desconocido_usa_su_codigo() {
        let converted = CommandError::from(FileError::UnknownToken);

        assert_eq!(converted.code, "unknown-token");
    }

    #[test]
    fn file_info_dto_serializa_con_claves_en_camel_case() {
        let info = FileInfo {
            token: "t1".to_string(),
            name: "a.pdf".to_string(),
            path: "/x/a.pdf".to_string(),
            size: 10,
            last_modified_ms: Some(5),
        };

        let json = serde_json::to_value(FileInfoDto::from(info)).expect("serializar");

        assert_eq!(
            json,
            serde_json::json!({
                "token": "t1",
                "name": "a.pdf",
                "path": "/x/a.pdf",
                "size": 10,
                "lastModified": 5
            })
        );
    }

    #[test]
    fn recent_dto_serializa_con_claves_en_camel_case_y_disponibilidad() {
        let dir = std::env::temp_dir().join(format!("suite-recent-dto-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("crear directorio temporal");
        let existing = dir.join("a.pdf");
        std::fs::write(&existing, b"%PDF").expect("crear fichero");
        let entry = RecentEntry {
            id: "r1-0".to_string(),
            path: existing.clone(),
            name: "a.pdf".to_string(),
            size: Some(4),
            opened_at: 7,
        };

        let json = serde_json::to_value(RecentDto::from(entry)).expect("serializar");
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(
            json,
            serde_json::json!({
                "id": "r1-0",
                "name": "a.pdf",
                "path": existing.to_string_lossy(),
                "size": 4,
                "openedAt": 7,
                "available": true
            })
        );
    }

    #[test]
    fn file_info_dto_sin_fecha_serializa_null() {
        let info = FileInfo {
            token: "t2".to_string(),
            name: "nuevo.pdf".to_string(),
            path: "/x/nuevo.pdf".to_string(),
            size: 0,
            last_modified_ms: None,
        };

        let json = serde_json::to_value(FileInfoDto::from(info)).expect("serializar");

        assert_eq!(json["lastModified"], serde_json::Value::Null);
    }
}
