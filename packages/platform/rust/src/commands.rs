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

/// Evento que recibe JS cuando el SO pide abrir ficheros.
pub const OS_OPEN_EVENT: &str = "suite://file-opened";

const TOKEN_HEADER: &str = "x-suite-token";
const BASE_TOKEN_HEADER: &str = "x-suite-base-token";
const EXPECTED_SIZE_HEADER: &str = "x-suite-expected-size";

/// Estado gestionado por la app: registro de rutas y cola de ficheros abiertos desde el SO.
#[derive(Default)]
pub struct SuitePlatformState {
    pub registry: FileRegistry,
    pub pending: Mutex<Vec<FileInfo>>,
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
            Ok(Some(register_existing(&state.registry, &path)?.into()))
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
            Ok(Some(register_target(&state.registry, &path)?.into()))
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
