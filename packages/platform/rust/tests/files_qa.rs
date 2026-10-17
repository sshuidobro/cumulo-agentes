//! Casos límite de QA para `suite-platform`: Unicode, rutas con espacios,
//! ficheros vacíos, destinos inválidos y desbordes.

use std::fs;
use std::path::{Path, PathBuf};
use suite_platform::*;

fn unique_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("suite qa ñandú {tag} {}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("crear dir");
    dir
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .expect("leer dir")
        .map(|e| {
            e.expect("entrada")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    v.sort();
    v
}

#[test]
fn unicode_y_espacios_en_nombre_y_ruta() {
    let dir = unique_dir("uni");
    let p = dir.join("Informe año 😀 مرحبا.txt");
    atomic_write(&p, "héllo ñ 😀".as_bytes()).expect("write");
    let info = file_info("t9", &p).expect("info");
    assert_eq!(info.name, "Informe año 😀 مرحبا.txt");
    assert_eq!(
        read_range(&p, 0, 100).expect("read"),
        "héllo ñ 😀".as_bytes()
    );
    assert_eq!(names(&dir), vec!["Informe año 😀 مرحبا.txt".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn fichero_vacio() {
    let dir = unique_dir("vacio");
    let p = dir.join("v.bin");
    atomic_write(&p, b"").expect("write vacío");
    assert_eq!(file_info("t1", &p).expect("info").size, 0);
    assert_eq!(read_range(&p, 0, 10).expect("r"), Vec::<u8>::new());
    assert_eq!(read_range(&p, 1, 1), Err(FileError::OutOfRange));
    atomic_copy_append(&p, 0, b"x", &p).expect("append a vacío");
    assert_eq!(fs::read(&p).expect("read"), b"x");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_range_limites_extremos() {
    let dir = unique_dir("lim");
    let p = dir.join("a.txt");
    fs::write(&p, "0123456789").expect("w");
    assert_eq!(read_range(&p, u64::MAX, 1), Err(FileError::OutOfRange));
    assert_eq!(read_range(&p, 5, u64::MAX), Err(FileError::OutOfRange));
    assert_eq!(read_range(&p, 3, 0).expect("len0"), Vec::<u8>::new());
    assert_eq!(read_range(&p, 0, MAX_READ_LEN).expect("max"), b"0123456789");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_range_sobre_directorio_no_entra_en_panico() {
    let dir = unique_dir("dir");
    assert!(read_range(&dir, 0, 1).is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn atomic_write_con_destino_directorio_falla_sin_temporal() {
    let dir = unique_dir("dest");
    let sub = dir.join("sub");
    fs::create_dir(&sub).expect("mkdir");
    assert!(atomic_write(&sub, b"x").is_err());
    assert_eq!(names(&dir), vec!["sub".to_string()]);
    assert!(names(&sub).is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn copy_append_base_inexistente_y_destino_inexistente() {
    let dir = unique_dir("ca");
    assert_eq!(
        atomic_copy_append(&dir.join("no"), 0, b"x", &dir.join("out")),
        Err(FileError::NotFound)
    );
    let b = dir.join("b");
    fs::write(&b, "abc").expect("w");
    assert_eq!(
        atomic_copy_append(&b, 3, b"d", &dir.join("nodir").join("out")),
        Err(FileError::NotFound)
    );
    assert_eq!(names(&dir), vec!["b".to_string()]);
    assert_eq!(fs::read(&b).expect("r"), b"abc");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn copy_append_con_destino_directorio_limpia_temporal() {
    let dir = unique_dir("cad");
    let b = dir.join("b");
    fs::write(&b, "abc").expect("w");
    let sub = dir.join("sub");
    fs::create_dir(&sub).expect("mkdir");
    assert!(atomic_copy_append(&b, 3, b"d", &sub).is_err());
    assert_eq!(names(&dir), vec!["b".to_string(), "sub".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn copy_append_delta_vacio_copia_identico() {
    let dir = unique_dir("d0");
    let b = dir.join("b");
    fs::write(&b, "abc").expect("w");
    atomic_copy_append(&b, 3, b"", &dir.join("c")).expect("ok");
    assert_eq!(fs::read(dir.join("c")).expect("r"), b"abc");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn registro_token_desconocido_y_no_reutiliza_tokens_tras_unregister() {
    let r = FileRegistry::new();
    assert_eq!(r.path("t1"), Err(FileError::UnknownToken));
    assert!(!r.unregister("t1"));
    let a = r.register(Path::new("/x"));
    assert!(r.unregister(&a));
    assert!(!r.unregister(&a));
    let b = r.register(Path::new("/x"));
    assert_ne!(a, b);
}
