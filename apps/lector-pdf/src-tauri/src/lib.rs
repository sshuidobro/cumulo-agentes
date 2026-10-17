//! Lector PDF de escritorio (Tauri 2). Empaqueta la misma app web (ADR-0008):
//! los comandos `suite_*` viven en `suite-platform`; aquí solo se conectan
//! el arranque, la instancia única y las rutas que llegan del sistema.

use std::path::{Path, PathBuf};

use suite_platform::commands::{register_os_paths, SuitePlatformState};
use suite_platform::paths_from_args;
use tauri::{AppHandle, DragDropEvent, Manager, RunEvent, Runtime, WindowEvent};

/// Conserva las rutas que existen como fichero y acaban en `.pdf` (sin distinguir mayúsculas).
pub fn pdf_paths(paths: &[PathBuf]) -> Vec<PathBuf> {
    paths
        .iter()
        .filter(|path| is_pdf(path) && path.is_file())
        .cloned()
        .collect()
}

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

/// Reacciona a los eventos del bucle principal: en macOS el SO entrega los ficheros así.
fn handle_run_event<R: Runtime>(app: &AppHandle<R>, event: RunEvent) {
    #[cfg(target_os = "macos")]
    if let RunEvent::Opened { urls } = event {
        let paths: Vec<PathBuf> = urls
            .iter()
            .filter_map(|url| url.to_file_path().ok())
            .collect();
        register_os_paths(app, pdf_paths(&paths));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

/// Arranca la aplicación. Si no se puede construir, muestra el error y termina con código 1.
pub fn run() {
    let built = tauri::Builder::default()
        // Debe ser el primer plugin: una segunda instancia entrega aquí sus argumentos.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = paths_from_args(&argv, Path::new(&cwd));
            register_os_paths(app, pdf_paths(&paths));
            focus_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SuitePlatformState::default())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let paths = paths_from_args(&args, &cwd);
            register_os_paths(app.handle(), pdf_paths(&paths));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                register_os_paths(window.app_handle(), pdf_paths(paths));
            }
        })
        .invoke_handler(suite_platform::commands::handler())
        .build(tauri::generate_context!());

    match built {
        Ok(app) => app.run(handle_run_event),
        Err(error) => {
            eprintln!("No se ha podido iniciar Lector PDF: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Directorio temporal propio de cada prueba; se borra al terminar.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("lector-pdf-test-{}-{name}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("crear directorio temporal");
            TempDir(dir)
        }

        fn file(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, b"%PDF-1.4").expect("escribir fichero de prueba");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn pdf_paths_conserva_pdf_existentes_sin_distinguir_mayusculas() {
        let dir = TempDir::new("mayusculas");
        let upper = dir.file("a.PDF");
        let lower = dir.file("b.pdf");

        let kept = pdf_paths(&[upper.clone(), lower.clone()]);

        assert_eq!(kept, vec![upper, lower]);
    }

    #[test]
    fn pdf_paths_descarta_otras_extensiones_y_rutas_inexistentes() {
        let dir = TempDir::new("descartes");
        let text = dir.file("c.txt");
        let missing = dir.0.join("d.pdf");
        let folder = dir.0.join("carpeta.pdf");
        std::fs::create_dir_all(&folder).expect("crear carpeta de prueba");

        let kept = pdf_paths(&[text, missing, folder]);

        assert!(kept.is_empty());
    }

    #[test]
    fn pdf_paths_sin_entradas_devuelve_vacio() {
        assert!(pdf_paths(&[]).is_empty());
    }
}
