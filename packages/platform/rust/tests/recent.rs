//! Pruebas de la lista de recientes (`recent.json`): carga tolerante, límite,
//! sin duplicados, guardado atómico y reapertura por id.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use suite_platform::recent::{load, open_recent, save, RecentList, RecentOpenError, MAX_RECENTS};
use suite_platform::{read_range, FileError, FileRegistry};

static DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Directorio único bajo el temporal del sistema; se borra al salir.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let n = DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("suite-recent-{label}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("crear directorio de prueba");
        TestDir { path }
    }

    fn file(&self, name: &str) -> PathBuf {
        let path = self.path.join(name);
        fs::write(&path, format!("contenido de {name}")).expect("crear fichero");
        path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("leer directorio")
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

#[test]
fn fichero_ausente_da_lista_vacia() {
    let dir = TestDir::new("ausente");

    let list = load(&dir.path.join("recent.json"));

    assert!(list.entries.is_empty());
}

#[test]
fn fichero_corrupto_da_lista_vacia_y_se_sobrescribe_en_el_siguiente_touch() {
    let dir = TestDir::new("corrupto");
    let file = dir.path.join("recent.json");
    fs::write(&file, "{basura").expect("escribir corrupto");
    let pdf = dir.file("a.pdf");

    let mut list = load(&file);
    assert!(list.entries.is_empty());
    list.touch(&pdf, Some(3), 100);
    save(&file, &list).expect("guardar");

    let reloaded = load(&file);
    assert_eq!(reloaded, list);
    assert_eq!(reloaded.entries.len(), 1);
    assert_eq!(reloaded.entries[0].path, pdf);
}

#[test]
fn json_con_forma_incorrecta_da_lista_vacia() {
    let dir = TestDir::new("forma");
    let file = dir.path.join("recent.json");
    fs::write(&file, r#"{"entries": "no es una lista"}"#).expect("escribir");

    assert!(load(&file).entries.is_empty());
}

#[test]
fn abrir_21_rutas_distintas_deja_20_entradas() {
    let dir = TestDir::new("veintiuna");
    let mut list = RecentList::default();

    for i in 0..21 {
        let path = dir.file(&format!("doc-{i:02}.pdf"));
        list.touch(&path, Some(1), 1_000 + i);
    }

    assert_eq!(MAX_RECENTS, 20);
    assert_eq!(list.entries.len(), 20);
    assert_eq!(list.entries[0].name, "doc-20.pdf");
    assert!(list.entries.iter().all(|e| e.name != "doc-00.pdf"));
}

#[test]
fn load_recorta_un_fichero_con_mas_de_20_entradas() {
    let dir = TestDir::new("recorte");
    let file = dir.path.join("recent.json");
    // Fichero editado a mano con 25 entradas: la carga debe conservar solo 20.
    let entries: Vec<serde_json::Value> = (0..25)
        .map(|i| {
            serde_json::json!({
                "id": format!("r{i}"),
                "path": format!("/docs/d{i}.pdf"),
                "name": format!("d{i}.pdf"),
                "size": null,
                "openedAt": i
            })
        })
        .collect();
    fs::write(&file, serde_json::json!({ "entries": entries }).to_string()).expect("escribir");

    let list = load(&file);

    assert_eq!(list.entries.len(), 20);
    assert_eq!(list.entries[0].id, "r0");
}

#[test]
fn volver_a_abrir_la_quinta_la_pone_primera_sin_duplicarla() {
    let dir = TestDir::new("quinta");
    let mut list = RecentList::default();
    let paths: Vec<PathBuf> = (0..6).map(|i| dir.file(&format!("p{i}.pdf"))).collect();
    for (i, path) in paths.iter().enumerate() {
        list.touch(path, Some(1), i as u64);
    }
    // Orden antes de tocar: p5, p4, p3, p2, p1, p0. Se vuelve a abrir p1.
    let id_before = list
        .entries
        .iter()
        .find(|e| e.path == paths[1])
        .expect("p1")
        .id
        .clone();
    let total_before = list.entries.len();

    list.touch(&paths[1], Some(9), 99);

    assert_eq!(list.entries.len(), total_before);
    assert_eq!(list.entries[0].path, paths[1]);
    assert_eq!(list.entries[0].id, id_before);
    assert_eq!(list.entries[0].size, Some(9));
    assert_eq!(list.entries[0].opened_at, 99);
    let count = list.entries.iter().filter(|e| e.path == paths[1]).count();
    assert_eq!(count, 1);
}

#[test]
fn ids_son_unicos_aunque_se_registren_en_el_mismo_instante() {
    let dir = TestDir::new("ids");
    let mut list = RecentList::default();
    for i in 0..20 {
        list.touch(&dir.file(&format!("x{i}.pdf")), None, 500);
    }

    let ids: HashSet<&str> = list.entries.iter().map(|e| e.id.as_str()).collect();

    assert_eq!(ids.len(), 20);
}

#[test]
fn remove_quita_solo_la_entrada_indicada_y_clear_vacia() {
    let dir = TestDir::new("remove");
    let mut list = RecentList::default();
    let a = dir.file("a.pdf");
    let b = dir.file("b.pdf");
    list.touch(&a, None, 1);
    list.touch(&b, None, 2);
    let id_a = list
        .entries
        .iter()
        .find(|e| e.path == a)
        .expect("a")
        .id
        .clone();

    assert!(list.remove(&id_a));
    assert!(!list.remove(&id_a));
    assert_eq!(list.entries.len(), 1);
    assert_eq!(list.entries[0].path, b);

    list.clear();
    assert!(list.entries.is_empty());
    assert!(
        a.exists() && b.exists(),
        "quitar de recientes no borra ficheros"
    );
}

#[test]
fn guardado_atomico_no_deja_temporales_y_se_relee_igual() {
    let dir = TestDir::new("atomico");
    let file = dir.path.join("recent.json");
    let mut list = RecentList::default();
    list.touch(&dir.file("ñandú 😀.pdf"), Some(12), 42);

    save(&file, &list).expect("guardar");
    save(&file, &list).expect("guardar de nuevo");

    assert_eq!(names_in(&dir.path), vec!["recent.json", "ñandú 😀.pdf"]);
    assert_eq!(load(&file), list);
}

#[test]
fn guardar_crea_la_carpeta_si_falta() {
    let dir = TestDir::new("carpeta");
    let file = dir.path.join("datos").join("recent.json");

    save(&file, &RecentList::default()).expect("guardar");

    assert!(file.is_file());
}

#[test]
fn guardar_sin_permiso_de_carpeta_devuelve_error_y_no_toca_el_fichero_anterior() {
    let dir = TestDir::new("error");
    let file = dir.path.join("recent.json");
    let mut list = RecentList::default();
    list.touch(&dir.file("a.pdf"), Some(1), 1);
    save(&file, &list).expect("guardar inicial");
    let before = fs::read(&file).expect("leer");
    // Un fichero donde debería haber una carpeta hace fallar la creación.
    let blocker = dir.path.join("bloqueo");
    fs::write(&blocker, b"x").expect("crear bloqueo");

    let result = save(&blocker.join("recent.json"), &list);

    assert!(matches!(result, Err(FileError::Io(_))));
    assert_eq!(fs::read(&file).expect("releer"), before);
    assert_eq!(names_in(&dir.path), vec!["a.pdf", "bloqueo", "recent.json"]);
}

#[test]
fn open_recent_con_id_desconocido_devuelve_error() {
    let registry = FileRegistry::new();
    let mut list = RecentList::default();

    let result = open_recent(&registry, &mut list, "no-existe", 1);

    assert_eq!(result, Err(RecentOpenError::UnknownId));
}

#[test]
fn open_recent_con_ruta_borrada_devuelve_not_found_y_conserva_la_entrada() {
    let dir = TestDir::new("borrada");
    let registry = FileRegistry::new();
    let gone = dir.file("gone.pdf");
    let mut list = RecentList::default();
    list.touch(&gone, Some(3), 1);
    let id = list.entries[0].id.clone();
    fs::remove_file(&gone).expect("borrar");

    let result = open_recent(&registry, &mut list, &id, 2);

    assert_eq!(result, Err(RecentOpenError::File(FileError::NotFound)));
    assert_eq!(list.entries.len(), 1);
    assert_eq!(
        list.entries[0].opened_at, 1,
        "un fallo no reordena la lista"
    );
}

#[test]
fn open_recent_valido_registra_token_que_permite_leer_por_rangos() {
    let dir = TestDir::new("valida");
    let registry = FileRegistry::new();
    let pdf = dir.file("valido.pdf");
    let mut list = RecentList::default();
    list.touch(&pdf, None, 1);
    let id = list.entries[0].id.clone();

    let info = open_recent(&registry, &mut list, &id, 5).expect("reabrir");

    assert_eq!(info.name, "valido.pdf");
    assert_eq!(info.size, "contenido de valido.pdf".len() as u64);
    assert_eq!(registry.path(&info.token).expect("token"), pdf);
    let bytes = read_range(&registry.path(&info.token).expect("token"), 0, 8).expect("leer");
    assert_eq!(bytes, b"contenid");
    assert_eq!(list.entries[0].path, pdf);
    assert_eq!(list.entries[0].opened_at, 5);
    assert_eq!(list.entries[0].size, Some(info.size));
}
