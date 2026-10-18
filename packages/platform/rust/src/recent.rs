//! Documentos recientes de escritorio (ADR-0023): lista persistida en
//! `recent.json` y reapertura por id. Módulo puro, sin Tauri: quien conoce la
//! carpeta de datos de la app es `commands.rs`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::files::{atomic_write, file_info, FileError, FileInfo, FileRegistry};

/// Máximo de entradas que se conservan.
pub const MAX_RECENTS: usize = 20;

/// Un documento reciente. Solo metadatos: nunca el contenido.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    /// `None` si el tamaño no era conocido al registrar la entrada.
    pub size: Option<u64>,
    /// Milisegundos desde la época Unix.
    pub opened_at: u64,
}

/// Lista de recientes, la más reciente primero.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentList {
    pub entries: Vec<RecentEntry>,
}

/// Error de `open_recent`: id desconocido o fallo al leer el fichero.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecentOpenError {
    UnknownId,
    File(FileError),
}

/// Milisegundos actuales desde la época Unix (0 si el reloj está antes de 1970).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// Carga la lista de `path`. Si el fichero no existe, no se puede leer o está
/// corrupto, devuelve una lista vacía (nunca entra en pánico).
pub fn load(path: &Path) -> RecentList {
    let Ok(text) = fs::read_to_string(path) else {
        return RecentList::default();
    };
    match serde_json::from_str::<RecentList>(&text) {
        Ok(mut list) => {
            list.entries.truncate(MAX_RECENTS);
            list
        }
        Err(_) => RecentList::default(),
    }
}

/// Guarda `list` en `path` de forma atómica, creando la carpeta si falta.
pub fn save(path: &Path, list: &RecentList) -> Result<(), FileError> {
    let json = serde_json::to_vec_pretty(list).map_err(|e| FileError::Io(e.to_string()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write(path, &json)
}

impl RecentList {
    /// Registra un uso de `path`. Si ya está en la lista, la mueve al principio
    /// sin duplicarla y conserva su id; si no, le asigna uno nuevo.
    pub fn touch(&mut self, path: &Path, size: Option<u64>, now: u64) {
        let id = match self.entries.iter().position(|e| e.path == path) {
            Some(index) => self.entries.remove(index).id,
            None => self.new_id(now),
        };
        self.entries.insert(
            0,
            RecentEntry {
                id,
                path: path.to_path_buf(),
                name: file_name(path),
                size,
                opened_at: now,
            },
        );
        self.entries.truncate(MAX_RECENTS);
    }

    /// Entrada con ese id, si existe.
    pub fn get(&self, id: &str) -> Option<&RecentEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Quita la entrada con ese id. Devuelve `true` si existía.
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() != before
    }

    /// Vacía la lista.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Id nuevo que no colisiona con ninguna entrada actual.
    fn new_id(&self, now: u64) -> String {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        loop {
            let candidate = format!("r{now:x}-{:x}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
            if self.entries.iter().all(|e| e.id != candidate) {
                return candidate;
            }
        }
    }
}

/// Reabre la entrada `id`: registra su ruta en `registry` (como si el usuario
/// la hubiera elegido en el diálogo), la sube a primera posición y devuelve sus
/// metadatos. Si el fichero ya no existe, no se registra nada y la entrada se conserva.
pub fn open_recent(
    registry: &FileRegistry,
    list: &mut RecentList,
    id: &str,
    now: u64,
) -> Result<FileInfo, RecentOpenError> {
    let path = list.get(id).ok_or(RecentOpenError::UnknownId)?.path.clone();
    let token = registry.register(&path);
    let info = match file_info(&token, &path) {
        Ok(info) => info,
        Err(error) => {
            registry.unregister(&token);
            return Err(RecentOpenError::File(error));
        }
    };
    list.touch(&path, Some(info.size), now);
    Ok(info)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fichero".to_string())
}
