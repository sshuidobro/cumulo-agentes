---
name: stack-tauri
description: Normas de experto para empaquetar las apps como escritorio con Tauri 2 (comandos Rust, permisos, plugins de ficheros y diálogos, asociación de extensiones, build) manteniendo la versión web. Úsala cuando una tarea toque Tauri, src-tauri, Rust, acceso a ficheros, ventanas o empaquetado.
---

# Tauri 2 en la suite ofimática

Versión de referencia: Tauri 2.12 (`@tauri-apps/cli`, `@tauri-apps/api`), Rust estable ≥ 1.80. Comprobar versiones antes de fijarlas.

## Principio: una sola app, dos plataformas
- La interfaz no llama nunca a `@tauri-apps/*` directamente. Todo pasa por `packages/platform`:
  ```ts
  export interface Platform {
    openFile(opts: { extensions: string[] }): Promise<OpenedFile | null>; // { name, path?, bytes: Uint8Array }
    saveFile(file: { suggestedName: string; bytes: Uint8Array; path?: string }): Promise<SavedFile | null>;
    recentFiles(): Promise<RecentFile[]>;
    onFileOpenedFromOS(cb: (f: OpenedFile) => void): () => void; // doble clic en un .pdf/.docx
  }
  ```
  con `platform-tauri.ts` (plugins `dialog` y `fs`) y `platform-web.ts` (File System Access API con *fallback* a `<input type=file>` y descarga).
- Se detecta con `'__TAURI_INTERNALS__' in window` en un único sitio.

## Seguridad (obligatorio)
- Tauri 2 usa **capabilities**: concede solo los permisos necesarios en `src-tauri/capabilities/*.json` (p. ej. `dialog:allow-open`, `fs:allow-read-file` limitado a rutas elegidas por el usuario). Nunca `fs:default` con ámbito `**`.
- CSP estricta en `tauri.conf.json`; sin `dangerousRemoteDomainIpcAccess`; sin cargar URLs remotas en la ventana.
- Los documentos son **entrada no confiable**: nada de `eval`, nada de inyectar HTML del documento sin sanear (DOMPurify), JavaScript dentro de PDFs desactivado.

## Rust
- Usa comandos Rust (`#[tauri::command]`) solo para lo que el navegador no puede hacer bien: E/S del sistema, impresión nativa, operaciones muy pesadas. La lógica de documentos vive en TypeScript (`core/`) para que funcione también en web.
- Comandos `async`, devuelven `Result<T, String>` con mensajes claros; nada de `unwrap()` en código de comandos.
- `cargo fmt`, `cargo clippy -- -D warnings` y `cargo test` deben pasar.

## Integración con el sistema
- Asociación de extensiones (`bundle.fileAssociations`) para .pdf, .docx/.odt, .xlsx/.ods/.csv, .pptx/.odp, y manejo del fichero recibido al arrancar o con la app abierta (plugin `single-instance` + `deep-link`/args).
- Plugins oficiales previstos: `dialog`, `fs`, `store` (preferencias y recientes), `window-state`, `updater` (opcional), `single-instance`.
- Título de ventana con nombre del fichero y marca de "sin guardar"; avisar al cerrar con cambios sin guardar.

## Build y comprobación
- Desarrollo: `pnpm --filter <app> tauri dev`. Sin entorno gráfico (servidor, CI) se valida con `pnpm --filter <app> build` (web) y `cargo check`/`cargo test` en `src-tauri`; el empaquetado `tauri build` solo en la máquina del usuario.
- Las pruebas E2E se hacen sobre la versión web con Playwright; lo específico de Tauri se aísla en `platform-tauri.ts` y se prueba con mocks (`@tauri-apps/api/mocks`).
