use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use suite_platform::{
    atomic_copy_append, atomic_write, file_info, read_range, FileError, FileRegistry, MAX_READ_LEN,
};

static DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Directorio único bajo el temporal del sistema; se borra al salir.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let n = DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("suite-platform-{label}-{}-{n}", std::process::id()));
        fs::create_dir_all(&path).expect("crear directorio de prueba");
        TestDir { path }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.path)
            .expect("leer directorio de prueba")
            .map(|e| {
                e.expect("entrada")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn has_temp(dir: &TestDir) -> bool {
    dir.entries().iter().any(|n| n.contains(".suite-tmp"))
}

// ---------- read_range ----------

#[test]
fn read_range_devuelve_tramos_y_recorta_al_final() {
    let dir = TestDir::new("read");
    let p = dir.join("digitos.txt");
    fs::write(&p, b"0123456789").unwrap();

    assert_eq!(read_range(&p, 2, 3).unwrap(), b"234".to_vec());
    assert_eq!(read_range(&p, 8, 10).unwrap(), b"89".to_vec());
    assert_eq!(read_range(&p, 10, 5).unwrap(), Vec::<u8>::new());
    assert_eq!(read_range(&p, 0, 0).unwrap(), Vec::<u8>::new());
}

#[test]
fn read_range_fuera_de_rango_y_fichero_inexistente() {
    let dir = TestDir::new("read-err");
    let p = dir.join("digitos.txt");
    fs::write(&p, b"0123456789").unwrap();

    assert_eq!(read_range(&p, 11, 1), Err(FileError::OutOfRange));
    assert_eq!(
        read_range(&p, 0, MAX_READ_LEN + 1),
        Err(FileError::OutOfRange)
    );
    assert_eq!(
        read_range(&dir.join("no-existe.txt"), 0, 1),
        Err(FileError::NotFound)
    );
}

// ---------- atomic_write ----------

#[test]
fn atomic_write_crea_y_reemplaza_sin_dejar_temporales() {
    let dir = TestDir::new("write");
    let p = dir.join("doc.bin");

    atomic_write(&p, b"primera").unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"primera".to_vec());
    assert_eq!(dir.entries(), vec!["doc.bin".to_string()]);

    atomic_write(&p, b"segunda version").unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"segunda version".to_vec());
    assert_eq!(dir.entries(), vec!["doc.bin".to_string()]);
}

#[test]
fn atomic_write_directorio_inexistente_da_not_found_sin_temporal() {
    let dir = TestDir::new("write-missing");
    let p = dir.join("no-existe").join("doc.bin");

    assert_eq!(atomic_write(&p, b"x"), Err(FileError::NotFound));
    assert!(!has_temp(&dir));
    assert_eq!(dir.entries(), Vec::<String>::new());
}

#[cfg(unix)]
#[test]
fn atomic_write_conserva_permisos_del_destino() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TestDir::new("write-perm");
    let p = dir.join("doc.bin");
    fs::write(&p, b"antes").unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();

    atomic_write(&p, b"despues").unwrap();

    let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o640);
}

// ---------- atomic_copy_append ----------

#[test]
fn copy_append_a_otro_destino_deja_la_base_intacta() {
    let dir = TestDir::new("append");
    let base = dir.join("base.bin");
    let target = dir.join("destino.bin");
    fs::write(&base, b"abc").unwrap();

    atomic_copy_append(&base, 3, b"de", &target).unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"abcde".to_vec());
    assert_eq!(fs::read(&base).unwrap(), b"abc".to_vec());
    assert!(!has_temp(&dir));
}

#[test]
fn copy_append_sobre_la_propia_base() {
    let dir = TestDir::new("append-self");
    let base = dir.join("base.bin");
    fs::write(&base, b"abc").unwrap();

    atomic_copy_append(&base, 3, b"de", &base).unwrap();

    assert_eq!(fs::read(&base).unwrap(), b"abcde".to_vec());
    assert_eq!(dir.entries(), vec!["base.bin".to_string()]);
}

#[test]
fn copy_append_con_tamano_distinto_no_toca_nada() {
    let dir = TestDir::new("append-changed");
    let base = dir.join("base.bin");
    let target = dir.join("destino.bin");
    fs::write(&base, b"abc").unwrap();
    fs::write(&target, b"original").unwrap();

    assert_eq!(
        atomic_copy_append(&base, 4, b"de", &target),
        Err(FileError::ChangedOnDisk {
            expected: 4,
            actual: 3
        })
    );
    assert_eq!(fs::read(&target).unwrap(), b"original".to_vec());
    assert_eq!(fs::read(&base).unwrap(), b"abc".to_vec());
    assert_eq!(
        dir.entries(),
        vec!["base.bin".to_string(), "destino.bin".to_string()]
    );
}

#[test]
fn copy_append_con_base_de_50_mib_es_rapido() {
    let dir = TestDir::new("append-big");
    let base = dir.join("grande.bin");
    let target = dir.join("grande-mas.bin");
    let big = vec![0x5Au8; 50 * 1024 * 1024];
    fs::write(&base, &big).unwrap();
    let delta = vec![0xA5u8; 1024];

    let start = Instant::now();
    atomic_copy_append(&base, big.len() as u64, &delta, &target).unwrap();
    let elapsed = start.elapsed();

    eprintln!("copy_append 50 MiB + 1 KiB: {elapsed:?}");
    assert!(elapsed.as_secs_f64() < 3.0, "tardó {elapsed:?}");
    let out = fs::read(&target).unwrap();
    assert_eq!(out.len(), big.len() + delta.len());
    assert_eq!(&out[..big.len()], &big[..]);
    assert_eq!(&out[big.len()..], &delta[..]);
    assert!(!has_temp(&dir));
}

// ---------- FileRegistry ----------

#[test]
fn registro_devuelve_ruta_y_tokens_distintos() {
    let reg = FileRegistry::new();
    let p = Path::new("/ruta/doc.pdf");

    let t1 = reg.register(p);
    let t2 = reg.register(p);

    assert_ne!(t1, t2);
    assert_eq!(reg.path(&t1).unwrap(), p.to_path_buf());
    assert_eq!(reg.path(&t2).unwrap(), p.to_path_buf());
}

#[test]
fn registro_unregister_invalida_el_token() {
    let reg = FileRegistry::new();
    let t = reg.register(Path::new("/ruta/doc.pdf"));

    assert!(reg.unregister(&t));
    assert_eq!(reg.path(&t), Err(FileError::UnknownToken));
    assert!(!reg.unregister(&t));
    assert_eq!(reg.path("token-inventado"), Err(FileError::UnknownToken));
}

#[test]
fn registro_es_seguro_entre_hilos_y_no_repite_tokens() {
    let reg = FileRegistry::new();
    let tokens: Vec<String> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..8)
            .map(|_| {
                s.spawn(|| {
                    (0..1000)
                        .map(|_| reg.register(Path::new("/ruta/x.txt")))
                        .collect::<Vec<String>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("hilo"))
            .collect()
    });

    let unique: HashSet<&String> = tokens.iter().collect();
    assert_eq!(tokens.len(), 8000);
    assert_eq!(unique.len(), 8000);
}

#[test]
fn file_info_devuelve_nombre_tamano_y_token() {
    let dir = TestDir::new("info");
    let p = dir.join("hoja.csv");
    fs::write(&p, b"a;b\n").unwrap();

    let info = file_info("t7", &p).unwrap();

    assert_eq!(info.token, "t7");
    assert_eq!(info.name, "hoja.csv");
    assert_eq!(info.size, 4);
    assert!(info.last_modified_ms.is_some());
    assert_eq!(
        file_info("t8", &dir.join("nada.csv")),
        Err(FileError::NotFound)
    );
}

// ---------- FileError ----------

#[test]
fn file_error_codigos_y_mensajes() {
    assert_eq!(FileError::NotFound.code(), "not-found");
    assert_eq!(FileError::PermissionDenied.code(), "permission-denied");
    assert_eq!(
        FileError::ChangedOnDisk {
            expected: 1,
            actual: 2
        }
        .code(),
        "changed-on-disk"
    );
    assert_eq!(FileError::OutOfRange.code(), "out-of-range");
    assert_eq!(FileError::UnknownToken.code(), "unknown-token");
    assert_eq!(FileError::Io("x".into()).code(), "io");

    assert_eq!(
        FileError::NotFound.to_string(),
        "No se encuentra el fichero. Puede que se haya movido o borrado."
    );
    assert_eq!(
        FileError::PermissionDenied.to_string(),
        "No hay permiso para acceder al fichero."
    );
    assert_eq!(
        FileError::ChangedOnDisk { expected: 1, actual: 2 }.to_string(),
        "El fichero ha cambiado en el disco desde que se abrió. Guarda una copia con «Guardar como»."
    );
    assert_eq!(
        FileError::OutOfRange.to_string(),
        "Se ha intentado leer fuera del fichero."
    );
    assert_eq!(
        FileError::UnknownToken.to_string(),
        "El fichero ya no está abierto."
    );
    assert_eq!(
        FileError::Io("disco lleno".into()).to_string(),
        "No se ha podido leer o escribir el fichero (disco lleno)."
    );
}

#[test]
fn file_error_desde_io_error() {
    let nf = std::io::Error::from(ErrorKind::NotFound);
    let pd = std::io::Error::from(ErrorKind::PermissionDenied);
    let other = std::io::Error::other("otro");

    assert_eq!(FileError::from(nf), FileError::NotFound);
    assert_eq!(FileError::from(pd), FileError::PermissionDenied);
    assert!(matches!(FileError::from(other), FileError::Io(_)));
}
