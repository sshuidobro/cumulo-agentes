//! Acceso a ficheros del sistema: registro de rutas por token, lectura por
//! rangos y escritura atómica. Módulo puro (solo `std`), sin Tauri.

use std::collections::HashMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

/// Longitud máxima de una lectura por rangos (16 MiB).
pub const MAX_READ_LEN: u64 = 16 * 1024 * 1024;

/// Errores esperables de E/S de ficheros.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileError {
    NotFound,
    PermissionDenied,
    ChangedOnDisk { expected: u64, actual: u64 },
    OutOfRange,
    UnknownToken,
    Io(String),
}

impl FileError {
    /// Código estable para el frontend.
    pub fn code(&self) -> &'static str {
        match self {
            FileError::NotFound => "not-found",
            FileError::PermissionDenied => "permission-denied",
            FileError::ChangedOnDisk { .. } => "changed-on-disk",
            FileError::OutOfRange => "out-of-range",
            FileError::UnknownToken => "unknown-token",
            FileError::Io(_) => "io",
        }
    }
}

impl fmt::Display for FileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FileError::NotFound => {
                write!(f, "No se encuentra el fichero. Puede que se haya movido o borrado.")
            }
            FileError::PermissionDenied => write!(f, "No hay permiso para acceder al fichero."),
            FileError::ChangedOnDisk { .. } => write!(
                f,
                "El fichero ha cambiado en el disco desde que se abrió. Guarda una copia con «Guardar como»."
            ),
            FileError::OutOfRange => write!(f, "Se ha intentado leer fuera del fichero."),
            FileError::UnknownToken => write!(f, "El fichero ya no está abierto."),
            FileError::Io(m) => write!(
                f,
                "No se ha podido leer o escribir el fichero ({m})."
            ),
        }
    }
}

impl std::error::Error for FileError {}

impl From<std::io::Error> for FileError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => FileError::NotFound,
            std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied,
            _ => FileError::Io(e.to_string()),
        }
    }
}

/// Metadatos de un fichero registrado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileInfo {
    pub token: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub last_modified_ms: Option<u64>,
}

type RegistryState = (u64, HashMap<String, PathBuf>);

/// Registro de rutas: JS solo maneja tokens opacos, nunca rutas.
#[derive(Default)]
pub struct FileRegistry {
    state: Mutex<RegistryState>,
}

impl FileRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, RegistryState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Registra una ruta y devuelve un token nuevo ("t1", "t2", ...).
    pub fn register(&self, path: &Path) -> String {
        let mut guard = self.lock();
        guard.0 += 1;
        let token = format!("t{}", guard.0);
        guard.1.insert(token.clone(), path.to_path_buf());
        token
    }

    /// Devuelve la ruta asociada a un token.
    pub fn path(&self, token: &str) -> Result<PathBuf, FileError> {
        self.lock()
            .1
            .get(token)
            .cloned()
            .ok_or(FileError::UnknownToken)
    }

    /// Quita un token del registro. Devuelve `true` si existía.
    pub fn unregister(&self, token: &str) -> bool {
        self.lock().1.remove(token).is_some()
    }
}

/// Metadatos de `path` identificado por `token`.
pub fn file_info(token: &str, path: &Path) -> Result<FileInfo, FileError> {
    let metadata = fs::metadata(path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let last_modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| u64::try_from(d.as_millis()).ok());
    Ok(FileInfo {
        token: token.to_string(),
        name,
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        last_modified_ms,
    })
}

/// Lee `len` bytes desde `offset`, recortando al final del fichero.
pub fn read_range(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>, FileError> {
    if len > MAX_READ_LEN {
        return Err(FileError::OutOfRange);
    }
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    if offset > size {
        return Err(FileError::OutOfRange);
    }
    let end = offset.saturating_add(len).min(size);
    let count = usize::try_from(end - offset).map_err(|_| FileError::OutOfRange)?;
    let mut buf = vec![0u8; count];
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(&mut buf)?;
    Ok(buf)
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Ruta temporal en el mismo directorio que `target`.
fn temp_path_for(target: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = target
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fichero".to_string());
    target.with_file_name(format!(".{name}.suite-tmp-{}-{n}", std::process::id()))
}

/// Escribe `bytes` en `path` de forma atómica (temporal + renombrado).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    let tmp = temp_path_for(path);
    let result = write_temp(&tmp, path, bytes)
        .and_then(|()| fs::rename(&tmp, path).map_err(FileError::from));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_temp(tmp: &Path, path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    match fs::metadata(path) {
        Ok(meta) => fs::set_permissions(tmp, meta.permissions())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

/// Copia `base` a `target` añadiendo `delta` al final, de forma atómica.
/// Si el tamaño actual de `base` no es `expected_base_size`, no toca nada.
/// Funciona con `base == target`.
pub fn atomic_copy_append(
    base: &Path,
    expected_base_size: u64,
    delta: &[u8],
    target: &Path,
) -> Result<(), FileError> {
    let actual = fs::metadata(base)?.len();
    if actual != expected_base_size {
        return Err(FileError::ChangedOnDisk {
            expected: expected_base_size,
            actual,
        });
    }
    let tmp = temp_path_for(target);
    let result = copy_append_temp(base, expected_base_size, delta, &tmp)
        .and_then(|()| fs::rename(&tmp, target).map_err(FileError::from));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn copy_append_temp(base: &Path, expected: u64, delta: &[u8], tmp: &Path) -> Result<(), FileError> {
    fs::copy(base, tmp)?;
    let mut file = OpenOptions::new().append(true).open(tmp)?;
    file.write_all(delta)?;
    file.sync_all()?;
    let size = file.metadata()?.len();
    let delta_len = u64::try_from(delta.len()).map_err(|_| unexpected_size())?;
    if expected.checked_add(delta_len) != Some(size) {
        return Err(unexpected_size());
    }
    Ok(())
}

fn unexpected_size() -> FileError {
    FileError::Io("tamaño inesperado".to_string())
}
