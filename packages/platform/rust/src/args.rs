//! Rutas de fichero recibidas por argumentos de línea de comandos (doble clic
//! en el SO o `app fichero.pdf`). Módulo puro, sin Tauri.

use std::path::{Path, PathBuf};

/// Extrae las rutas de `args` (con `args[0]` = programa). Ignora el programa y
/// las opciones que empiezan por `-`; resuelve las relativas contra `cwd` y
/// conserva solo las que son ficheros existentes.
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| {
            let path = PathBuf::from(arg);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .filter(|path| path.is_file())
        .collect()
}
