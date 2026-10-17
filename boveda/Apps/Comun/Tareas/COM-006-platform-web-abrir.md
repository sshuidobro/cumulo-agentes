---
tipo: tarea
id: COM-006
titulo: Implementar Platform para navegador (abrir, soltar, enlaces, título, cierre)
app: comun
estado: en-curso
depende_de: [COM-005]
intentos: 1
skills: [stack-typescript-react, stack-tauri, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform, web]
---

# COM-006 · Implementar Platform para navegador (abrir)

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
`createWebPlatform()` devuelve una `Platform` que abre ficheros con File System Access (Chromium) o `<input type=file>`, acepta ficheros soltados, abre enlaces externos seguros, cambia el título y avisa al cerrar. `save`/`saveAs` quedan como `err('unsupported')` (los hace COM-007).

## Contexto
- Leer: `packages/platform/src/types.ts`, `byte-source.ts`, `errors.ts`, `prefs.ts`, [[ADR-0008-plataforma-ficheros]].
- `lib.dom` no trae `showOpenFilePicker`/`showSaveFilePicker` ni `queryPermission`: decláralos tú (paso 1). Nada de `any`.
- Todo lo que toca `window` se inyecta (`WebEnv`) para poder probarlo en jsdom con *fakes*.

## Qué hay que hacer
1. `src/web/fs-access.ts` (solo tipos):
   ```ts
   export interface FilePickerAcceptType { readonly description?: string; readonly accept: Record<string, string[]>; }
   export interface OpenFilePickerOptions { readonly types?: FilePickerAcceptType[]; readonly excludeAcceptAllOption?: boolean; readonly multiple?: boolean; }
   export interface SaveFilePickerOptions { readonly suggestedName?: string; readonly types?: FilePickerAcceptType[]; }
   export type ShowOpenFilePicker = (o?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
   export type ShowSaveFilePicker = (o?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
   export type PermissionHandle = FileSystemFileHandle & {
     queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
     requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
   };
   ```
2. `src/web/mime.ts`: `export function toAcceptTypes(filters: readonly FileFilter[]): FilePickerAcceptType[]` (un tipo por filtro: `description = name`, `accept = { [mime]: extensiones con punto }`; MIME por extensión: pdf `application/pdf`, docx `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, xlsx `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, pptx `application/vnd.openxmlformats-officedocument.presentationml.presentation`, odt `application/vnd.oasis.opendocument.text`, ods `application/vnd.oasis.opendocument.spreadsheet`, odp `application/vnd.oasis.opendocument.presentation`, csv `text/csv`; otra → `application/octet-stream`) y `export function toAcceptAttribute(filters): string` (p. ej. `".pdf,application/pdf"`).
3. `src/web/web-env.ts`:
   ```ts
   export interface WebEnv {
     readonly window: Window;
     readonly storage: Storage | null;
     readonly showOpenFilePicker: ShowOpenFilePicker | undefined;
     readonly showSaveFilePicker: ShowSaveFilePicker | undefined;
     /** Crea un <input type=file accept=...>, hace click y resuelve con el fichero o null si llega el evento 'cancel'. */
     readonly pickWithInput: (accept: string) => Promise<File | null>;
     /** Descarga un Blob con un <a download> y URL.createObjectURL (revoca la URL a los 10 s). */
     readonly download: (blob: Blob, name: string) => void;
   }
   export function defaultWebEnv(): WebEnv; // lee window.showOpenFilePicker/... si existen; storage = window.localStorage o null si lanza al acceder
   ```
4. `src/web/platform-web.ts`: `export function createWebPlatform(options: { readonly prefsPrefix: string }, env: WebEnv = defaultWebEnv()): Platform`.
   - Registro interno `Map<string, { file: File; handle: PermissionHandle | null }>`; tokens `w1`, `w2`, … (contador por instancia).
   - `toOpened(file, handle)` → `OpenedFile` con `path: null`, `size: file.size`, `lastModified: file.lastModified`, `canSaveInPlace: handle !== null`, `source: blobSource(file)`.
   - `openFile(filters)`: con `env.showOpenFilePicker` → `[handle] = await picker({ types: toAcceptTypes(filters), excludeAcceptAllOption: false, multiple: false })`; `DOMException` con `name === 'AbortError'` → `ok(null)`; `NotAllowedError`/`SecurityError` → `err(platformError('permission-denied', e))`; otro → `err(platformError('io', e))`. Sin picker → `env.pickWithInput(toAcceptAttribute(filters))`.
   - `openBrowserFile(file)` → `ok(toOpened(file, null))`.
   - `openDropped(dt)`: si `dt.items[0]` tiene `getAsFileSystemHandle` y devuelve un handle `kind === 'file'` → con handle; si no, `dt.files[0]` sin handle; sin ficheros → `ok(null)`.
   - `onFileOpenedFromOS` → devuelve una función vacía.
   - `openExternalUrl(url)`: `new URL(url)`; protocolo `http:`, `https:` o `mailto:` → `env.window.open(url, '_blank', 'noopener,noreferrer')` y `ok(undefined)`; URL inválida u otro protocolo → `err(platformError('unsupported'))`.
   - `setTitle(t)` → `env.window.document.title = t`.
   - `onCloseRequested(cb)`: escucha `beforeunload`; si `cb()` es `false` → `e.preventDefault()`. Devuelve la función que quita el listener.
   - `closeFile(f)` → borra el token. `save`/`saveAs` → `err(platformError('unsupported'))` (COM-007).
   - `isMac`: `/Mac|iPhone|iPad/.test(env.window.navigator.userAgent)`; `prefs: createStorageStore(env.storage, options.prefsPrefix)`.
5. `src/web/index.ts` reexporta `createWebPlatform`, `defaultWebEnv` y el tipo `WebEnv`. `src/detect.ts` añade:
   ```ts
   export async function loadPlatform(options: { readonly prefsPrefix: string }): Promise<Platform> {
     const web = await import('./web/index');
     return web.createWebPlatform(options);
   } // COM-010 añade la rama Tauri
   ```
   Exportar `loadPlatform` desde `src/index.ts`.
6. Tests `tests/web/platform-web-open.test.ts` (jsdom) con un `WebEnv` falso y *handles* falsos.

## Criterios de aceptación
- [ ] (T) Picker que devuelve un handle con un `File` de 5 bytes → `ok(OpenedFile)` con `name`, `size 5`, `canSaveInPlace true`, `path null`, y `source.read(0,5)` da los bytes.
- [ ] (T) Picker que rechaza con `AbortError` → `ok(null)`; con `NotAllowedError` → `err` con `code 'permission-denied'`; con `TypeError` → `code 'io'`.
- [ ] (T) Sin picker: se llama a `pickWithInput('.pdf,application/pdf')` para `[{ name: 'PDF', extensions: ['pdf'] }]`; `null` → `ok(null)`; fichero → `canSaveInPlace false`.
- [ ] (T) `openDropped` con `getAsFileSystemHandle` → `canSaveInPlace true`; con solo `files` → `false`; vacío → `ok(null)`.
- [ ] (T) `openExternalUrl('https://example.org')` llama a `window.open` con `'noopener,noreferrer'`; `javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,x` y `'no es url'` → `err` `unsupported` sin llamar a `window.open`.
- [ ] (T) `onCloseRequested(() => false)` + `dispatchEvent(new Event('beforeunload', { cancelable: true }))` → `defaultPrevented === true`; con `() => true` → `false`; tras darse de baja no se llama al callback.
- [ ] (T) `setTitle('a.pdf — Lector PDF')` cambia `document.title`; dos `openBrowserFile` dan tokens distintos.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `packages/platform/src/web` ≥ 85 % de líneas (salvo `defaultWebEnv`, que se cubre en e2e de PDF).

## Fuera de alcance
- Guardar (COM-007). Launch Queue/PWA. Tauri (COM-010).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/platform/src/web/` (nuevo: `fs-access.ts`, `mime.ts`, `web-env.ts`, `platform-web.ts`, `index.ts`), `packages/platform/src/detect.ts` (`loadPlatform`, solo rama web), `packages/platform/src/index.ts` (una línea de export), `packages/platform/tests/web/` (nuevo: `platform-web-open.test.ts`, `mime.test.ts`, `web-env.test.ts`, `fakes.ts`).
- Qué he hecho: `createWebPlatform` con File System Access o `<input type=file>`, `openDropped` (lee `items`/`files` de forma síncrona y cae a `files` si el handle es una carpeta o falla), `openExternalUrl` solo `http:`/`https:`/`mailto:`, `setTitle`, `onCloseRequested` con `beforeunload`. `save`/`saveAs` devuelven `unsupported` (COM-007). Los métodos de File System Access se enlazan a `window` en `defaultWebEnv` (si no, Chromium lanza "Illegal invocation"). Tipos de FS Access y `getAsFileSystemHandle` declarados en `fs-access.ts`.
- Comandos ejecutados y resultado: `pnpm lint` 0; `pnpm typecheck` 0; `pnpm test` 0 (257 tests, 24 ficheros); `pnpm coverage` 0 (`src/web` 98,3 % líneas, global 97,06 %). Cubierto también `defaultWebEnv` (pickWithInput, download, localStorage bloqueado) con jsdom, así que no depende del e2e de PDF.
- Dudas o cosas que no he podido hacer: en el commit solo entra la rama web de `loadPlatform` y el export de `loadPlatform`; la rama Tauri que ya está en el worktree (COM-010) no se commitea aquí. Sin Playwright: el flujo real de selector de Chromium se verificará en el e2e de PDF.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Lint, typecheck, test (257) y coverage en verde; `src/web` 98,3 % de líneas. Todos los criterios cubiertos por tests reales; sin código fuera de alcance; tipos sin `any`; URLs externas filtradas por protocolo.
1. (opcional) `packages/platform/src/web/platform-web.ts:27` — `registry` se escribe pero aún no se lee; COM-007 lo usará para guardar, sin acción ahora.

### [tester] ronda 1 — 2026-10-17 — FALLA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Picker con handle (5 bytes, canSaveInPlace, path null) | OK | `platform-web-open.test.ts` en verde |
| AbortError / NotAllowedError / TypeError | OK | idem; más NotFoundError en `getFile` -> `io` (qa-web-edge) |
| Sin picker -> `pickWithInput('.pdf,application/pdf')` | OK | idem; pickWithInput que lanza -> err sin romper |
| `openDropped` handle / files / vacío | OK | idem; handle rechazado o carpeta -> cae a `files` |
| `openExternalUrl` seguro | OK | también `JAVASCRIPT:`, ` javascript:`, `vbscript:`, `blob:`, `ftp:`, vacío rechazados; `MAILTO:` permitido |
| `onCloseRequested` | OK | idem; dos listeners y baja doble |
| `setTitle` y tokens distintos | OK | tokens únicos incluso tras `closeFile` |
| lint / typecheck | OK | código 0 |
| `pnpm test` código 0 | **FALLA** | 2 tests rojos de `apps/lector-pdf` (ver abajo) |
| `pnpm coverage` código 0 | **FALLA** | mismo motivo (corre el mismo conjunto) |
| `src/web` >= 85 % líneas | OK | 100 % líneas (98,3 % sentencias) con `vitest --coverage` en `packages/platform` |

**Fallo (fuera del código de COM-006, pero bloquea el criterio global):** con `pnpm test` desde la raíz fallan por tiempo, de forma repetible (3 de 3 ejecuciones), tests de rendimiento de `apps/lector-pdf` bajo carga paralela: `tests/unit/layout.test.ts` "1 000 000 de consultas aleatorias en menos de 300 ms" (1,8–3,4 s) y "calcula 1 000 000 de páginas en menos de 100 ms" (121 ms, intermitente), y `tests/unit/fixtures.test.ts` "árbol de 100 000 páginas con fanout 32" (timeout 5 s). Aislados (`vitest run tests/unit/layout.test.ts`) pasan 33/33. `packages/platform` entero: 159/159 en verde. Reproducir: `pnpm test` en la raíz. Son tests de PDF-002/PDF-006 que dependen de la carga de la máquina; la causa y su arreglo (p. ej. umbrales/timeouts razonables o ejecutarlos como benchmark) corresponden al líder/programador de PDF, no a COM-006. Sugerencia: si el líder lo decide así, COM-006 puede cerrarse en cuanto el conjunto raíz esté estable.

Tests añadidos: `packages/platform/tests/web/qa-web-edge.test.ts` (8 tests: Unicode/RTL/vacío, picker vacío, getFile fallido, drop con handle fallido o carpeta, URLs peligrosas, listeners, tokens). Revisado y conservado `packages/platform/tests/qa-edge.test.ts` (4 tests válidos: prefs Unicode/circular, fuentes vacías/NaN, readAll de 10 MB).
Rendimiento: sin presupuesto aplicable a esta ficha.
