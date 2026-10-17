---
tipo: decision
id: ADR-0008
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, comun, platform, tauri, seguridad]
---

# ADR-0008 · `@suite/platform`: abrir y guardar ficheros en web y Tauri

## Contexto
Todas las apps abren y guardan documentos en navegador y en Tauri sin que la UI conozca la diferencia (skill `stack-tauri`). El lector PDF necesita además **leer por rangos** (no cargar un PDF de cientos de MB entero) y **guardar de forma atómica** añadiendo un incremento al final del original. Investigación: [[Librerias y arquitectura PDF]] (sección 5).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Tauri: `plugin-fs` (`FileHandle`) desde JS | Sin Rust propio | Permisos `fs:*` en JS; para el temporal del guardado atómico hace falta ámbito sobre el directorio; lecturas concurrentes sobre un solo `seek` | MIT/Apache |
| Tauri: protocolo `asset:` + `getDocument({url})` | pdf.js hace los rangos solo | Ámbito de `asset:`, CSP más abierta, respuestas limitadas a 1 MB | MIT/Apache |
| **Tauri: comandos Rust propios + registro de rutas** | JS no tiene ningún permiso de ficheros; solo se leen/escriben rutas que el usuario eligió (diálogo, arrastrar, abrir con); guardado atómico en Rust probado con `cargo test` | Código Rust propio (pequeño) | propia |
| Web: solo `<input type=file>` + descarga | Funciona en todos | No guarda en sitio | — |
| **Web: File System Access (Chromium) + *fallback* a `<input>` y descarga** | Guarda en sitio en Chrome/Edge; `File.slice` lee por rangos | En Firefox/Safari "Guardar" descarga una copia | — |

## Decisión
Paquete `packages/platform` (`@suite/platform`, solo fuente) con la interfaz `Platform` y dos implementaciones; crate Rust `packages/platform/rust` (`suite-platform`).
- **`ByteSource { size; read(begin, end): Promise<Uint8Array> }`** es la única forma de leer documentos. Web: `Blob.slice`. Tauri: comando `suite_read_range`.
- **Guardar** recibe `SaveData`: `{ kind: 'bytes' }` (fichero completo) o `{ kind: 'append', base, expectedSize, delta }` (copia del original + incremento, sin cargar el original en memoria). Siempre atómico: escribir a temporal en el mismo directorio y renombrar (Tauri) o `createWritable()` que confirma al cerrar (web). Si el original cambió de tamaño desde que se abrió → error `changed-on-disk`.
- **Tauri:** el crate tiene un módulo puro `files` (std, sin Tauri, probado con `cargo test` en cualquier máquina) y un módulo `commands` tras la *feature* `tauri`. Los diálogos se abren desde Rust (`tauri-plugin-dialog`) y cada ruta elegida se registra con un *token* opaco; JS solo maneja tokens. Ficheros abiertos desde el SO (argumentos, segunda instancia con `tauri-plugin-single-instance`, arrastrar a la ventana) también se registran en Rust. Enlaces externos con `tauri-plugin-opener` limitado a `http(s)` y `mailto`.
- **Preferencias** (`KeyValueStore`): `localStorage` con prefijo por app en ambas plataformas (el webview de Tauri lo persiste). Sin `plugin-store`.
- **Borradores** (recuperación tras cierre inesperado): IndexedDB (`DraftStore`, iteración 2).
- Detección de plataforma en un único sitio: `'__TAURI_INTERNALS__' in window` (`detect.ts`).
- Mensajes de error en español en el propio paquete (`messages.ts`), con códigos estables.

Versiones exactas: `@tauri-apps/api@2.12.4`, `@tauri-apps/cli@2.12.3`, `@tauri-apps/plugin-opener@2.7.2`; crates `tauri 2.12.4`, `tauri-build 2.7.3`, `tauri-plugin-dialog 2.8.3`, `tauri-plugin-opener 2.7.2`, `tauri-plugin-single-instance 2.5.4`, `serde 1.0.229`, `serde_json 1.0.154`. Desarrollo: `fake-indexeddb@6.2.6` (Apache-2.0) para tests.

## Consecuencias
- La UI nunca importa `@tauri-apps/*`; `pnpm lint` lo impide fuera de `packages/platform/src/tauri/`.
- `cargo check`/`clippy` del módulo `commands` y de `src-tauri` necesitan las librerías de WebKitGTK en Linux (`apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev`); el módulo `files` no.
- En Firefox/Safari "Guardar" descarga una copia (comportamiento documentado en el Manual).
- Cuando haya una segunda app de escritorio reutilizará el crate y los comandos tal cual.
