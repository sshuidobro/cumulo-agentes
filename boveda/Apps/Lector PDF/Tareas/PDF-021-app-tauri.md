---
tipo: tarea
id: PDF-021
titulo: App de escritorio Tauri del lector (capacidades, CSP, asociación .pdf, instancia única)
app: pdf
estado: en-test
depende_de: [PDF-008, COM-009, COM-010]
intentos: 0
skills: [stack-tauri, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, tauri, seguridad]
---

# PDF-021 · App de escritorio Tauri

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]] · [[ADR-0001-tecnologia]]

## Objetivo
`apps/lector-pdf/src-tauri` empaqueta la misma app web como escritorio: abre PDFs con el diálogo nativo, con doble clic/"Abrir con" (también con la app ya abierta) y arrastrando a la ventana; permisos mínimos y CSP estricta. Se valida en el servidor con `cargo check/clippy/test` y un test de integración con `mockIPC`; `tauri dev/build` los ejecuta el usuario.

## Contexto
- Leer: [[ADR-0008-plataforma-ficheros]], [[COM-009-comandos-tauri-platform]] (tabla de comandos, `SuitePlatformState`, `handler()`, `register_os_paths`, `paths_from_args`), `packages/platform/src/tauri/platform-tauri.ts`, skill `stack-tauri`.
- Requisito: librerías WebKitGTK instaladas (COM-009). Sin entorno gráfico no se puede ejecutar la ventana.
- API Tauri 2: `tauri_plugin_single_instance::init(|app, argv, cwd| ...)` (registrar **el primero**), `WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. })`, `RunEvent::Opened { urls }` (macOS), `Manager::get_webview_window("main")` + `set_focus()`.

## Qué hay que hacer
1. `Cargo.toml` raíz: añade `"apps/lector-pdf/src-tauri"` a `members`.
2. `apps/lector-pdf/src-tauri/Cargo.toml`: paquete `lector-pdf` (`edition 2021`, `rust-version 1.80`, `publish false`), `[lib] name = "lector_pdf_lib"`, `crate-type = ["staticlib", "cdylib", "rlib"]`; `[build-dependencies] tauri-build = { version = "=2.7.3", features = [] }`; dependencias `tauri = { version = "=2.12.4", features = [] }`, `tauri-plugin-dialog = "=2.8.3"`, `tauri-plugin-opener = "=2.7.2"`, `tauri-plugin-single-instance = "=2.5.4"`, `suite-platform = { path = "../../../packages/platform/rust", features = ["tauri"] }`.
3. `build.rs`: `fn main() { tauri_build::build() }`. `src/main.rs`: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` + `fn main() { lector_pdf_lib::run() }`.
4. `src/lib.rs`:
   - `pub fn pdf_paths(paths: &[PathBuf]) -> Vec<PathBuf>`: conserva los que acaban en `.pdf` (sin distinguir mayúsculas) y son ficheros.
   - `pub fn run()`: `Builder::default()` con, en este orden, `single_instance::init` (convierte `argv`/`cwd` con `paths_from_args` → `pdf_paths` → `register_os_paths`, y enfoca la ventana `main`), `tauri_plugin_dialog::init()`, `tauri_plugin_opener::init()`, `.manage(SuitePlatformState::default())`, `.setup` (registra los PDF de `std::env::args()`), `.on_window_event` (en `DragDrop::Drop` registra `pdf_paths(paths)`), `.invoke_handler(suite_platform::commands::handler())`, `.build(tauri::generate_context!())` y `.run(|app, event| ...)` con `RunEvent::Opened { urls }` (solo `#[cfg(target_os = "macos")]`, convierte `file://` a rutas). Errores al construir → `eprintln!("No se ha podido iniciar Lector PDF: {e}")` y `std::process::exit(1)`; sin `unwrap()`.
5. `tauri.conf.json`:
   ```json
   {
     "$schema": "https://schema.tauri.app/config/2",
     "productName": "Lector PDF", "version": "0.1.0", "identifier": "es.cumulo.lectorpdf",
     "build": { "frontendDist": "../dist", "devUrl": "http://localhost:5173", "beforeDevCommand": "pnpm dev", "beforeBuildCommand": "pnpm build" },
     "app": {
       "windows": [{ "label": "main", "title": "Lector PDF", "width": 1280, "height": 860, "minWidth": 640, "minHeight": 480, "dragDropEnabled": true }],
       "security": { "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' ipc: http://ipc.localhost blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'" }
     },
     "bundle": { "active": true, "targets": "all", "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
       "fileAssociations": [{ "ext": ["pdf"], "name": "Documento PDF", "description": "Documento PDF", "role": "Viewer", "mimeType": "application/pdf" }] }
   }
   ```
6. `capabilities/default.json`: `{ "identifier": "default", "windows": ["main"], "permissions": ["core:default", "core:window:allow-set-title", "core:window:allow-destroy", { "identifier": "opener:allow-open-url", "allow": [{ "url": "https://*" }, { "url": "http://*" }, { "url": "mailto:*" }] }] }`. **Ningún** permiso `fs:*` ni `dialog:*` (los diálogos se abren desde Rust).
7. Iconos: `apps/lector-pdf/app-icon.svg` (1024×1024: documento blanco con esquina doblada sobre fondo rojo `#c62828` y las letras «PDF» en blanco) y `pnpm --filter lector-pdf tauri icon app-icon.svg` (genera `src-tauri/icons/`). Si la CLI no acepta SVG, crea `app-icon.png` con un script Node (`node:zlib`, PNG RGBA) con el mismo diseño simplificado y usa ese. Versiona `src-tauri/icons/`.
8. `apps/lector-pdf/package.json`: `devDependencies` `"@tauri-apps/cli": "2.12.3"` y script `"tauri": "tauri"`. `.gitignore` ya ignora `src-tauri/target` y `gen`.
9. Test de integración TS `tests/ui/tauri-integration.test.tsx` (jsdom): define `window.__TAURI_INTERNALS__` con `mockIPC` + `mockWindows('main')`; `loadPlatform` devuelve `kind 'tauri'`; clic en «Abrir…» → `suite_open_dialog` devuelve un `FileInfoDto` de `basic-5.pdf`; `suite_read_range` sirve los bytes del fixture; el motor (`loadPdf`, real con el *legacy* de pdf.js; si pdf.js no arranca en jsdom, simula `loadPdf` con `vi.mock` pero comprueba igualmente que su `ByteSource` lee del `suite_read_range` simulado, y anótalo) abre el documento; `plugin:window|set_title` recibe «basic-5.pdf — Lector PDF». `clearMocks()` al final.
10. Lista de comprobación manual (para el usuario, en el Registro y luego en el Manual): `pnpm --filter lector-pdf tauri dev` → abrir con el botón, arrastrar un PDF, abrir un `.pdf` con doble clic con la app cerrada y abierta, enlace externo con confirmación.

## Criterios de aceptación
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace --all-features` con código 0 (anota la salida resumida).
- [ ] (T) `pdf_paths` conserva `a.PDF` y `b.pdf` existentes y descarta `c.txt` y rutas inexistentes (test Rust con ficheros temporales).
- [ ] (T) El test de integración TS pasa (abrir por diálogo → documento listo → título de ventana).
- [ ] `capabilities/default.json` no contiene `fs:` ni `dialog:` ni `"**"`; la CSP de `tauri.conf.json` no contiene `unsafe-eval` ni dominios remotos (el revisor lo comprueba con `grep`).
- [ ] `pnpm --filter lector-pdf exec tauri info` se ejecuta sin errores de configuración (anota la salida).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- `tauri build`/instaladores (en la máquina del usuario), firma de código, actualizaciones automáticas, impresión nativa (PDF-044), recientes (PDF-049).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] nota — 2026-10-17
Por [[ADR-0013-pdfjs-build-legacy]] el motor usa la build `legacy` de pdf.js (página y worker), también en el webview de Tauri (WebKitGTK/WKWebView/WebView2 no tienen `Map.prototype.getOrInsertComputed`). No cambia nada de esta ficha: la CSP (`script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:`) vale igual. Si en el webview aparece «El PDF está dañado…» con PDFs válidos, comprobar primero que `src/engine/worker.ts` apunta a `legacy/build/pdf.worker.min.mjs`.

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `Cargo.toml` (raíz, members); `apps/lector-pdf/src-tauri/` (Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, src/main.rs, src/lib.rs, icons/); `apps/lector-pdf/app-icon.svg`; `apps/lector-pdf/package.json` (`tauri`, `@tauri-apps/cli` 2.12.3, `@tauri-apps/api` 2.12.4); `pnpm-lock.yaml`, `Cargo.lock`; `apps/lector-pdf/tests/ui/tauri-integration.test.tsx`.
- Qué he hecho: crate `lector-pdf` con `pdf_paths`, `run()` (instancia única primero, dialog, opener, `SuitePlatformState`, `setup` con argumentos, arrastrar y soltar, `invoke_handler` de suite-platform, `RunEvent::Opened` solo macOS), config Tauri y CSP de la ficha, capacidad `default` con `core:window:allow-destroy` (COM-013). Iconos generados con `tauri icon` desde `app-icon.svg` (letras «PDF» sobre una banda roja en la base de la página). Test de integración con `mockIPC` y `mockWindows`: `loadPlatform` → `kind 'tauri'`, diálogo cancelado, diálogo con `basic-5.pdf` → motor real de pdf.js (legacy) muestra «5 páginas» y `plugin:window|set_title` recibe «basic-5.pdf — Lector PDF».
- Comandos ejecutados y resultado: `cargo fmt --all -- --check` (0); `cargo clippy --workspace --all-targets --all-features -- -D warnings` (0); `cargo test --workspace --all-features` (0; 36 tests Rust pasan, 3 nuevos de `pdf_paths`); `pnpm --filter lector-pdf exec tauri info` (0, sin errores de configuración; avisa de que `@tauri-apps/api` no está instalado en la app, aviso informativo); `pnpm lint` (0); `pnpm typecheck` (raíz OK en paquetes de `packages/`; en `apps/lector-pdf` mi test pasa, pero **falla** `tests/unit/pdf/xref.test.ts(98)` sin commitear, ajeno a esta ficha); `pnpm test` (69 ficheros, 892 tests OK); `pnpm coverage` (0; 96,4 % líneas).
- Dudas o cosas que no he podido hacer: (1) Añadido `@tauri-apps/api` 2.12.4 como devDependency de `lector-pdf`: la ficha pide `mockIPC` en la app y sin esa dependencia no resuelve; es la misma versión que usa `@suite/platform`. El líder debe confirmarla. (2) El test usa `import.meta.dirname` para los fixtures porque en jsdom `import.meta.url` no es `file:` y `tests/fixtures/paths.ts` falla; los fixtures los crea `global-setup`. (3) La CSP contiene `http://ipc.localhost` e `ipc:` como pide la ficha (IPC local de Tauri, no dominio remoto). (4) No he podido compilar para macOS (solo Linux): el brazo `RunEvent::Opened` queda sin verificar. (5) `tauri build`, doble clic y arrastrar en ventana real: pendiente en la máquina del usuario (lista manual de la ficha). (6) `generate_context!` exige que exista `apps/lector-pdf/dist` (lo genera el build web). (7) `pnpm-lock.yaml` y `apps/lector-pdf/package.json` contienen además un `fflate` de otro trabajo en curso que no es mío; no lo he commiteado.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Verificado: `cargo fmt --check`, `clippy -D warnings` y `cargo test --workspace --all-features` (0; 3 tests de `pdf_paths`), `pnpm lint` y `pnpm typecheck` (0), test `tauri-integration` (2 OK), `tauri info` sin errores de configuración. Dependencia `@tauri-apps/api` 2.12.4 en lector-pdf aceptada por el coordinador.
Seguridad: capacidad `default` solo con `core:default`, `set-title`, `destroy` y `opener:allow-open-url` (ámbito http/https/mailto, según ficha); ningún `fs:`, `dialog:` ni `**`; plugin `fs` no registrado. CSP sin dominios remotos ni `'unsafe-eval'` (solo `'wasm-unsafe-eval'`, que exige la ficha y pdf.js/wasm; un `grep unsafe-eval` literal lo encontrará, es un falso positivo). Sin `unwrap()` en `run()`; instancia única registrada la primera; `pdf_paths` filtra por extensión y fichero existente.
Sugerencias (opcional): 1. `opener:allow-open-url` con `http://*` permite enlaces sin TLS; valorar limitarlo a `https://*` y `mailto:` si no hace falta. 2. Verificar `RunEvent::Opened` (macOS) cuando haya entorno Mac; queda en la lista manual.
