//! Pruebas de `paths_from_args`: sin *feature* `tauri`, en cualquier máquina.

use std::fs;
use std::path::{Path, PathBuf};
use suite_platform::paths_from_args;

fn directorio_temporal(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("suite-args-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("crear directorio temporal");
    dir
}

fn crear_fichero(path: &Path) {
    fs::write(path, b"%PDF-1.7\n").expect("crear fichero de prueba");
}

fn texto(args: &[&str]) -> Vec<String> {
    args.iter().map(|a| (*a).to_string()).collect()
}

#[test]
fn conserva_solo_ficheros_existentes_y_resuelve_relativas_contra_cwd() {
    let cwd = directorio_temporal("cwd");
    let abs_dir = directorio_temporal("abs");
    crear_fichero(&cwd.join("a.pdf"));
    let abs = abs_dir.join("b.pdf");
    crear_fichero(&abs);

    let args = texto(&["app", "-v", "a.pdf", &abs.to_string_lossy(), "noexiste.pdf"]);

    assert_eq!(paths_from_args(&args, &cwd), vec![cwd.join("a.pdf"), abs]);
}

#[test]
fn ignora_el_programa_y_las_opciones_aunque_coincidan_con_un_fichero() {
    let cwd = directorio_temporal("opciones");
    crear_fichero(&cwd.join("-x.pdf"));
    crear_fichero(&cwd.join("app"));

    let args = texto(&["app", "-x.pdf"]);

    assert!(paths_from_args(&args, &cwd).is_empty());
}

#[test]
fn sin_argumentos_o_solo_con_el_programa_no_devuelve_nada() {
    let cwd = directorio_temporal("vacio");

    assert!(paths_from_args(&[], &cwd).is_empty());
    assert!(paths_from_args(&texto(&["app"]), &cwd).is_empty());
}

#[test]
fn descarta_directorios_aunque_existan() {
    let cwd = directorio_temporal("dirs");
    fs::create_dir_all(cwd.join("carpeta")).expect("crear carpeta");

    let args = texto(&["app", "carpeta"]);

    assert!(paths_from_args(&args, &cwd).is_empty());
}

#[test]
fn admite_rutas_con_espacios_tildes_y_emojis() {
    let cwd = directorio_temporal("unicode ñ");
    let nombre = "informe año 2026 😀.pdf";
    crear_fichero(&cwd.join(nombre));

    let args = texto(&["app", nombre]);

    assert_eq!(paths_from_args(&args, &cwd), vec![cwd.join(nombre)]);
}
